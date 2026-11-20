import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildAss } from '../shared/captions.js';
import { composeLayout } from '../shared/framing.js';
import { OUTRO_DURATION, OUTRO_BACKGROUND, OUTRO_LIME, OUTRO_INK, OUTRO_TEXT, CHANNEL, OUTRO_GEOMETRY } from '../shared/outro.js';

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

/** Chromium cannot decode HEVC, ProRes, MPEG-2 and friends, so those need a small H.264 stand-in to scrub in the browser. */
export function needsPlaybackCopy(info, file) {
  if (!PLAYABLE_CODECS.has(String(info?.videoCodec || '').toLowerCase())) return true;
  return Boolean(file) && !PLAYABLE_CONTAINERS.test(file);
}

/** Fast, low-bitrate H.264/AAC copy used only for the in-app live preview. */
export async function makePlaybackCopy(input, output, { width, height, duration, hasAudio = true, onProgress } = {}) {
  const cap = 1280;
  const srcW = Number(width) || cap;
  const srcH = Number(height) || cap;
  const ratio = Math.min(1, cap / Math.max(1, srcW), cap / Math.max(1, srcH));
  const even = (value) => Math.max(2, Math.round(value / 2) * 2);
  const outW = even(srcW * ratio);
  const outH = even(srcH * ratio);
  await fs.mkdir(path.dirname(output), { recursive: true });
  const args = [
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
function layoutGraph({ layout, width, height, srcW, srcH, frame }) {
  const plan = composeLayout({ layout, srcW, srcH, width, height, frame });
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
    const { tiles, tileH, box } = plan;
    const labels = (prefix) => Array.from({ length: tiles }, (_, index) => `[${prefix}${index}]`).join('');
    const parts = [`[0:v]split=${tiles}${labels('p')}`];
    for (let i = 0; i < tiles; i += 1) {
      parts.push(`[p${i}]${crop(box)},scale=${width}:${tileH}:flags=lanczos[t${i}]`);
    }
    parts.push(`${labels('t')}vstack=inputs=${tiles}[stacked]`);
    // Trim the rounding overshoot from the stack instead of rescaling it, so tiles stay unstretched.
    parts.push(`[stacked]crop=${width}:${height}:0:${plan.offsetY}[composed]`);
    return parts.join(';');
  }

  return `[0:v]${crop(plan.box)},scale=${width}:${height}:flags=lanczos[composed]`;
}

/** Render the animated like & subscribe end card that follows the composed clip. */
export async function renderOutro({ output, width, height, duration = OUTRO_DURATION, onProgress }) {
  const dir = path.dirname(output);
  await fs.mkdir(dir, { recursive: true });
  const fontDest = path.join(dir, 'arialbd.ttf');
  await fs.copyFile('C:\\Windows\\Fonts\\arialbd.ttf', fontDest);

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

  // `drawbox` thickness is measured inward from the edges, so half the box size
  // fills it completely. That gives a solid CTA button behind centered text.
  const filter = [
    `drawtext=fontfile=arialbd.ttf:text='${CHANNEL.handle}':fontcolor=${OUTRO_TEXT}:fontsize=${Math.round(w * geo.handle.size)}:x=(w-text_w)/2:y=${Math.round(h * geo.handle.y)}:enable='between(t,0,0.8)'`,
    `drawbox=x=${likeX}:y=${likeY}:w=${likeSize}:h=${likeSize}:color=${OUTRO_LIME}@0.92:thickness=${Math.ceil(likeSize / 2)}:enable='between(t,0.8,2)'`,
    `drawtext=fontfile=arialbd.ttf:text='${geo.like.text}':fontcolor=${OUTRO_INK}:fontsize=${Math.round(w * geo.like.textSize)}:x=(w-text_w)/2:y=${likeY + Math.round(likeSize * 0.38)}:enable='between(t,0.8,2)'`,
    `drawtext=fontfile=arialbd.ttf:text='${geo.like.counter}':fontcolor=${OUTRO_LIME}:fontsize=${Math.round(w * 0.04)}:x=(w-text_w)/2:y=${Math.round(h * geo.like.counterY)}:enable='between(t,0.8,2)'`,
    `drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=${OUTRO_LIME}@0.95:thickness=${Math.ceil(subH / 2)}:enable='between(t,2,4)'`,
    `drawtext=fontfile=arialbd.ttf:text='${geo.subscribe.text}':fontcolor=${OUTRO_INK}:fontsize=${Math.round(w * geo.subscribe.textSize)}:x=(w-text_w)/2:y=${subY + Math.round(subH * 0.22)}:enable='between(t,2,4)'`,
  ].join(',');

  const args = [
    '-hide_banner', '-y',
    '-f', 'lavfi',
    '-i', `color=c=${OUTRO_BACKGROUND}:s=${w}x${h}:d=${duration}:r=30`,
    '-vf', filter,
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

/** Render one clip with burned-in captions, reframed to the target aspect and layout, then append the outro. */
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
  cues,
  style,
  layout = 'fill',
  hasAudio = true,
  appendOutro = true,
  onProgress,
}) {
  const dir = path.dirname(output);
  await fs.mkdir(dir, { recursive: true });
  const assPath = path.join(dir, 'captions.ass');
  await fs.writeFile(assPath, buildAss({ width, height, cues, style, offset: start }), 'utf8');

  const filter = [
    layoutGraph({ layout, width, height, srcW, srcH, frame: { focus, focusY, zoom } }),
    '[composed]setsar=1,ass=captions.ass[vout]',
  ].join(';');
  const duration = Math.max(0.4, end - start);
  const args = [
    '-hide_banner', '-y',
    '-ss', String(start),
    '-i', input,
    '-t', String(duration),
    '-filter_complex', filter,
    '-map', '[vout]',
    ...(hasAudio ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-progress', 'pipe:1', '-nostats',
    output,
  ];

  await run(FFMPEG, args, {
    cwd: dir,
    onStdout: (chunk) => {
      const match = /out_time=(\d+):(\d+):([\d.]+)/.exec(chunk);
      if (match && onProgress) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        onProgress(Math.min(99, (seconds / duration) * 100));
      }
    },
  });

  // Append the animated like & subscribe end card to the composed content.
  if (appendOutro) {
    const outroPath = path.join(dir, 'outro.mp4');
    await renderOutro({ output: outroPath, width, height, duration: OUTRO_DURATION });
    const finalOut = path.join(dir, path.basename(output).replace(/\.mp4$/, '') + '-with-outro.mp4');
    const finalArgs = [
      '-hide_banner', '-y',
      '-i', output,
      '-i', outroPath,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[outv]',
      '-map', '[outv]',
      ...(hasAudio ? ['-map', '0:a?', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      finalOut,
    ];
    await run(FFMPEG, finalArgs, { cwd: dir, onStdout: (chunk) => {
      const match = /out_time=(\d+):(\d+):([\d.]+)/.exec(chunk);
      if (match && onProgress) {
        const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
        onProgress(Math.min(99, (seconds / (duration + OUTRO_DURATION)) * 100));
      }
    } });
    await fs.rm(output, { force: true });
    await fs.rename(finalOut, output);
  }

  const stats = await fs.stat(output);
  return { path: output, size: stats.size };
}

export async function makeThumb(input, output, at = 1) {
  await run(FFMPEG, ['-hide_banner', '-y', '-ss', String(at), '-i', input, '-frames:v', '1', '-vf', 'scale=480:-2', output]);
  return output;
}
