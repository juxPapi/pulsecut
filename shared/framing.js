// Framing controls (horizontal/vertical position and zoom) shared by the studio
// canvas preview and the FFmpeg renderer, so both crop the exact same rectangle.

export const FRAME_DEFAULTS = { focus: 0.5, focusY: 0.5, zoom: 1 };
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
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
 * `mode` selects the drawing strategy. Source rectangles (`box`, `backdrop`) are
 * cropped from the video; `foreground`, `tileH` and the overlay offsets are in
 * target-frame pixels.
 */
export function composeLayout({ layout, srcW, srcH, width, height, frame = {} }) {
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
    const tiles = layout === 'split' ? 2 : 3;
    // Even tile heights, rounded up so the stack always covers the full frame.
    const tileH = Math.max(2, Math.ceil(height / tiles / 2) * 2);
    return {
      mode: 'tiles',
      tiles,
      tileH,
      box: frameBox(srcW, srcH, width, tileH, frame),
      offsetY: Math.floor((tileH * tiles - height) / 2),
    };
  }

  return { mode: 'fill', box: frameBox(srcW, srcH, width, height, frame) };
}
