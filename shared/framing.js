// Framing controls (horizontal/vertical position and zoom) shared by the studio
// canvas preview and the FFmpeg renderer, so both crop the exact same rectangle.

export const FRAME_DEFAULTS = { focus: 0.5, focusY: 0.5, zoom: 1 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;

// Stacked layouts draw several source rectangles at once. Each stack keeps its
// own framing (its "angle") and its own time offset (its "portion"), so the top
// and bottom halves can show different moments of the same video together.
export const STACK_LABELS = {
  split: ['Top', 'Bottom'],
  triple: ['Top', 'Middle', 'Bottom'],
};

export function stackCount(layout) {
  return layout === 'split' ? 2 : layout === 'triple' ? 3 : 1;
}

export function stackLabels(layout) {
  return STACK_LABELS[layout] || ['Frame'];
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** Legal offset range that keeps a whole stack inside the source video. */
export function stackOffsetBounds({ start = 0, end = start, sourceDuration = 0 }) {
  const length = Math.max(0, Number(end) - Number(start));
  return {
    min: -Math.max(0, Number(start) || 0),
    max: Math.max(0, (Number(sourceDuration) || 0) - length),
  };
}

export function resolveFrame(frame) {
  // `clip` can be null before transcription produces any clips; treat null and
  // undefined the same so the preview never crashes on a freshly uploaded video.
  const { focus, focusY, zoom } = frame ?? {};
  return {
    focus: clamp(focus, 0, 1, FRAME_DEFAULTS.focus),
    focusY: clamp(focusY, 0, 1, FRAME_DEFAULTS.focusY),
    zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX, FRAME_DEFAULTS.zoom),
  };
}

/**
 * Resolve the per-stack settings for a layout. Missing stacks inherit the
 * clip's primary frame and sit at the same moment as the clip, so existing
 * projects keep looking exactly as they did before stack editing existed.
 */
export function resolveStacks({ layout, frame = {}, stacks, start = 0, end = 0, sourceDuration = 0 }) {
  const count = stackCount(layout);
  const bounds = stackOffsetBounds({ start, end, sourceDuration });
  const primary = resolveFrame(frame);
  const stored = Array.isArray(stacks) ? stacks : [];
  return Array.from({ length: count }, (_, index) => {
    const raw = stored[index] || {};
    const angle = raw.frame ? resolveFrame({ ...primary, ...raw.frame }) : { ...primary };
    const offset = clamp(raw.offset ?? 0, bounds.min, bounds.max, 0);
    return { frame: angle, offset: Math.round(offset * 100) / 100 };
  });
}

/** Source rectangle that fills the target frame at the current framing controls. */
export function frameBox(srcW, srcH, targetW, targetH, frame = {}) {
  const { focus, focusY, zoom } = resolveFrame(frame);
  const aspect = targetW / targetH;
  const wide = srcW / srcH > aspect;
  const baseW = wide ? srcH * aspect : srcW;
  const baseH = wide ? srcH : srcW / aspect;
  const cropW = Math.min(srcW, Math.max(2, Math.round(baseW / zoom / 2) * 2));
  const cropH = Math.min(srcH, Math.max(2, Math.round(baseH / zoom / 2) * 2));
  return {
    cropW,
    cropH,
    x: Math.max(0, Math.min(srcW - cropW, Math.round((srcW - cropW) * focus))),
    y: Math.max(0, Math.min(srcH - cropH, Math.round((srcH - cropH) * focusY))),
  };
}

const BLUR_WIDTH_RATIO = 0.72;
const BLUR_SIGMA_DIVISOR = 26;

function evenSize(value) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Composition plan for one layout: the single source of truth the canvas preview
 * and the FFmpeg filter graph both draw from.
 *
 * `mode` selects the drawing strategy. Source rectangles (`box`, `boxes`) are
 * cropped from the video; `foreground`, `tileH` and the overlay offsets are in
 * target-frame pixels. For stacked layouts `boxes[i]` belongs to stack `i` and
 * `offsets[i]` is that stack's time shift in seconds.
 */
export function composeLayout({ layout, srcW, srcH, width, height, frame = {}, stacks }) {
  if (layout === 'blur') {
    // The crisp copy keeps the source aspect, sits centred on a blurred,
    // full-frame backdrop, and never grows past the frame. Both renderers use
    // this exact rectangle.
    const scale = Math.min((width * BLUR_WIDTH_RATIO) / srcW, height / srcH);
    const fgW = evenSize(srcW * scale);
    const fgH = evenSize(srcH * scale);
    return {
      mode: 'blur',
      backdrop: frameBox(srcW, srcH, width, height, frame),
      foreground: {
        x: Math.round((width - fgW) / 2),
        y: Math.round((height - fgH) / 2),
        width: fgW,
        height: fgH,
      },
      sigma: width / BLUR_SIGMA_DIVISOR,
    };
  }

  if (layout === 'split' || layout === 'triple') {
    const tiles = stackCount(layout);
    // Even tile heights, rounded up so the stack always covers the full frame.
    const tileH = Math.max(2, Math.ceil(height / tiles / 2) * 2);
    const resolved =
      Array.isArray(stacks) && stacks.length >= tiles
        ? stacks
        : Array.from({ length: tiles }, () => ({ frame, offset: 0 }));
    const boxes = resolved.map((stack) => frameBox(srcW, srcH, width, tileH, stack.frame));
    return {
      mode: 'tiles',
      tiles,
      tileH,
      box: boxes[0],
      boxes,
      offsets: resolved.map((stack) => stack.offset || 0),
      stacks: resolved,
      offsetY: Math.floor((tileH * tiles - height) / 2),
    };
  }

  return { mode: 'fill', box: frameBox(srcW, srcH, width, height, frame) };
}
