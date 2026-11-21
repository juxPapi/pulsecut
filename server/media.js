import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildAss } from '../shared/captions.js';
import { composeLayout, resolveStacks } from '../shared/framing.js';
import { OUTRO_DURATION, OUTRO_BACKGROUND, OUTRO_LIME, OUTRO_INK, OUTRO_TEXT, OUTRO_GEOMETRY } from '../shared/outro.js';

const nodeRequire = createRequire(import.meta.url);

// Resolve FFmpeg without assuming a machine-specific install path:
// FFMPEG_PATH wins, then imageio-ffmpeg (ships with many Python setups),
// then the npm-bundled binary, then whatever is on PATH.
function detectFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const python of ['python3', 'python', 'py']) {
    try {
      const out = execFileSync(
        python,
        ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }
      );
      const candidate = out.trim().split(/\r?\n/).pop()?.trim();
      if (candidate && existsSync(candidate)) return candidate;
    } catch {
      /* try the next resolver */
    }
  }
  try {
    const candidate = nodeRequire('@ffmpeg-installer/ffmpeg').path;
    if (candidate && existsSync(candidate)) return candidate;
  } catch {
    /* fall back to PATH */
  }
  return 'ffmpeg';
}

export const FFMPEG = detectFfmpeg();

let bundledProbe = 'ffprobe';
try {
  bundledProbe = nodeRequire('@ffprobe-installer/ffprobe').path;
} catch {
  /* keep the PATH lookup if the optional package is unavailable */
}
export const FFPROBE = process.env.FFPROBE_PATH || bundledProbe;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      options.onStdout?.(d.toString());
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}\n${stderr.slice(-1200)}`));
    });
  });
}

export async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const data = JSON.parse(stdout);
  const video = data.streams.find((s) => s.codec_type === 'video');
  const audio = data.streams.find((s) => s.codec_type === 'audio');
  if (!video) throw new Error('No video stream found in that file.');
  const duration = Number(data.format?.duration || video.duration || 0);
  const [num, den] = String(video.avg_frame_rate || '25/1').split('/').map(Number);
  const rotation = Math.abs(Number(video.side_data_list?.find((item) => item.rotation !== undefined)?.rotation ?? 0));
  return {
    duration,
    width: Number(video.width),
    height: Number(video.height),
    fps: den ? num / den : 25,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name,
    rotation,
    size: Number(data.format?.size || 0),
  };
}

const PLAYABLE_CODECS = new Set(['h264', 'vp8', 'vp9', 'av1']);
const PLAYABLE_CONTAINERS = /\.(mp4|m4v|mov|webm)$/i;
const FASTSTART_CONTAINERS = /\.(mp4|m4v|mov)$/i;

/**
 * A non-faststart MP4 keeps its `moov` index at the end of the file. The browser
 * then has to range-request the tail before it can seek, which makes scrubbing a
 * long stream feel frozen. Peek at the header instead of probing the whole file.
 */
export function isFaststart(file) {
  if (!file || !FASTSTART_CONTAINERS.test(file)) return false;
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, 2 * 1024 * 1024);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, 0);
    const moov = buffer.indexOf('moov');
    const mdat = buffer.indexOf('mdat');
    return moov !== -1 && (mdat === -1 || moov < mdat);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Chromium cannot decode HEVC, ProRes, MPEG-2 and friends, so those need a small H.264 stand-in to scrub in the browser. */
export function needsPlaybackCopy(info, file) {
  if (!PLAYABLE_CODECS.has(String(info?.videoCodec || '').toLowerCase())) return true;
  if (file && !PLAYABLE_CONTAINERS.test(file)) return true;
  // A playable codec can still be unusable for scrubbing when the index is at the end.
  if (file && FASTSTART_CONTAINERS.test(file) && !isFaststart(file)) return true;
  return false;
}

/** Fast, low-bitrate H.264/AAC copy used only for the in-app live preview. */
export async function makePlaybackCopy(input, output, {
  width,
  height,
  duration,
  hasAudio = true,
  videoCodec,
  sourceFile,
  onProgress,
} = {}) {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const cap = 1280;
  const srcW = Number(width) || cap;
  const srcH = Number(height) || cap;
  const ratio = Math.min(1, cap / Math.max(1, srcW), cap / Math.max(1, srcH));
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  const outW = even(srcW * ratio);
  const outH = even(srcH * ratio);

  // Playable H.264 in an MP4 only needs the index moved to the front. A stream
  // copy is seconds instead of minutes for a multi-gigabyte source.
  const canRemux = PLAYABLE_CODECS.has(String(videoCodec || '').toLowerCase())
    && FASTSTART_CONTAINERS.test(sourceFile || input);

  const args = canRemux
    ? [
        '-hide_banner', '-y',
        '-i', input,
        '-map', '0', '-dn', '-ignore_unknown',
        '-c', 'copy',
        '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats',
        output,
      ]
    : [
        '-hide_banner', '-y',
        '-i', input,
        '-vf', `scale=${outW}:${outH}:flags=bicubic,fps=30`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        '-movflags', '+faststart',
        '-progress', 'pipe:1', '-nostats',
        output,
      ];
  await run(FFMPEG, args, {
    onStdout: (chunk) => {
      const match = /out_time=(\d+):(\d+):([\d.]+)/.exec(chunk);
      if (match && duration && onProgress) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        onProgress(Math.min(99, (seconds / duration) * 100));
      }
    },
  });
  return output;
}

/** Pull a 16 kHz mono WAV out of any video for local speech recognition. */
export async function extractAudio(input, output, duration, onProgress) {
  const args = ['-hide_banner', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-progress', 'pipe:1', '-nostats', output];
  await run(FFMPEG, args, {
    onStdout: (chunk) => {
      const match = /out_time=(\d+):(\d+):([\d.]+)/.exec(chunk);
      if (match && duration && onProgress) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        onProgress(Math.min(99, (seconds / duration) * 100));
      }
    },
  });
  return output;
}

/** Compose the source into the output frame for one of the studio layouts. */
function layoutGraph({ layout, width, height, srcW, srcH, frame, stacks, tileInputs = [0] }) {
  const plan = composeLayout({ layout, srcW, srcH, width, height, frame, stacks });
  const crop = (box) => `crop=${box.cropW}:${box.cropH}:${box.x}:${box.y}`;

  if (plan.mode === 'blur') {
    const fg = plan.foreground;
    return [
      '[0:v]split=2[bg][fg]',
      `[bg]${crop(plan.backdrop)},scale=${width}:${height}:flags=bicubic,gblur=sigma=${plan.sigma.toFixed(1)}[bgb]`,
      `[fg]scale=${fg.width}:${fg.height}:flags=lanczos[fgs]`,
      `[bgb][fgs]overlay=${fg.x}:${fg.y}[composed]`,
    ].join(';');
  }

  if (plan.mode === 'tiles') {
    const { tiles, tileH, boxes } = plan;
    const labels = (prefix) => Array.from({ length: tiles }, (_, index) => `[${prefix}${index}]`).join('');
    // Stacks with the same offset share one input; a single split is cheaper
    // than decoding the same part of the source file three times.
    const splitOf = new Map();
    const parts = [];
    for (let i = 0; i < tiles; i += 1) {
      const input = tileInputs[i] || 0;
      const count = (splitOf.get(input) || 0) + 1;
      splitOf.set(input, count);
    }
    for (const [input, count] of splitOf) {
      if (count === 1) continue;
      parts.push(`[${input}:v]split=${count}${Array.from({ length: count }, (_, i) => `[s${input}_${i}]`).join('')}`);
    }
    const used = new Map();
    for (let i = 0; i < tiles; i += 1) {
      const input = tileInputs[i] || 0;
      const usedCount = used.get(input) || 0;
      used.set(input, usedCount + 1);
      const source = splitOf.get(input) > 1 ? `[s${input}_${usedCount}]` : `[${input}:v]`;
      parts.push(`${source}${crop(boxes[i])},scale=${width}:${tileH}:flags=lanczos[t${i}]`);
    }
    parts.push(`${labels('t')}vstack=inputs=${tiles}[stacked]`);
    // Trim the rounding overshoot from the stack instead of rescaling it, so tiles stay unstretched.
    parts.push(`[stacked]crop=${width}:${height}:0:${plan.offsetY}[composed]`);
    return parts.join(';');
  }

  return `[0:v]${crop(plan.box)},scale=${width}:${height}:flags=lanczos[composed]`;
}

const clampSeek = (value, min, max) => Math.min(max, Math.max(min, value));

// The end card used to hard-code C:\Windows\Fonts\arialbd.ttf, which made every
// render fail on machines without that exact font. Resolve a few known locations
// once and fall back to FFmpeg's own font selection when none is available.
const FONT_CANDIDATES = [
  process.env.OUTRO_FONT,
  'C:\\Windows\\Fonts\\arialbd.ttf',
  'C:\\Windows\\Fonts\\ariblk.ttf',
  'C:\\Windows\\Fonts\\segoeb.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
].filter(Boolean);

let fontSourcePromise = null;
async function outroFont(dir) {
  if (!fontSourcePromise) {
    fontSourcePromise = (async () => {
      for (const candidate of FONT_CANDIDATES) {
        try {
          if (existsSync(candidate)) return candidate;
        } catch {
          /* try the next one */
        }
      }
      return null;
    })();
  }
  const source = await fontSourcePromise;
  if (!source) return null;
  const dest = path.join(dir, 'outro-font.ttf');
  try {
    await fs.copyFile(source, dest);
    return 'outro-font.ttf';
  } catch {
    return null;
  }
}

/** drawtext/drawbox chain for the end card, shared by inline and standalone renders. */
function outroGraph({ width, height, fontName }) {
  const w = Math.round(width);
  const h = Math.round(height);
  const geo = OUTRO_GEOMETRY;
  const likeSize = Math.round(w * geo.like.size);
  const likeX = Math.round((w - likeSize) / 2);
  const likeY = Math.round(h * geo.like.y);
  const subW = Math.round(w * 0.46);
  const subH = Math.round(w * 0.12);
  const subX = Math.round((w - subW) / 2);
  const subY = Math.round(h * geo.subscribe.y);
  const font = fontName ? `fontfile=${fontName}` : 'font=Arial';
  const text = (value, color, size, x, y, enable) =>
    `drawtext=${font}:text='${value}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}:enable='${enable}'`;

  // drawbox thickness is measured inward from the edges, so half the box size
  // fills it completely. That gives a solid CTA button behind centered text.
  return [
    text(geo.handle.text, OUTRO_TEXT, Math.round(w * geo.handle.size), '(w-text_w)/2', Math.round(h * geo.handle.y), 'between(t,0,0.8)'),
    `drawbox=x=${likeX}:y=${likeY}:w=${likeSize}:h=${likeSize}:color=${OUTRO_LIME}@0.92:thickness=${Math.ceil(likeSize / 2)}:enable='between(t,0.8,2)'`,
    text(geo.like.text, OUTRO_INK, Math.round(w * geo.like.textSize), '(w-text_w)/2', likeY + Math.round(likeSize * 0.38), 'between(t,0.8,2)'),
    text(geo.like.counter, OUTRO_LIME, Math.round(w * 0.04), '(w-text_w)/2', Math.round(h * geo.like.counterY), 'between(t,0.8,2)'),
    `drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=${OUTRO_LIME}@0.95:thickness=${Math.ceil(subH / 2)}:enable='between(t,2,4)'`,
    text(geo.subscribe.text, OUTRO_INK, Math.round(w * geo.subscribe.textSize), '(w-text_w)/2', subY + Math.round(subH * 0.22), 'between(t,2,4)'),
  ].join(',');
}

/** Render the animated like & subscribe end card on its own (kept for callers that need just the card). */
export async function renderOutro({ output, width, height, duration = OUTRO_DURATION, onProgress }) {
  const dir = path.dirname(output);
  await fs.mkdir(dir, { recursive: true });
  const fontName = await outroFont(dir);
  const w = Math.round(width);
  const h = Math.round(height);

  const args = [
    '-hide_banner', '-y',
    '-f', 'lavfi',
    '-i', `color=c=${OUTRO_BACKGROUND}:s=${w}x${h}:d=${duration}:r=30`,
    '-vf', outroGraph({ width: w, height: h, fontName }),
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    output,
  ];
  await run(FFMPEG, args, { cwd: dir, onStdout: (chunk) => {
    const match = /out_time=(\d+):(\d+):([\d.]+)/.exec(chunk);
    if (match && duration && onProgress) {
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      onProgress(Math.min(99, (seconds / duration) * 100));
    }
  } });
  const stats = await fs.stat(output);
  return { path: output, size: stats.size };
}

/**
 * Render one clip with burned-in captions and append the outro in a single FFmpeg
 * pass. The old path encoded the clip, encoded a separate outro, then re-encoded
 * both to concatenate them — three encodes and two scratch files per export.
 */
export async function renderClip({
  input,
  output,
  start,
  end,
  width,
  height,
  srcW,
  srcH,
  focus = 0.5,
  focusY = 0.5,
  zoom = 1,
  stacks = null,
  sourceDuration = 0,
  renderDuration = null,
  cues,
  style,
  layout = 'fill',
  hasAudio = true,
  appendOutro = true,
  onProgress,
}) {
  const dir = path.dirname(output);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'captions.ass'), buildAss({ width, height, cues, style, offset: start }), 'utf8');
  const fontName = appendOutro ? await outroFont(dir) : null;

  // `end` is the clip's real out point (used for stack bounds); a burn-in
  // preview can render only a short prefix via `renderDuration`.
  const duration = Math.max(0.4, Number(renderDuration ?? (end - start)));
  const total = duration + (appendOutro ? OUTRO_DURATION : 0);
  const w = Math.round(width);
  const h = Math.round(height);

  const resolved = resolveStacks({
    layout,
    frame: { focus, focusY, zoom },
    stacks,
    start,
    end,
    sourceDuration: sourceDuration || end,
  });
  const offsets = layout === 'split' || layout === 'triple'
    ? resolved.map((stack) => stack.offset)
    : [0];
  // Equal offsets share one decoded input. The default stacks all sit at the
  // same moment, so the common case still decodes the source only once.
  const uniqueOffsets = [];
  const tileInputs = offsets.map((offset) => {
    let index = uniqueOffsets.findIndex((item) => Math.abs(item - offset) < 0.005);
    if (index < 0) {
      index = uniqueOffsets.length;
      uniqueOffsets.push(offset);
    }
    return index;
  });
  const maxSeek = Math.max(0, (sourceDuration || end) - duration);

  const parts = [
    layoutGraph({
      layout, width: w, height: h, srcW, srcH,
      frame: { focus, focusY, zoom }, stacks: resolved, tileInputs,
    }),
    '[composed]setsar=1,fps=30,format=yuv420p,ass=captions.ass[vclip]',
  ];
  const inputs = uniqueOffsets.flatMap((offset) => [
    '-ss', String(clampSeek(start + offset, 0, maxSeek)),
    '-t', String(duration),
    '-i', input,
  ]);
  // Audio always comes from the clip's real in point, never from a shifted
  // stack, so captions and sound stay aligned even when a stack is moved.
  const audioIndex = hasAudio ? uniqueOffsets.length : -1;
  if (hasAudio) {
    inputs.push('-ss', String(clampSeek(start, 0, maxSeek)), '-t', String(duration), '-i', input);
  }
  const outroIndex = uniqueOffsets.length + (hasAudio ? 1 : 0);
  if (appendOutro) {
    parts.push(`[${outroIndex}:v]${outroGraph({ width: w, height: h, fontName })},setsar=1,fps=30,format=yuv420p[voutro]`);
    parts.push('[vclip][voutro]concat=n=2:v=1:a=0[outv]');
  } else {
    parts.push('[vclip]null[outv]');
  }

  const args = [
    '-hide_banner', '-y',
    ...inputs,
    ...(appendOutro ? ['-f', 'lavfi', '-i', `color=c=${OUTRO_BACKGROUND}:s=${w}x${h}:d=${OUTRO_DURATION}:r=30`] : []),
    '-filter_complex', parts.join(';'),
    '-map', '[outv]',
    ...(hasAudio ? ['-map', `${audioIndex}:a?`, '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    output,
  ];

  // FFmpeg's -progress stream emits key=value lines that can be split across
  // stdout chunks. Buffer partial lines so out_time, fps and speed are always
  // read from a complete record.
  let pending = '';
  await run(FFMPEG, args, {
    cwd: dir,
    onStdout: (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      let percent = null;
      let fps = null;
      let speed = null;
      for (const line of lines) {
        const time = /^out_time=(\d+):(\d+):([\d.]+)/.exec(line);
        if (time) {
          const seconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
          percent = Math.min(99, (seconds / total) * 100);
        }
        const frames = /^fps=([\d.]+)/.exec(line);
        if (frames) fps = Math.round(Number(frames[1]));
        const rate = /^speed=([\d.]+)x/.exec(line);
        if (rate) speed = Number(rate[1]);
      }
      if (onProgress && (percent !== null || fps !== null || speed !== null)) {
        onProgress(percent, { fps, speed });
      }
    },
  });

  const stats = await fs.stat(output);
  return { path: output, size: stats.size };
}

export async function makeThumb(input, output, at = 1) {
  await run(FFMPEG, ['-hide_banner', '-y', '-ss', String(at), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', output]);
  return output;
}
