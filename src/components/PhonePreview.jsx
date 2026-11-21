import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime } from '../api.js';
import { ASPECTS, LAYOUTS } from '../../shared/captions.js';
import {
  composeLayout,
  resolveFrame,
  resolveStacks,
  stackCount,
  stackLabels,
  stackOffsetBounds,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../../shared/framing.js';
import { OUTRO_DURATION, OUTRO_BACKGROUND, OUTRO_LIME, OUTRO_INK, OUTRO_TEXT, OUTRO_GEOMETRY } from '../../shared/outro.js';

let blurBuffer = null;

const CORNERS = ['nw', 'ne', 'sw', 'se'];
const EDGES = ['n', 'e', 's', 'w'];
const MIN_CROP = 1 / ZOOM_MAX;
const MIN_SECTION = 4;
const ANGLE_PRESETS = [
  { id: 'center', label: 'Center', frame: { focus: 0.5, focusY: 0.5, zoom: 1 } },
  { id: 'left', label: 'Left', frame: { focus: 0.24, focusY: 0.5, zoom: 1.15 } },
  { id: 'right', label: 'Right', frame: { focus: 0.76, focusY: 0.5, zoom: 1.15 } },
  { id: 'high', label: 'High', frame: { focus: 0.5, focusY: 0.24, zoom: 1.15 } },
  { id: 'low', label: 'Low', frame: { focus: 0.5, focusY: 0.76, zoom: 1.15 } },
  { id: 'close', label: 'Close', frame: { focus: 0.5, focusY: 0.5, zoom: 1.6 } },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** The draggable crop rectangle, in fractions of the preview, for a frame value. */
function cropRectFor(frame) {
  const { focus, focusY, zoom } = resolveFrame(frame);
  const size = 1 / zoom;
  return {
    size,
    left: clamp(focus - size / 2, 0, 1 - size),
    top: clamp(focusY - size / 2, 0, 1 - size),
  };
}

/**
 * Draw the blurred backdrop the same way FFmpeg builds it: crop, scale to the
 * frame, then blur with the edge pixels extended outwards. The extension lives
 * outside the visible frame and only exists so the blur kernel never samples
 * transparent pixels at the border.
 */
function drawBlurBackdrop(ctx, video, box, width, height, sigma) {
  const pad = Math.ceil(sigma * 3);
  const outerW = width + pad * 2;
  const outerH = height + pad * 2;

  if (!blurBuffer) blurBuffer = document.createElement('canvas');
  // The result is blurred, so full device-pixel resolution is wasted work.
  // Rendering the scratch buffer at 1x cuts the blur cost by up to 4x on
  // high-DPI screens with no visible difference.
  const pixelW = Math.ceil(outerW);
  const pixelH = Math.ceil(outerH);
  if (blurBuffer.width !== pixelW || blurBuffer.height !== pixelH) {
    blurBuffer.width = pixelW;
    blurBuffer.height = pixelH;
  }

  const buffer = blurBuffer.getContext('2d');
  buffer.setTransform(1, 0, 0, 1, 0, 0);
  buffer.clearRect(0, 0, outerW, outerH);
  buffer.imageSmoothingQuality = 'high';

  const { x, y, cropW, cropH } = box;
  buffer.drawImage(video, x, y, cropW, cropH, pad, pad, width, height);
  // Clamp the crop's edge pixels outwards, matching FFmpeg's gblur border handling.
  buffer.drawImage(video, x, y, 1, cropH, 0, pad, pad, height);
  buffer.drawImage(video, x + cropW - 1, y, 1, cropH, width + pad, pad, pad, height);
  buffer.drawImage(video, x, y, cropW, 1, pad, 0, width, pad);
  buffer.drawImage(video, x, y + cropH - 1, cropW, 1, pad, height + pad, width, pad);
  buffer.drawImage(video, x, y, 1, 1, 0, 0, pad, pad);
  buffer.drawImage(video, x + cropW - 1, y, 1, 1, width + pad, 0, pad, pad);
  buffer.drawImage(video, x, y + cropH - 1, 1, 1, 0, height + pad, pad, pad);
  buffer.drawImage(video, x + cropW - 1, y + cropH - 1, 1, 1, width + pad, height + pad, pad, pad);

  ctx.save();
  ctx.filter = `blur(${sigma.toFixed(1)}px)`;
  ctx.drawImage(blurBuffer, -pad, -pad, outerW, outerH);
  ctx.restore();
}

/**
 * Paint the animated like & subscribe end card, mirroring the FFmpeg outro so
 * the live canvas and the export agree on where the end card lands.
 */
function drawOutro(ctx, width, height, progress) {
  const w = width;
  const h = height;
  const geo = OUTRO_GEOMETRY;

  ctx.save();
  ctx.fillStyle = OUTRO_BACKGROUND;
  ctx.fillRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Same timed beats as the FFmpeg outro: handle, like, subscribe.
  if (progress < 0.2) {
    ctx.font = `700 ${Math.round(w * geo.handle.size)}px Arial`;
    ctx.fillStyle = OUTRO_TEXT;
    ctx.fillText(geo.handle.text, w / 2, h * geo.handle.y);
  } else if (progress < 0.5) {
    const size = w * geo.like.size;
    const x = (w - size) / 2;
    const y = h * geo.like.y;
    ctx.fillStyle = OUTRO_LIME;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = OUTRO_INK;
    ctx.font = `900 ${Math.round(w * geo.like.textSize)}px Arial`;
    ctx.fillText(geo.like.text, w / 2, y + size * 0.38);
    ctx.fillStyle = OUTRO_LIME;
    ctx.font = `700 ${Math.round(w * 0.04)}px Arial`;
    ctx.fillText(geo.like.counter, w / 2, h * geo.like.counterY);
  } else {
    const subW = w * 0.46;
    const subH = w * 0.12;
    const x = (w - subW) / 2;
    const y = h * geo.subscribe.y;
    ctx.fillStyle = OUTRO_LIME;
    ctx.fillRect(x, y, subW, subH);
    ctx.fillStyle = OUTRO_INK;
    ctx.font = `900 ${Math.round(w * geo.subscribe.textSize)}px Arial`;
    ctx.fillText(geo.subscribe.text, w / 2, y + subH * 0.22);
  }

  ctx.restore();
}

export default function PhonePreview({
  project,
  clip,
  aspect,
  onAspect,
  layout = 'fill',
  onLayout,
  style,
  options,
  playhead,
  onPlayhead,
  onFrame,
  onCaption,
  onTranscribe,
  transcribing,
}) {
  const videoRefs = useRef([]);
  const canvasRef = useRef(null);
  const frameSurfaceRef = useRef(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [stacks, setStacks] = useState(() =>
    resolveStacks({
      layout,
      frame: clip || {},
      stacks: clip?.stacks,
      start: clip?.start ?? 0,
      end: clip?.end ?? 0,
      sourceDuration: project?.duration ?? 0,
    })
  );
  const [activeStack, setActiveStack] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [section, setSection] = useState(() => ({ start: clip?.start ?? 0, end: clip?.end ?? 0 }));
  const [sectionError, setSectionError] = useState(null);
  const [offsetDrafts, setOffsetDrafts] = useState({});
  const [captionDragging, setCaptionDragging] = useState(false);
  const [captionMoving, setCaptionMoving] = useState(false);

  const aspectInfo = ASPECTS[aspect] || ASPECTS['16:9'];
  const playback = project?.playback || null;
  const videoSrc = project ? `/api/media/${project.id}${playback?.status === 'ready' ? `?v=${playback.version}` : ''}` : '';
  const tiles = stackCount(layout);
  const labels = stackLabels(layout);
  const activeStackRef = useRef(activeStack);
  activeStackRef.current = Math.min(activeStack, tiles - 1);
  const stacksRef = useRef(stacks);
  stacksRef.current = stacks;
  const frameValue = stacks[Math.min(activeStack, stacks.length - 1)]?.frame || resolveFrame(clip);
  const frameRef = useRef(frameValue);
  frameRef.current = frameValue;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Each distinct source offset gets its own video element, so two stacks can
  // play different moments at once. Equal offsets reuse one decoded video.
  const groups = useMemo(() => {
    const list = [];
    stacks.forEach((stack, index) => {
      const offset = stack.offset || 0;
      let group = list.find((item) => Math.abs(item.offset - offset) < 0.005);
      if (!group) {
        group = { offset, key: offset.toFixed(2), indices: [] };
        list.push(group);
      }
      group.indices.push(index);
    });
    return list;
  }, [stacks]);
  const groupOf = useMemo(
    () => stacks.map((stack) => groups.findIndex((group) => Math.abs(group.offset - (stack.offset || 0)) < 0.005)),
    [stacks, groups]
  );
  const groupOfRef = useRef(groupOf);
  groupOfRef.current = groupOf;
  const activeGroups = previewUrl ? [{ offset: 0, key: 'burn', indices: [0] }] : groups;
  const primaryOffsetRef = useRef(previewUrl ? 0 : stacks[0]?.offset || 0);
  primaryOffsetRef.current = previewUrl ? 0 : stacks[0]?.offset || 0;
  // The burn-in preview is a short standalone file; its transport uses that
  // file's 0-based timeline instead of the full source clip's in/out points.
  const trackStart = previewUrl ? 0 : clip?.start ?? 0;
  const trackEnd = previewUrl
    ? Math.min(clip?.end - clip?.start || 0, 6) + OUTRO_DURATION
    : clip?.end ?? 0;

  const drawnRef = useRef({});
  const compositionKeyRef = useRef('');
  const contentEndRef = useRef(0);
  const lastEmittedRef = useRef(null);
  const dragRef = useRef(null);
  const captionDragRef = useRef(null);
  const frameRafRef = useRef(0);
  const pendingFrameRef = useRef(null);
  const wheelCommitRef = useRef(0);
  const trackSeekingRef = useRef(false);
  const timeUpdateRef = useRef(() => {});
  const painterRef = useRef({ start: () => {}, stop: () => {} });

  const primaryVideo = () => videoRefs.current[0] || null;
  const allVideos = () => videoRefs.current.filter(Boolean);

  // Remember the value we reported to the parent so a re-render with that same
  // playhead cannot turn into a second seek back into the video.
  const emitPlayhead = (time) => {
    lastEmittedRef.current = time;
    onPlayhead(time);
  };

  /** Seek every decoded surface to the same master moment plus its own offset. */
  const seekAll = (time) => {
    if (!Number.isFinite(time)) return;
    const max = Math.max(0.1, (project?.duration || time) - 0.02);
    activeGroups.forEach((group, index) => {
      const video = videoRefs.current[index];
      if (!video) return;
      const target = clamp(time + group.offset, 0.001, max);
      if (Math.abs(video.currentTime - target) < 0.05) return;
      video.currentTime = target;
    });
  };

  // Two <video> elements can drift apart even when they play the same file.
  // Nudge secondary surfaces back to their offset on the primary's timeupdate.
  const syncStacks = (master) => {
    if (previewUrl || !Number.isFinite(master)) return;
    const max = Math.max(0.1, (project?.duration || master) - 0.02);
    activeGroups.forEach((group, index) => {
      if (index === 0) return;
      const video = videoRefs.current[index];
      if (!video) return;
      const target = clamp(master + group.offset, 0.001, max);
      if (Math.abs(video.currentTime - target) > 0.25) video.currentTime = target;
    });
  };

  const pauseAll = () => {
    allVideos().forEach((video) => video.pause());
    setPlaying(false);
  };

  const goTo = (time) => {
    const target = clamp(Number(time) || 0, trackStart, trackEnd || Number(time) || 0);
    pauseAll();
    seekAll(target);
    emitPlayhead(target);
    drawnRef.current.stamp = null;
    draw();
  };

  const writeStacks = (next) => {
    stacksRef.current = next;
    setStacks(next);
  };

  // Coalesce drag/keyboard/wheel changes to one React render per animation frame.
  const applyStackFrame = (value, persist) => {
    const index = Math.min(activeStackRef.current, stacksRef.current.length - 1);
    const next = stacksRef.current.map((stack, i) =>
      i === index ? { ...stack, frame: value } : stack
    );
    writeStacks(next);
    if (persist && clip) {
      const patch = { stacks: next };
      // The clip's primary framing still follows the top/single stack.
      if (index === 0) Object.assign(patch, value);
      onFrame?.(patch);
    }
  };

  const updateFrame = (patch) => {
    pendingFrameRef.current = { ...(pendingFrameRef.current || frameRef.current), ...patch };
    if (frameRafRef.current) return;
    frameRafRef.current = requestAnimationFrame(() => {
      frameRafRef.current = 0;
      const next = resolveFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
      frameRef.current = next;
      applyStackFrame(next, false);
    });
  };

  // One PATCH per gesture: pointerup, keyup or the end of a wheel burst.
  const commitFrame = (fallback) => {
    const value = resolveFrame(pendingFrameRef.current || fallback || frameRef.current);
    if (frameRafRef.current) cancelAnimationFrame(frameRafRef.current);
    frameRafRef.current = 0;
    pendingFrameRef.current = null;
    frameRef.current = value;
    applyStackFrame(value, true);
  };

  const resetFrame = () => {
    const next = resolveFrame({});
    if (frameRafRef.current) cancelAnimationFrame(frameRafRef.current);
    frameRafRef.current = 0;
    pendingFrameRef.current = null;
    frameRef.current = next;
    applyStackFrame(next, true);
  };

  const applyPreset = (preset) => {
    if (!clip || previewUrl) return;
    commitFrame(resolveFrame(preset.frame));
  };

  const updateStackOffset = (index, raw) => {
    if (!clip || previewUrl) return;
    const bounds = stackOffsetBounds({
      start: clip.start,
      end: clip.end,
      sourceDuration: project?.duration ?? clip.end,
    });
    const offset = Math.round(clamp(Number(raw) || 0, bounds.min, bounds.max) * 100) / 100;
    const next = stacksRef.current.map((stack, i) => (i === index ? { ...stack, offset } : stack));
    writeStacks(next);
    setOffsetDrafts((prev) => ({ ...prev, [index]: undefined }));
    onFrame?.({ stacks: next });
    seekAll(playheadRef.current);
    drawnRef.current.stamp = null;
    draw();
  };

  const resetStacks = () => {
    if (!clip || previewUrl) return;
    const primary = resolveFrame(clip);
    const next = stacksRef.current.map(() => ({ frame: { ...primary }, offset: 0 }));
    writeStacks(next);
    setOffsetDrafts({});
    onFrame?.({ stacks: null, ...primary });
    seekAll(playheadRef.current);
    drawnRef.current.stamp = null;
    draw();
  };

  // Editing the in/out points drops a different slice of the source into the
  // same preset frame. The server snaps them to real speech before rendering.
  const commitSection = (patch) => {
    const duration = project?.duration || Number.MAX_SAFE_INTEGER;
    const start = clamp(Number(patch.start ?? section.start), 0, duration);
    const end = clamp(Number(patch.end ?? section.end), 0, duration);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < MIN_SECTION) {
      setSectionError(`Keep at least ${MIN_SECTION} seconds.`);
      return;
    }
    setSectionError(null);
    setSection({ start, end });
    onFrame?.({ start, end });
    seekAll(start);
    emitPlayhead(start);
  };

  const usePlayheadFor = (edge) => {
    const time = clamp(playhead, 0, project?.duration || playhead);
    if (edge === 'in') {
      commitSection({ start: time, end: Math.max(section.end, time + MIN_SECTION) });
    } else {
      commitSection({ start: Math.min(section.start, time - MIN_SECTION), end: time });
    }
  };

  useEffect(
    () => () => {
      if (frameRafRef.current) cancelAnimationFrame(frameRafRef.current);
      if (wheelCommitRef.current) clearTimeout(wheelCommitRef.current);
    },
    []
  );

  const pointerPosition = (event) => {
    const rect = frameSurfaceRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const beginFrameDrag = (mode, handle = null) => (event) => {
    if (!clip || previewUrl || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* older browsers can still drag without capture */
    }
    dragRef.current = {
      mode,
      handle,
      pointerId: event.pointerId,
      start: pointerPosition(event),
      frame: resolveFrame(frameRef.current),
      box: cropRectFor(frameRef.current),
    };
  };

  const moveFrameDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = pointerPosition(event);

    if (drag.mode === 'pan') {
      updateFrame({
        focus: clamp(drag.frame.focus + point.x - drag.start.x, 0, 1),
        focusY: clamp(drag.frame.focusY + point.y - drag.start.y, 0, 1),
      });
      return;
    }

    // Edge handles slide one axis at a time. This gives dedicated horizontal
    // and vertical framing without changing the crop size.
    if (drag.mode === 'edge') {
      if (drag.handle === 'e' || drag.handle === 'w') {
        updateFrame({ focus: clamp(drag.frame.focus + point.x - drag.start.x, 0, 1) });
      } else {
        updateFrame({ focusY: clamp(drag.frame.focusY + point.y - drag.start.y, 0, 1) });
      }
      return;
    }

    const signX = drag.handle.includes('w') ? -1 : 1;
    const signY = drag.handle.includes('n') ? -1 : 1;
    const opposite = {
      x: signX > 0 ? drag.box.left : drag.box.left + drag.box.size,
      y: signY > 0 ? drag.box.top : drag.box.top + drag.box.size,
    };
    const dx = (point.x - drag.start.x) * signX;
    const dy = (point.y - drag.start.y) * signY;
    const size = clamp(drag.box.size + (dx + dy) / 2, MIN_CROP, 1);
    const left = clamp(signX > 0 ? opposite.x : opposite.x - size, 0, 1 - size);
    const top = clamp(signY > 0 ? opposite.y : opposite.y - size, 0, 1 - size);
    updateFrame({
      zoom: 1 / size,
      focus: left + size / 2,
      focusY: top + size / 2,
    });
  };

  const endFrameDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* capture is optional */
    }
    commitFrame();
  };

  const handleFrameKeyDown = (event) => {
    const deltas = {
      ArrowLeft: [-0.02, 0],
      ArrowRight: [0.02, 0],
      ArrowUp: [0, -0.02],
      ArrowDown: [0, 0.02],
    };
    const delta = deltas[event.key];
    if (!delta || !clip || previewUrl) return;
    event.preventDefault();
    const step = event.shiftKey ? 2.5 : 1;
    updateFrame({
      focus: clamp(frameRef.current.focus + delta[0] * step, 0, 1),
      focusY: clamp(frameRef.current.focusY + delta[1] * step, 0, 1),
    });
    commitFrame();
  };

  const handleFrameWheel = (event) => {
    if (!clip || previewUrl || !event.deltaY) return;
    const next = clamp(frameRef.current.zoom - event.deltaY * 0.0015, ZOOM_MIN, ZOOM_MAX);
    updateFrame({ zoom: Math.round(next * 1000) / 1000 });
    if (wheelCommitRef.current) clearTimeout(wheelCommitRef.current);
    wheelCommitRef.current = setTimeout(() => commitFrame(), 140);
  };

  /** Paint every stack from its own video surface with the shared layout math. */
  const draw = useCallback(() => {
    const videos = videoRefs.current.filter(Boolean);
    const primary = videos[0];
    const canvas = canvasRef.current;
    if (!primary || !canvas || !primary.videoWidth) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const active = layoutRef.current;
    const currentStacks = stacksRef.current;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const times = videos.map((video) => video.currentTime.toFixed(3)).join(',');
    const angles = currentStacks
      .map((stack) => `${stack.frame.focus}|${stack.frame.focusY}|${stack.frame.zoom}|${stack.offset}`)
      .join('|');
    const stamp = `${times}|${active}|${angles}|${activeStackRef.current}|${pixelWidth}x${pixelHeight}`;
    if (drawnRef.current.stamp === stamp) return;
    drawnRef.current.stamp = stamp;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = 'none';

    const plan = composeLayout({
      layout: active,
      srcW: primary.videoWidth,
      srcH: primary.videoHeight,
      width,
      height,
      frame: currentStacks[0]?.frame || {},
      stacks: currentStacks,
    });
    const master = primary.currentTime - primaryOffsetRef.current;
    const outroActive = contentEndRef.current > 0 && master >= contentEndRef.current;
    const outroProgress = outroActive
      ? Math.min(1, (master - contentEndRef.current) / OUTRO_DURATION)
      : 0;

    if (plan.mode === 'fill') {
      const { box } = plan;
      ctx.drawImage(primary, box.x, box.y, box.cropW, box.cropH, 0, 0, width, height);
      if (outroActive) drawOutro(ctx, width, height, outroProgress);
      return;
    }

    if (plan.mode === 'blur') {
      const { backdrop, foreground, sigma } = plan;
      drawBlurBackdrop(ctx, primary, backdrop, width, height, sigma);
      ctx.drawImage(primary, 0, 0, primary.videoWidth, primary.videoHeight, foreground.x, foreground.y, foreground.width, foreground.height);
      if (outroActive) drawOutro(ctx, width, height, outroProgress);
      return;
    }

    const { boxes, tiles: count, tileH, offsetY } = plan;
    for (let index = 0; index < count; index += 1) {
      const box = boxes[index];
      const video = videos[groupOfRef.current[index] || 0] || primary;
      if (!video.videoWidth) continue;
      ctx.drawImage(video, box.x, box.y, box.cropW, box.cropH, 0, index * tileH - offsetY, width, tileH);
    }
    // Highlight the band being edited so "Top" / "Bottom" controls are obvious.
    const selected = Math.min(activeStackRef.current, count - 1);
    ctx.save();
    ctx.strokeStyle = 'rgba(200, 255, 61, 0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, selected * tileH - offsetY + 1, width - 2, tileH - 2);
    ctx.restore();
    if (outroActive) drawOutro(ctx, width, height, outroProgress);
  }, []);

  timeUpdateRef.current = () => {
    const video = primaryVideo();
    if (!video || !clip) return;
    if (previewUrl) {
      const loopEnd = Math.min(clip.end, clip.start + 6) + OUTRO_DURATION;
      if (video.currentTime >= loopEnd - 0.03) {
        video.currentTime = 0.001;
        emitPlayhead(0.001);
        return;
      }
      emitPlayhead(video.currentTime);
      return;
    }
    const master = video.currentTime - primaryOffsetRef.current;
    const loopEnd = contentEndRef.current + OUTRO_DURATION;
    // The like & subscribe end card runs after the content, then playback loops.
    if (loopEnd > 0 && master >= loopEnd - 0.03) {
      seekAll(clip.start);
      emitPlayhead(clip.start);
      return;
    }
    syncStacks(master);
    emitPlayhead(master);
  };

  // Paint on presented video frames instead of a permanent 60 fps loop. Canvas
  // blur/stack work is expensive and used to stall the whole editor.
  useEffect(() => {
    painterRef.current.stop();
    if (!playing || previewUrl) {
      draw();
      return undefined;
    }
    const videos = allVideos();
    let frame = 0;
    let stopped = false;
    const callbacks = new Map();
    const loop = () => {
      if (stopped) return;
      draw();
      frame = requestAnimationFrame(loop);
    };
    const supportsFrames = videos.some((video) => typeof video.requestVideoFrameCallback === 'function');
    if (supportsFrames) {
      videos.forEach((video) => {
        if (typeof video.requestVideoFrameCallback !== 'function') return;
        const onVideoFrame = () => {
          if (stopped) return;
          draw();
          callbacks.set(video, video.requestVideoFrameCallback(onVideoFrame));
        };
        callbacks.set(video, video.requestVideoFrameCallback(onVideoFrame));
      });
    } else {
      loop();
    }
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      for (const [video, callback] of callbacks) {
        if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(callback);
      }
      callbacks.clear();
    };
    painterRef.current.stop = stop;
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, previewUrl, groups.map((group) => group.key).join('|'), draw]);

  // Repaint when the composition itself changes.
  useEffect(() => {
    drawnRef.current.stamp = null;
    draw();
  }, [draw, layout, stacks, activeStack, previewUrl]);

  // A canvas resize does not emit a video frame while paused.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const observer = new ResizeObserver(() => {
      drawnRef.current.stamp = null;
      draw();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  // Switching clips/layouts rebuilds the stack list from the saved clip data.
  // Saving a stack edit also changes clip.stacks; that must refresh the values
  // without throwing the playhead back to the start of the clip.
  useEffect(() => {
    const next = resolveStacks({
      layout,
      frame: clip || {},
      stacks: clip?.stacks,
      start: clip?.start ?? 0,
      end: clip?.end ?? 0,
      sourceDuration: project?.duration ?? 0,
    });
    writeStacks(next);
    setOffsetDrafts({});
    setActiveStack((current) => Math.min(current, next.length - 1));
    const key = `${clip?.id || ''}|${layout}|${project?.duration || 0}`;
    if (compositionKeyRef.current === key) return;
    compositionKeyRef.current = key;
    setPreviewUrl(null);
    setPreviewError(null);
    const video = primaryVideo();
    if (video && clip && !previewUrl) {
      seekAll(clip.start);
      setPlaying(false);
      emitPlayhead(clip.start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id, clip?.stacks, layout, project?.duration]);

  // Keep the section fields in step with the server's snapped in/out points.
  useEffect(() => {
    setSection({ start: clip?.start ?? 0, end: clip?.end ?? 0 });
    setSectionError(null);
  }, [clip?.id, clip?.start, clip?.end]);

  // The like & subscribe end card starts right after the content being previewed or played.
  useEffect(() => {
    if (!clip) {
      contentEndRef.current = 0;
      return;
    }
    contentEndRef.current = previewUrl ? Math.min(clip.end, clip.start + 6) : clip.end;
  }, [clip?.id, clip?.end, previewUrl]);

  // Only external playhead changes (a transcript click, choosing a clip) should
  // seek the video. Playhead updates we emitted ourselves must not bounce back as
  // a second seek — that fight is what made editing playback stutter and freeze.
  useEffect(() => {
    if (!clip || playing || previewUrl) return;
    if (playhead === lastEmittedRef.current) return;
    const video = primaryVideo();
    const master = video ? video.currentTime - primaryOffsetRef.current : 0;
    if (Math.abs(master - playhead) < 0.05) return;
    seekAll(playhead);
    drawnRef.current.stamp = null;
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, clip, previewUrl]);

  // A rebuilt video reloads at 0:00; seeking is ignored until metadata exists,
  // so restore from the load event instead of a timer.
  const restoreFor = (index) => {
    if (previewUrl || !clip) return;
    const group = activeGroups[index];
    const video = videoRefs.current[index];
    if (!group || !video) return;
    const max = Math.max(0.1, (project?.duration || playheadRef.current) - 0.02);
    const target = clamp(playheadRef.current + group.offset, 0.001, max);
    if (Math.abs(video.currentTime - target) >= 0.05) video.currentTime = target;
    drawnRef.current.stamp = null;
    draw();
  };

  const toggle = async () => {
    const videos = allVideos();
    if (!videos.length) return;
    if (videos[0].paused) {
      if (clip && !previewUrl) {
        const master = videos[0].currentTime - primaryOffsetRef.current;
        const loopEnd = contentEndRef.current + OUTRO_DURATION;
        // Re-align every surface to the playhead before resuming, then let
        // timeupdate corrections keep them together during playback.
        seekAll(master < clip.start || master >= loopEnd - 0.1 ? clip.start : master);
      }
      await Promise.all(videos.map((video) => video.play().catch(() => {})));
      setPlaying(true);
    } else {
      pauseAll();
    }
  };

  const seekFromTrack = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !clip) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    goTo(trackStart + ratio * Math.max(0, trackEnd - trackStart));
  };

  const beginTrackSeek = (event) => {
    if (event.button !== 0 || !clip) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional */
    }
    trackSeekingRef.current = true;
    seekFromTrack(event);
  };

  const endTrackSeek = (event) => {
    trackSeekingRef.current = false;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* capture is optional */
    }
  };

  const handleTrackKeyDown = (event) => {
    if (!clip) return;
    const delta = { ArrowLeft: -0.5, ArrowRight: 0.5 }[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      goTo(playhead + delta);
    } else if (event.key === 'Home') {
      event.preventDefault();
      goTo(trackStart);
    } else if (event.key === 'End') {
      event.preventDefault();
      goTo(trackEnd);
    }
  };

  const cue = useMemo(() => {
    const cues = clip?.cues || [];
    return cues.find((item) => playhead >= item.start - 0.04 && playhead <= item.end + 0.12) || null;
  }, [clip, playhead]);

  const hotIndex = useMemo(() => {
    if (!cue) return -1;
    let index = -1;
    cue.words.forEach((word, position) => {
      if (playhead >= word.start - 0.02) index = position;
    });
    return index;
  }, [cue, playhead]);

  const manualCaption =
    style?.captionX !== null && style?.captionX !== undefined &&
    style?.captionY !== null && style?.captionY !== undefined &&
    Number.isFinite(Number(style.captionX)) && Number.isFinite(Number(style.captionY));

  const captionStyle = {
    fontFamily: `'${style.font}', system-ui, sans-serif`,
    color: style.color,
    fontSize: `${18 * (style.size || 1)}px`,
    textTransform: style.uppercase ? 'uppercase' : 'none',
    opacity: style.opacity ?? 1,
    transform: manualCaption
      ? `translate(-50%, -50%) rotate(${style.tilt || 0}deg)`
      : `rotate(${style.tilt || 0}deg)`,
    WebkitTextStroke: style.outlineWidth ? `${Math.min(2.4, style.outlineWidth * 0.42)}px ${style.outline}` : '0',
    paintOrder: 'stroke fill',
    textShadow: style.shadow
      ? `0 ${Math.round(style.shadow / 2)}px ${style.shadow}px rgba(0,0,0,0.65)`
      : 'none',
    background: style.box
      ? `color-mix(in srgb, ${style.box} ${Math.round((style.boxOpacity ?? 0.88) * 100)}%, transparent)`
      : 'transparent',
    padding: style.box ? '4px 9px' : '0',
    borderRadius: style.box ? '5px' : '0',
    ...(manualCaption
      ? { position: 'absolute', left: `${Number(style.captionX) * 100}%`, top: `${Number(style.captionY) * 100}%` }
      : {}),
  };

  const captionPosition =
    style.position === 'top' ? 'flex-start' : style.position === 'middle' ? 'center' : 'flex-end';

  const beginCaptionDrag = (event) => {
    if (!manualCaption || !captionMoving || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional */
    }
    captionDragRef.current = {
      pointerId: event.pointerId,
      start: pointerPosition(event),
      x: Number(style.captionX),
      y: Number(style.captionY),
    };
    setCaptionDragging(true);
  };

  const moveCaptionDrag = (event) => {
    const drag = captionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = pointerPosition(event);
    onCaption?.({
      x: clamp(drag.x + point.x - drag.start.x, 0.03, 0.97),
      y: clamp(drag.y + point.y - drag.start.y, 0.03, 0.97),
    });
  };

  const endCaptionDrag = (event) => {
    const drag = captionDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    captionDragRef.current = null;
    setCaptionDragging(false);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      /* capture is optional */
    }
  };

  const renderBurnIn = async () => {
    if (!clip) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const { url } = await api(`/api/projects/${project.id}/clips/${clip.id}/preview`, {
        method: 'POST',
        body: JSON.stringify({ aspect, styleId: style.id, options, layout }),
      });
      setPreviewUrl(url);
      setPlaying(false);
      emitPlayhead(0);
    } catch (error) {
      setPreviewError(error.message);
    } finally {
      setPreviewing(false);
    }
  };

  const cropRect = cropRectFor(frameValue);
  const tileTop = Math.min(activeStack, tiles - 1) / tiles;
  const cropStyle = {
    left: `${cropRect.left * 100}%`,
    top: `${(tileTop + cropRect.top / tiles) * 100}%`,
    width: `${cropRect.size * 100}%`,
    height: `${(cropRect.size / tiles) * 100}%`,
  };

  return (
    <section className="preview">
      <div className="preview-head">
        <div className="preview-controls">
          <div className="aspect-switch" role="group" aria-label="Preview format">
            {Object.values(ASPECTS).map((item) => (
              <button
                key={item.id}
                type="button"
                className={aspect === item.id ? 'active' : ''}
                onClick={() => onAspect(item.id)}
                title={`${item.label} · ${item.width}×${item.height}`}
                aria-pressed={aspect === item.id}
              >
                {item.id}
              </button>
            ))}
          </div>
          <div className="layout-switch" role="group" aria-label="Video layout">
            {LAYOUTS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={layout === item.id ? 'active' : ''}
                onClick={() => onLayout?.(item.id)}
                title={item.hint}
                aria-label={item.label}
                aria-pressed={layout === item.id}
              >
                <span className={`layout-icon icon-${item.id}`} aria-hidden="true" />
                <span className="layout-label">{item.label}</span>
              </button>
            ))}
          </div>
          {tiles > 1 && (
            <div className="stack-switch" role="group" aria-label="Stack being edited">
              {labels.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={activeStack === index ? 'active' : ''}
                  onClick={() => setActiveStack(index)}
                  aria-pressed={activeStack === index}
                  title={`Edit the ${label.toLowerCase()} stack`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="preview-head-right">
          <span className="muted-label">
            {aspectInfo.width}×{aspectInfo.height} · {aspectInfo.short}
          </span>
          <button
            className={`btn ghost small ${transcribing ? 'is-working' : ''}`}
            onClick={onTranscribe}
            disabled={!project || transcribing}
            type="button"
          >
            {transcribing ? 'Generating…' : clip?.cues?.length ? 'Regenerate transcription' : 'Generate transcription'}
          </button>
          <button
            className={`btn ghost small ${captionMoving ? 'is-working' : ''}`}
            onClick={() => setCaptionMoving((value) => !value)}
            disabled={!clip || Boolean(previewUrl)}
            type="button"
            title="Drag the captions anywhere in the preview"
          >
            {captionMoving ? 'Done moving' : 'Move captions'}
          </button>
          <button className="btn ghost small" onClick={renderBurnIn} disabled={!clip || previewing} type="button">
            {previewing ? 'Rendering…' : 'Burn-in preview'}
          </button>
        </div>
      </div>

      <div className="frame-stage">
        <div className="edit-frame" style={{ '--frame-ratio': aspectInfo.width / aspectInfo.height }}>
          <div className="frame-screen" style={{ aspectRatio: `${aspectInfo.width} / ${aspectInfo.height}` }}>
            {previewUrl ? (
              <video
                ref={(element) => { videoRefs.current[0] = element; }}
                className="frame-video"
                src={previewUrl}
                playsInline
                preload="auto"
                muted={muted}
                onTimeUpdate={() => { timeUpdateRef.current(); draw(); }}
                onSeeked={() => draw()}
                onLoadedMetadata={() => restoreFor(0)}
                onEnded={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
              />
            ) : (
              activeGroups.map((group, index) => (
                <video
                  key={group.key}
                  ref={(element) => { videoRefs.current[index] = element; }}
                  className="frame-video"
                  src={videoSrc}
                  playsInline
                  preload="auto"
                  // Only the primary surface carries sound; extra stacks are
                  // alternate angles of the same audio, not separate tracks.
                  muted={muted || index > 0}
                  onTimeUpdate={() => { if (index === 0) timeUpdateRef.current(); draw(); }}
                  onSeeked={() => draw()}
                  onLoadedMetadata={() => restoreFor(index)}
                  onEnded={() => index === 0 && setPlaying(false)}
                  onPlay={() => index === 0 && setPlaying(true)}
                  onPause={() => index === 0 && setPlaying(false)}
                  style={{ visibility: 'hidden' }}
                />
              ))
            )}
            {!previewUrl && <canvas ref={canvasRef} className="frame-canvas" />}
            {!previewUrl && (
              <div
                className={`caption-layer ${captionMoving && manualCaption ? 'interactive' : ''}`}
                style={manualCaption ? undefined : { justifyContent: captionPosition }}
              >
                {cue ? (
                  <div
                    className={`caption-text ${captionMoving && manualCaption ? 'draggable' : ''} ${captionDragging ? 'dragging' : ''}`}
                    style={captionStyle}
                    key={cue.start}
                    onPointerDown={beginCaptionDrag}
                    onPointerMove={moveCaptionDrag}
                    onPointerUp={endCaptionDrag}
                    onPointerCancel={endCaptionDrag}
                  >
                    {cue.words.map((word, index) => (
                      <span
                        key={`${word.start}-${index}`}
                        style={{ color: index === hotIndex ? style.accent : style.color }}
                      >
                        {word.text}{' '}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="caption-idle">
                    {playback?.status === 'converting'
                      ? 'Preparing a browser preview…'
                      : transcribing
                        ? 'Transcribing…'
                        : captionMoving
                          ? 'Drag a caption to place it'
                          : 'Captions appear here'}
                  </div>
                )}
              </div>
            )}
            <div className="frame-grain" />

            {!previewUrl && clip && (
              <div className="frame-surface" ref={frameSurfaceRef} onWheel={handleFrameWheel}>
                <div
                  className="frame-crop"
                  style={cropStyle}
                  role="group"
                  tabIndex={0}
                  aria-label={`${labels[activeStack] || 'Frame'} crop. Drag to move the crop, edges for one-axis framing, corners to zoom.`}
                  onPointerDown={beginFrameDrag('pan')}
                  onPointerMove={moveFrameDrag}
                  onPointerUp={endFrameDrag}
                  onPointerCancel={endFrameDrag}
                  onKeyDown={handleFrameKeyDown}
                >
                  <span className="frame-grid" aria-hidden="true" />
                  <span className="frame-center" aria-hidden="true" />
                  {EDGES.map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      className={`frame-handle edge-handle handle-edge-${edge}`}
                      aria-label={`Drag ${edge} edge to adjust ${edge === 'n' || edge === 's' ? 'vertical' : 'horizontal'} framing`}
                      onPointerDown={beginFrameDrag('edge', edge)}
                      onPointerMove={moveFrameDrag}
                      onPointerUp={endFrameDrag}
                      onPointerCancel={endFrameDrag}
                      onKeyDown={handleFrameKeyDown}
                    />
                  ))}
                  {CORNERS.map((corner) => (
                    <button
                      key={corner}
                      type="button"
                      className={`frame-handle handle-${corner}`}
                      aria-label={`Drag ${corner} corner to zoom and reframe`}
                      onPointerDown={beginFrameDrag('corner', corner)}
                      onPointerMove={moveFrameDrag}
                      onPointerUp={endFrameDrag}
                      onPointerCancel={endFrameDrag}
                      onKeyDown={handleFrameKeyDown}
                    />
                  ))}
                </div>
                <span className="frame-hint">
                  {tiles > 1 ? `${labels[activeStack] || 'Stack'} · ` : ''}Drag to reframe · edges: one axis · corners: zoom
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {previewError && <p className="preview-error">{previewError}</p>}
      {playback?.status === 'failed' && (
        <p className="preview-error">
          This file uses a codec the browser cannot decode, so the live preview stays blank. Exports
          still burn captions correctly.
        </p>
      )}
      {previewUrl && (
        <p className="preview-note">
          Showing a real 6 second burn-in at half resolution.{' '}
          <button
            className="link"
            type="button"
            onClick={() => {
              // Force the composition effect to restore the live source at the
              // clip's in-point instead of the short preview's relative time.
              compositionKeyRef.current = '';
              emitPlayhead(clip?.start ?? 0);
              setPreviewUrl(null);
              setPreviewError(null);
            }}
          >
            Back to live view
          </button>
        </p>
      )}

      <div className="transport">
        <button className="btn primary play" onClick={toggle} type="button" disabled={!clip}>
          {playing ? '❚❚ Pause' : '▶ Play clip'}
        </button>
        <button
          className="btn ghost icon-only"
          type="button"
          onClick={() => setMuted((value) => !value)}
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? '🔇' : '🔊'}
        </button>
        <button
          className="btn ghost icon-only"
          type="button"
          onClick={() => goTo(playhead - 1)}
          disabled={!clip}
          title="Back one second"
        >
          −1s
        </button>
        <div
          className="track"
          role="slider"
          tabIndex={0}
          aria-label="Seek preview"
          aria-valuemin={trackStart}
          aria-valuemax={trackEnd}
          aria-valuenow={playhead}
          onPointerDown={beginTrackSeek}
          onPointerMove={(event) => trackSeekingRef.current && seekFromTrack(event)}
          onPointerUp={endTrackSeek}
          onPointerCancel={endTrackSeek}
          onKeyDown={handleTrackKeyDown}
        >
          <span
            style={{
              width: clip && trackEnd > trackStart
                ? `${Math.max(0, Math.min(100, ((playhead - trackStart) / (trackEnd - trackStart)) * 100))}%`
                : '0%',
            }}
          />
        </div>
        <button
          className="btn ghost icon-only"
          type="button"
          onClick={() => goTo(playhead + 1)}
          disabled={!clip}
          title="Forward one second"
        >
          +1s
        </button>
        <div className="clip-progress">
          <span>{formatTime(playhead)}</span>
          <span>/</span>
          <span>{clip ? formatTime(trackEnd) : '0:00'}</span>
        </div>
      </div>

      <div className="editor-tools">
        <div className="tool-group frame-tools">
          <div className="tool-heading">
            <span>{tiles > 1 ? `${labels[activeStack] || 'Stack'} angle` : 'Preset frame'}</span>
            <small>Drag the canvas or use exact controls</small>
          </div>
          <div className="angle-presets" role="group" aria-label="Framing angle presets">
            {ANGLE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" onClick={() => applyPreset(preset)} disabled={!clip || Boolean(previewUrl)}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="frame-sliders">
            <label className="frame-control">
              <span>
                Horizontal <b>{Math.round(frameValue.focus * 100)}%</b>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={frameValue.focus}
                onChange={(event) => updateFrame({ focus: Number(event.target.value) })}
                onPointerUp={() => commitFrame()}
                onKeyUp={() => commitFrame()}
                disabled={!clip}
              />
            </label>
            <label className="frame-control">
              <span>
                Vertical <b>{Math.round(frameValue.focusY * 100)}%</b>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={frameValue.focusY}
                onChange={(event) => updateFrame({ focusY: Number(event.target.value) })}
                onPointerUp={() => commitFrame()}
                onKeyUp={() => commitFrame()}
                disabled={!clip}
              />
            </label>
            <label className="frame-control">
              <span>
                Zoom <b>{`×${frameValue.zoom.toFixed(2)}`}</b>
              </span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step="0.01"
                value={frameValue.zoom}
                onChange={(event) => updateFrame({ zoom: Number(event.target.value) })}
                onPointerUp={() => commitFrame()}
                onKeyUp={() => commitFrame()}
                disabled={!clip}
              />
            </label>
          </div>
          <div className="tool-foot">
            <button className="btn ghost small" type="button" onClick={resetFrame} disabled={!clip}>
              Reset angle
            </button>
            {clip && <span className="muted-label">{clip.score}/100 viral score</span>}
          </div>
        </div>

        <div className="tool-group section-tools">
          <div className="tool-heading">
            <span>Clip section</span>
            <small>Choose what drops into this frame</small>
          </div>
          <div className="section-inputs">
            <label>
              <span>In</span>
              <input
                type="number"
                min="0"
                max={project?.duration}
                step="0.1"
                value={section.start}
                onChange={(event) => setSection((prev) => ({ ...prev, start: event.target.value }))}
                onBlur={() => commitSection(section)}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                disabled={!clip}
              />
            </label>
            <label>
              <span>Out</span>
              <input
                type="number"
                min="0"
                max={project?.duration}
                step="0.1"
                value={section.end}
                onChange={(event) => setSection((prev) => ({ ...prev, end: event.target.value }))}
                onBlur={() => commitSection(section)}
                onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                disabled={!clip}
              />
            </label>
          </div>
          <div className="section-actions">
            <button className="btn ghost small" type="button" onClick={() => usePlayheadFor('in')} disabled={!clip}>
              In at playhead
            </button>
            <button className="btn ghost small" type="button" onClick={() => usePlayheadFor('out')} disabled={!clip}>
              Out at playhead
            </button>
          </div>
          <div className="tool-foot">
            <span className="muted-label">
              {clip ? `${formatTime(Number(section.start) || 0)} → ${formatTime(Number(section.end) || 0)}` : 'Import a clip first'}
            </span>
            {sectionError && <span className="tool-error">{sectionError}</span>}
          </div>
        </div>

        {tiles > 1 && (
          <div className="tool-group stack-tools">
            <div className="tool-heading">
              <span>Stack sources</span>
              <small>Pick a different moment for each half — they play together</small>
            </div>
            <div className="stack-rows">
              {stacks.map((stack, index) => {
                const sourceAt = Number((clip?.start || 0) + stack.offset);
                const draft = offsetDrafts[index];
                return (
                  <div key={labels[index] || index} className={`stack-row ${activeStack === index ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="stack-pick"
                      onClick={() => setActiveStack(index)}
                      aria-pressed={activeStack === index}
                    >
                      {labels[index] || `Stack ${index + 1}`}
                    </button>
                    <label>
                      <span>Source at</span>
                      <input
                        type="number"
                        min="0"
                        max={project?.duration}
                        step="0.1"
                        value={draft === undefined ? sourceAt.toFixed(1) : draft}
                        onChange={(event) => setOffsetDrafts((prev) => ({ ...prev, [index]: event.target.value }))}
                        onBlur={(event) => updateStackOffset(index, (Number(event.target.value) || sourceAt) - (clip?.start || 0))}
                        onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                        disabled={!clip || Boolean(previewUrl)}
                      />
                    </label>
                    <span className="stack-delta">
                      {stack.offset > 0 ? '+' : ''}{stack.offset.toFixed(1)}s
                    </span>
                    <button
                      className="btn ghost small"
                      type="button"
                      onClick={() => updateStackOffset(index, playhead - (clip?.start || 0))}
                      disabled={!clip || Boolean(previewUrl)}
                      title="Use the current playhead as this stack's source moment"
                    >
                      At playhead
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="tool-foot">
              <button className="btn ghost small" type="button" onClick={resetStacks} disabled={!clip || Boolean(previewUrl)}>
                Reset all stack moments
              </button>
              <span className="muted-label">Each stack keeps its own angle and source moment</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
