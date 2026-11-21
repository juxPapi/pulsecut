import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { probe, extractAudio, renderClip, makeThumb, makePlaybackCopy, needsPlaybackCopy, FFMPEG } from './media.js';
import { transcribe, MODELS } from './asr.js';
import { findClips, wordsFromText, scoreRange } from './clips.js';
import {
  getProject,
  saveProject,
  listProjects,
  deleteProject,
  UPLOAD_DIR,
  EXPORT_DIR,
  TMP_DIR,
  MODEL_DIR,
} from './store.js';
import { resolveStyle, resolveLayout, ASPECTS, toCues, LANGUAGES, CAPTION_STYLES } from '../shared/captions.js';
import { resolveStacks } from '../shared/framing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8790;

const app = express();
app.disable('x-powered-by');

// PulseCut is a local-only tool. Reject Host header rebinding and cross-origin
// mutations so a malicious web page cannot use the browser as a proxy into the
// localhost API. Node scripts (no Origin header) and the Vite dev proxy remain
// allowed.
const allowedHosts = new Set([
  `127.0.0.1:${PORT}`,
  `localhost:${PORT}`,
  '127.0.0.1:5190',
  'localhost:5190',
]);
const allowedOrigins = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  'http://127.0.0.1:5190',
  'http://localhost:5190',
]);
app.use((req, res, next) => {
  const host = String(req.headers.host || '').toLowerCase();
  if (!allowedHosts.has(host)) return res.status(403).json({ error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && !allowedOrigins.has(String(origin).toLowerCase())) {
    return res.status(403).json({ error: 'Forbidden origin' });
  }
  next();
});
app.use(express.json({ limit: '4mb' }));

// ------------------------------------------------------------------ SSE bus
const clients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

// ------------------------------------------------------------------ helpers
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const id = crypto.randomUUID();
      req.uploadId = id;
      cb(null, `${id}${path.extname(file.originalname).toLowerCase() || '.mp4'}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp4|mov|mkv|webm|m4v|avi|mpg|mpeg|wmv|flv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Drop a video file (mp4, mov, mkv, webm).'), ok);
  },
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
});

function slug(value) {
  return (
    String(value)
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'clip'
  );
}

function projectSummary(project) {
  return {
    projectId: project.id,
    id: project.id,
    name: project.name,
    playback: project.playback || null,
    status: project.status,
    duration: project.duration,
    width: project.width,
    height: project.height,
    clips: project.clips?.length || 0,
    languageCode: project.languageCode,
    model: project.model,
    error: project.error || null,
  };
}

function clipCues(clip) {
  if (Array.isArray(clip.cues) && clip.cues.length) return clip.cues;
  return toCues(clip.words || []);
}

function requireProject(handler) {
  return async (req, res, next) => {
    try {
      const project = await getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      req.project = project;
      return handler(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

// ------------------------------------------------------- browser playback copy
// HEVC, ProRes and similar sources render fine in FFmpeg but show a black frame in
// a browser <video>, so keep a small H.264 copy around for the live preview only.
const playbackFile = (id) => path.join(UPLOAD_DIR, `${id}.preview.mp4`);
let playbackChain = Promise.resolve();

function markPlayback(project) {
  if (!needsPlaybackCopy(project, project.filePath)) return false;
  const status = project.playback?.status;
  if (status === 'converting' || status === 'ready' || status === 'failed') return false;
  project.playback = { status: 'converting', progress: 0 };
  return true;
}

function startPlayback(id) {
  playbackChain = playbackChain.then(() => preparePlayback(id)).catch(() => {});
}

async function preparePlayback(id) {
  const project = await getProject(id);
  if (!project) return;
  const rotated = Number(project.rotation) % 180 === 90;
  try {
    await makePlaybackCopy(project.filePath, playbackFile(id), {
      width: rotated ? project.height : project.width,
      height: rotated ? project.width : project.height,
      duration: project.duration,
      hasAudio: project.hasAudio !== false,
      videoCodec: project.videoCodec,
      sourceFile: project.filePath,
      onProgress: (percent) => broadcast('playback', { projectId: id, percent: Math.round(percent) }),
    });
    project.previewPath = playbackFile(id);
    project.playback = { status: 'ready', version: Date.now() };
  } catch (error) {
    project.playback = { status: 'failed', error: error.message };
    broadcast('log', { projectId: id, message: `Could not build a browser preview: ${error.message}` });
  }
  await saveProject(project);
  broadcast('project', projectSummary(project));
}

// ------------------------------------------------------------------ health
app.get('/api/health', async (req, res) => {
  const tools = await new Promise((resolve) => {
    execFile(FFMPEG, ['-version'], { timeout: 8000 }, (error, stdout) => {
      resolve({ ffmpeg: !error, version: error ? null : String(stdout).split('\n')[0].trim() });
    });
  });
  const modelFiles = await fsp.readdir(MODEL_DIR, { recursive: true }).catch(() => []);
  res.json({
    ok: true,
    ...tools,
    models: MODELS,
    languages: LANGUAGES,
    captionStyles: CAPTION_STYLES.length,
    aspects: ASPECTS,
    cachedModelFiles: modelFiles.filter((file) => String(file).includes('.onnx')).length,
  });
});

// ------------------------------------------------------------------ projects
app.get('/api/projects', async (req, res) => {
  res.json({ projects: await listProjects() });
});

app.post('/api/upload', (req, res, next) => {
  upload.single('video')(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    try {
      const info = await probe(req.file.path);
      const id = req.uploadId;
      const project = {
        id,
        name: path.basename(req.file.originalname, path.extname(req.file.originalname)),
        fileName: req.file.originalname,
        filePath: req.file.path,
        mime: req.file.mimetype || 'video/mp4',
        thumbnail: `/api/projects/${id}/thumb`,
        ...info,
        playback: null,
        previewPath: null,
        status: 'uploaded',
        layout: 'fill',
        languageCode: 'auto',
        model: 'base',
        transcript: null,
        clips: [],
        exports: [],
        createdAt: new Date().toISOString(),
      };
      await makeThumb(req.file.path, path.join(UPLOAD_DIR, `${id}.jpg`), Math.min(2, info.duration / 3)).catch(() => {});
      const needsCopy = markPlayback(project);
      await saveProject(project);
      res.json({ project });
      if (needsCopy) startPlayback(id);
    } catch (err) {
      await fsp.rm(req.file.path, { force: true }).catch(() => {});
      res.status(400).json({ error: `Could not read that video: ${err.message}` });
    }
  });
});

app.get('/api/projects/:id', requireProject(async (req, res) => {
  const { project } = req;
  if (markPlayback(project)) {
    await saveProject(project);
    startPlayback(project.id);
  }
  res.json({
    project: {
      ...project,
      clips: (project.clips || []).map((clip) => ({ ...clip, cues: clipCues(clip) })),
    },
  });
}));

app.delete('/api/projects/:id', requireProject(async (req, res) => {
  await deleteProject(req.params.id);
  res.json({ ok: true });
}));

// Project-level choices (currently the video layout) stick to the project, so
// reopening a video or reloading the page does not reset them to the defaults.
app.patch('/api/projects/:id', requireProject(async (req, res) => {
  const { project } = req;
  const { layout, caption } = req.body || {};
  if (layout !== undefined) project.layout = resolveLayout(layout);
  if (caption === null) {
    delete project.caption;
  } else if (caption && typeof caption === 'object') {
    const x = Number(caption.x);
    const y = Number(caption.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      project.caption = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
    } else {
      delete project.caption;
    }
  }
  await saveProject(project);
  broadcast('project', projectSummary(project));
  res.json({ project });
}));

app.get('/api/projects/:id/thumb', requireProject(async (req, res) => {
  const thumb = path.join(UPLOAD_DIR, `${req.params.id}.jpg`);
  if (fs.existsSync(thumb)) return res.sendFile(thumb);
  return res.status(404).end();
}));

app.get('/api/media/:id', requireProject(async (req, res) => {
  const usePreview = req.project.previewPath && fs.existsSync(req.project.previewPath);
  const filePath = usePreview ? req.project.previewPath : req.project.filePath;
  const stat = await fsp.stat(filePath);
  const type = usePreview ? 'video/mp4' : req.project.mime || 'video/mp4';
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': type, 'Accept-Ranges': 'bytes' });
    return fs.createReadStream(filePath).pipe(res);
  }
  const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
  const start = Number.parseInt(startRaw, 10) || 0;
  const end = endRaw ? Math.min(Number.parseInt(endRaw, 10), stat.size - 1) : stat.size - 1;
  if (start >= stat.size) {
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    return res.end();
  }
  res.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    'Content-Type': type,
  });
  return fs.createReadStream(filePath, { start, end }).pipe(res);
}));

// ------------------------------------------------------------------ transcript
let transcriptionChain = Promise.resolve();

async function runTranscription(id, languageCode, model) {
  const project = await getProject(id);
  if (!project) return;
  const language = LANGUAGES.find((item) => item.id === languageCode) || LANGUAGES[0];
  project.status = 'transcribing';
  project.error = null;
  project.languageCode = language.id;
  project.model = model;
  await saveProject(project);
  broadcast('project', projectSummary(project));

  const wav = path.join(TMP_DIR, `${id}.wav`);
  try {
    broadcast('progress', { projectId: id, phase: 'Extracting audio', percent: 3 });
    await extractAudio(project.filePath, wav, project.duration, (percent) => {
      broadcast('progress', { projectId: id, phase: 'Extracting audio', percent: 3 + percent * 0.12 });
    });

    broadcast('progress', { projectId: id, phase: 'Loading Whisper', percent: 16 });
    const result = await transcribe(wav, {
      model,
      language: language.whisper || 'auto',
      onLog: (message) => broadcast('log', { projectId: id, message }),
      onProgress: (percent) => {
        broadcast('progress', { projectId: id, phase: 'Transcribing on this machine', percent: 16 + percent * 0.72 });
      },
    });

    project.transcript = {
      text: result.text,
      words: result.words,
      model,
      language: language.id,
      wordCount: result.words.length,
    };
    broadcast('progress', { projectId: id, phase: 'Finding clips', percent: 92 });
    project.clips = findClips({
      words: result.words,
      duration: project.duration,
      language: language.id,
      limit: 8,
    }).map((clip) => ({ ...clip, cues: toCues(clip.words) }));

    project.status = 'ready';
    await saveProject(project);
    broadcast('progress', { projectId: id, phase: 'Ready', percent: 100 });
  } catch (error) {
    project.status = 'error';
    project.error = error.message;
    await saveProject(project);
    broadcast('log', { projectId: id, message: `Transcription failed: ${error.message}` });
  } finally {
    broadcast('project', projectSummary(project));
  }
}

app.post('/api/projects/:id/transcribe', requireProject(async (req, res) => {
  const { project } = req;
  const languageCode = String(req.body?.language || project.languageCode || 'auto');
  const model = String(req.body?.model || project.model || 'base');
  if (project.status === 'transcribing') {
    return res.status(409).json({ error: 'This video is already being transcribed.' });
  }
  project.status = 'transcribing';
  project.error = null;
  await saveProject(project);
  transcriptionChain = transcriptionChain
    .then(() => runTranscription(project.id, languageCode, model))
    .catch(() => {});
  return res.json({ ok: true, project: projectSummary(project) });
}));

app.post('/api/projects/:id/transcript', requireProject(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Paste a transcript first.' });
  if (text.length > 200_000) return res.status(413).json({ error: 'Transcript is too large (200,000 characters max).' });
  const project = req.project;
  const words = wordsFromText(text, project.duration);
  const language = project.languageCode || 'auto';
  project.transcript = { text, words, model: 'manual', language, wordCount: words.length };
  project.clips = findClips({ words, duration: project.duration, language, limit: 8 }).map((clip) => ({
    ...clip,
    cues: toCues(clip.words),
  }));
  project.status = 'ready';
  await saveProject(project);
  broadcast('project', projectSummary(project));
  res.json({ project: { ...project, clips: project.clips } });
}));

// ------------------------------------------------------------------ clip edits
app.patch('/api/projects/:id/clips/:clipId', requireProject(async (req, res) => {
  const project = req.project;
  const clip = (project.clips || []).find((item) => item.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });

  const { title, hashtags, focus, focusY, zoom, stacks, start, end } = req.body || {};
  if (typeof title === 'string') clip.title = title.slice(0, 120);
  if (Array.isArray(hashtags)) clip.hashtags = hashtags.map(String).slice(0, 12);
  if (typeof focus === 'number') clip.focus = Math.min(1, Math.max(0, focus));
  if (typeof focusY === 'number') clip.focusY = Math.min(1, Math.max(0, focusY));
  if (typeof zoom === 'number') clip.zoom = Math.min(2, Math.max(1, zoom));

  if (typeof start === 'number' || typeof end === 'number') {
    const nextStart = Math.max(0, Number(start ?? clip.start));
    const nextEnd = Math.min(project.duration, Number(end ?? clip.end));
    if (nextEnd - nextStart < 4) return res.status(400).json({ error: 'A clip must be at least 4 seconds.' });
    const rescored = scoreRange(project.transcript?.words || [], nextStart, nextEnd, project.languageCode);
    if (!rescored) return res.status(400).json({ error: 'No speech in that range.' });
    Object.assign(clip, {
      start: rescored.start,
      end: rescored.end,
      duration: rescored.duration,
      score: rescored.score,
      scoreLabel: rescored.scoreLabel,
      reasons: rescored.reasons,
      text: rescored.text,
      excerpt: rescored.excerpt,
      words: rescored.words,
      sentences: rescored.sentences,
      hashtags: clip.hashtags?.length ? clip.hashtags : rescored.hashtags,
      wordsPerSecond: rescored.wordsPerSecond,
    });
    clip.cues = toCues(clip.words);
  }

  // Per-stack angles and source offsets are clamped against the final in/out
  // points and the real source duration so a stack can never ask FFmpeg to
  // decode past the end of a file — including after a section edit.
  if (stacks === null) {
    delete clip.stacks;
  } else if (Array.isArray(stacks) || typeof start === 'number' || typeof end === 'number') {
    clip.stacks = resolveStacks({
      layout: resolveLayout(project.layout),
      frame: { focus: clip.focus, focusY: clip.focusY, zoom: clip.zoom },
      stacks: Array.isArray(stacks) ? stacks : clip.stacks,
      start: clip.start,
      end: clip.end,
      sourceDuration: project.duration,
    });
  }

  await saveProject(project);
  broadcast('project', projectSummary(project));
  res.json({ clip: { ...clip, cues: clipCues(clip) } });
}));

// ------------------------------------------------------------------ renders
const jobs = new Map();
let renderChain = Promise.resolve();

async function runRenderJob(job) {
  const project = await getProject(job.projectId);
  const clip = project?.clips?.find((item) => item.id === job.clipId);
  if (!project || !clip) {
    job.status = 'error';
    job.error = 'Clip no longer exists';
    broadcast('job', job);
    return;
  }
  const aspect = ASPECTS[job.aspect] || ASPECTS['9:16'];
  const style = resolveStyle(job.styleId, job.options || {});
  style.size = job.options?.size || 1;
  style.position = job.options?.position || 'bottom';

  const fileName = `${slug(project.name)}-clip${clip.index}-${aspect.id.replace(':', 'x')}.mp4`;
  const finalPath = path.join(EXPORT_DIR, project.id, fileName);
  const workDir = path.join(EXPORT_DIR, project.id, `.work-${job.id}`);
  const tempOutput = path.join(workDir, fileName);

  job.status = 'rendering';
  job.progress = 1;
  job.message = `Rendering ${aspect.id}`;
  job.srcWidth = project.width;
  job.srcHeight = project.height;
  job.width = aspect.width;
  job.height = aspect.height;
  broadcast('job', job);

  try {
    await fsp.mkdir(workDir, { recursive: true });
    const result = await renderClip({
      input: project.filePath,
      output: tempOutput,
      start: clip.start,
      end: clip.end,
      width: aspect.width,
      height: aspect.height,
      srcW: project.width,
      srcH: project.height,
      focus: clip.focus ?? 0.5,
      focusY: clip.focusY ?? 0.5,
      zoom: clip.zoom ?? 1,
      stacks: clip.stacks,
      sourceDuration: project.duration,
      cues: clipCues(clip),
      style,
      layout: resolveLayout(job.layout),
      hasAudio: project.hasAudio !== false,
      appendOutro: true,
      onProgress: (percent, stats = {}) => {
        if (percent !== null && percent !== undefined) job.progress = Math.round(percent);
        if (stats.speed !== null && stats.speed !== undefined) job.speed = stats.speed;
        if (stats.fps !== null && stats.fps !== undefined) job.fps = stats.fps;
        broadcast('job', job);
      },
    });
    await fsp.mkdir(path.dirname(finalPath), { recursive: true });
    // Windows refuses to rename over an existing file. Re-rendering a clip has
    // to replace the previous export instead of failing at the final step.
    await fsp.rm(finalPath, { force: true });
    await fsp.rename(tempOutput, finalPath);
    job.status = 'done';
    job.progress = 100;
    job.file = fileName;
    job.size = result.size;
    job.url = `/api/projects/${project.id}/exports/${encodeURIComponent(fileName)}`;
    project.exports = [
      ...(project.exports || []).filter((item) => item.file !== fileName),
      {
        file: fileName,
        clipId: clip.id,
        title: clip.title,
        aspect: aspect.id,
        width: aspect.width,
        height: aspect.height,
        size: result.size,
        url: job.url,
        createdAt: new Date().toISOString(),
      },
    ];
    await saveProject(project);
    job.message = 'Done';
  } catch (error) {
    job.status = 'error';
    job.error = error.message;
    job.message = 'Render failed';
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    job.finishedAt = Date.now();
    broadcast('job', job);
  }
}

const MAX_RENDER_JOBS = 200;
const JOB_TTL_MS = 10 * 60 * 1000;
function pruneJobs() {
  for (const [id, job] of jobs) {
    if (job.finishedAt && Date.now() - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

app.post('/api/projects/:id/render', requireProject(async (req, res) => {
  const project = req.project;
  if (!project.clips?.length) return res.status(400).json({ error: 'Transcribe the video first.' });
  pruneJobs();
  const requestedClipIds = Array.isArray(req.body?.clipIds) && req.body.clipIds.length
    ? req.body.clipIds.map(String)
    : project.clips.map((clip) => clip.id);
  const clipIds = [...new Set(requestedClipIds)]
    .filter((id) => project.clips.some((clip) => clip.id === id))
    .slice(0, 50);
  if (!clipIds.length) return res.status(400).json({ error: 'No valid clips selected.' });
  const aspects = [...new Set(
    Array.isArray(req.body?.aspects) && req.body.aspects.length ? req.body.aspects.map(String) : ['9:16']
  )].filter((aspect) => ASPECTS[aspect]).slice(0, 4);
  if (!aspects.length) return res.status(400).json({ error: 'No valid aspect ratio selected.' });
  if (jobs.size + clipIds.length * aspects.length > MAX_RENDER_JOBS) {
    return res.status(429).json({ error: 'Too many render jobs are already queued.' });
  }
  const styleId = req.body?.styleId;
  const options = req.body?.options || {};
  const layout = resolveLayout(req.body?.layout);

  const created = [];
  for (const clipId of clipIds) {
    const clip = project.clips.find((item) => item.id === clipId);
    if (!clip) continue;
    for (const aspect of aspects) {
      const job = {
        id: crypto.randomUUID().slice(0, 8),
        projectId: project.id,
        clipId,
        clipIndex: clip.index,
        clipTitle: clip.title,
        aspect,
        styleId,
        options,
        layout,
        status: 'queued',
        progress: 0,
        message: 'Queued',
      };
      jobs.set(job.id, job);
      created.push(job);
      renderChain = renderChain.then(() => runRenderJob(job)).catch(() => {});
    }
  }
  res.json({ jobs: created });
}));

app.get('/api/jobs', (req, res) => {
  const projectId = req.query.projectId;
  res.json({ jobs: [...jobs.values()].filter((job) => !projectId || job.projectId === projectId) });
});

app.get('/api/projects/:id/exports/:file', requireProject(async (req, res) => {
  const fileName = path.basename(req.params.file);
  const filePath = path.join(EXPORT_DIR, req.params.id, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Export not found' });
  return res.download(filePath, fileName);
}));

// ------------------------------------------------------------------ preview render
// Every preview used to share one folder, so two rapid clicks overwrote each
// other's captions.ass / font files and produced a broken or mismatched clip.
// Give each render its own scratch directory, serialise FFmpeg runs, and key the
// output by settings so an unchanged preview is served from disk instantly.
const previewDir = path.join(TMP_DIR, 'preview');
let previewChain = Promise.resolve();
const previewInflight = new Map();

async function trimOldPreviews() {
  const files = await fsp.readdir(previewDir).catch(() => []);
  const videos = files
    .filter((name) => name.endsWith('.mp4'))
    .map((name) => ({ name, at: 0 }))
    .filter((item) => !item.name.startsWith('.work-'));
  const stats = await Promise.all(
    videos.map(async (item) => {
      try {
        const stat = await fsp.stat(path.join(previewDir, item.name));
        return { ...item, at: stat.mtimeMs };
      } catch {
        return null;
      }
    })
  );
  const stale = stats.filter(Boolean).sort((a, b) => b.at - a.at).slice(8);
  await Promise.all(stale.map((item) => fsp.rm(path.join(previewDir, item.name), { force: true }).catch(() => {})));
}

app.post('/api/projects/:id/clips/:clipId/preview', requireProject(async (req, res) => {
  const project = req.project;
  const clip = project.clips?.find((item) => item.id === req.params.clipId);
  if (!clip) return res.status(404).json({ error: 'Clip not found' });
  const aspect = ASPECTS[req.body?.aspect] || ASPECTS['9:16'];
  const style = resolveStyle(req.body?.styleId, req.body?.options || {});
  const layout = resolveLayout(req.body?.layout);
  const key = JSON.stringify({ p: project.id, c: clip.id, a: aspect.id, s: style, l: layout, f: clip.focus, fy: clip.focusY, z: clip.zoom, stacks: clip.stacks, st: clip.start, en: clip.end, cues: clipCues(clip) });
  const hash = crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);
  const file = `${project.id}-${clip.id}-${aspect.id.replace(':', 'x')}-${hash}.mp4`;
  const output = path.join(previewDir, file);

  try {
    await fsp.mkdir(previewDir, { recursive: true });
    const exists = await fsp.stat(output).then(() => true).catch(() => false);
    if (!exists) {
      let work = previewInflight.get(file);
      if (!work) {
        const workDir = path.join(previewDir, `.work-${crypto.randomUUID().slice(0, 8)}`);
        await fsp.mkdir(workDir, { recursive: true });
        const scratchOutput = path.join(workDir, file);
        work = previewChain
          .then(() => renderClip({
            input: project.filePath,
            output: scratchOutput,
            start: clip.start,
            end: clip.end,
            renderDuration: Math.min(6, Math.max(0.4, clip.end - clip.start)),
            width: Math.round((aspect.width * 0.5) / 2) * 2,
            height: Math.round((aspect.height * 0.5) / 2) * 2,
            srcW: project.width,
            srcH: project.height,
            focus: clip.focus ?? 0.5,
            focusY: clip.focusY ?? 0.5,
            zoom: clip.zoom ?? 1,
            stacks: clip.stacks,
            sourceDuration: project.duration,
            cues: clipCues(clip),
            style,
            layout,
            hasAudio: project.hasAudio !== false,
            appendOutro: true,
          }))
          .then(async (result) => {
            await fsp.rm(output, { force: true });
            await fsp.rename(scratchOutput, output);
            return result;
          })
          .finally(async () => {
            await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
          });
        previewChain = work.catch(() => {});
        previewInflight.set(file, work);
      }
      try {
        await work;
      } finally {
        previewInflight.delete(file);
      }
    }
    trimOldPreviews().catch(() => {});
    return res.json({ url: `/api/previews/${file}?v=${Date.now()}` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}));

app.get('/api/previews/:file', async (req, res) => {
  const file = path.basename(req.params.file);
  const target = path.join(previewDir, file);
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat?.isFile()) return res.status(404).json({ error: 'Preview not found' });
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(target);
});

// ------------------------------------------------------------------ static
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

if (process.argv.includes('--serve-build')) {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: error.message });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`PulseCut API on http://127.0.0.1:${PORT}`);
});
