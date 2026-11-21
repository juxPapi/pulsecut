import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime } from '../api.js';
import { ASPECTS, LAYOUTS } from '../../shared/captions.js';
import { composeLayout, resolveFrame, ZOOM_MAX, ZOOM_MIN } from '../../shared/framing.js';
import { OUTRO_DURATION, OUTRO_BACKGROUND, OUTRO_LIME, OUTRO_INK, OUTRO_TEXT, CHANNEL, OUTRO_GEOMETRY } from '../../shared/outro.js';

let blurBuffer = null;

const CORNERS = ['nw', 'ne', 'sw', 'se'];
const MIN_CROP = 1 / ZOOM_MAX;

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
  transcribing,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const frameSurfaceRef = useRef(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [frame, setFrame] = useState(() => resolveFrame(clip));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const aspectInfo = ASPECTS[aspect] || ASPECTS['16:9'];
  const frameValue = resolveFrame(frame);
  const playback = project?.playback || null;
  const videoSrc = `/api/media/${project.id}${playback?.status === 'ready' ? `?v=${playback.version}` : ''}`;

  const frameRef = useRef(frameValue);
  frameRef.current = frameValue;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const drawnRef = useRef({});
  const contentEndRef = useRef(0);
  const lastEmittedRef = useRef(null);
  const dragRef = useRef(null);
  const frameRafRef = useRef(0);
  const pendingFrameRef = useRef(null);
  const wheelCommitRef = useRef(0);

  // Remember the value we reported to the parent so a re-render with that same
  // playhead cannot turn into a second seek back into the video.
  const emitPlayhead = (time) => {
    lastEmittedRef.current = time;
    onPlayhead(time);
  };
  const seekVideo = (time) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) return;
    const target = Math.max(0, time);
    if (Math.abs(video.currentTime - target) < 0.05) return;
    video.currentTime = target > 0 ? target : 0.001;
  };

  // Coalesce drag/keyboard/wheel changes to one React render per animation frame.
  // The canvas blur is expensive, so painting every pointermove would stutter.
  const updateFrame = (patch) => {
    pendingFrameRef.current = { ...(pendingFrameRef.current || frameRef.current), ...patch };
    if (frameRafRef.current) return;
    frameRafRef.current = requestAnimationFrame(() => {
      frameRafRef.current = 0;
      const next = resolveFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
      frameRef.current = next;
      setFrame(next);
    });
  };

  // One PATCH per gesture: pointerup, keyup or the end of a wheel burst.
  const commitFrame = (fallback) => {
    const value = resolveFrame(pendingFrameRef.current || fallback || frameRef.current);
    if (frameRafRef.current) cancelAnimationFrame(frameRafRef.current);
    frameRafRef.current = 0;
    pendingFrameRef.current = null;
    frameRef.current = value;
    setFrame(value);
    if (clip) onFrame?.(value);
  };

  const resetFrame = () => {
    const next = resolveFrame({});
    if (frameRafRef.current) cancelAnimationFrame(frameRafRef.current);
    frameRafRef.current = 0;
    pendingFrameRef.current = null;
    frameRef.current = next;
    setFrame(next);
    commitFrame(next);
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

  const beginFrameDrag = (mode, corner = null) => (event) => {
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
      corner,
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

    const signX = drag.corner.includes('w') ? -1 : 1;
    const signY = drag.corner.includes('n') ? -1 : 1;
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

  /** Paint the live video into the 16:9 window with the same composition the renderer uses. */
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const active = layoutRef.current;
    const { focus, focusY, zoom } = frameRef.current;

    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const stamp = `${video.currentTime.toFixed(3)}|${active}|${focus}|${focusY}|${zoom}|${pixelWidth}x${pixelHeight}`;
    if (drawnRef.current.stamp === stamp) return;
    drawnRef.current.stamp = stamp;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.filter = 'none';

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const plan = composeLayout({ layout: active, srcW: vw, srcH: vh, width, height, frame: { focus, focusY, zoom } });
    // Only cover the composed frame once playback reaches the end card. Drawing
    // the outro unconditionally would hide the live video behind its backdrop.
    const outroActive = contentEndRef.current > 0 && video.currentTime >= contentEndRef.current;
    const outroProgress = outroActive
      ? Math.min(1, (video.currentTime - contentEndRef.current) / OUTRO_DURATION)
      : 0;

    if (plan.mode === 'fill') {
      const { box } = plan;
      ctx.drawImage(video, box.x, box.y, box.cropW, box.cropH, 0, 0, width, height);
      if (outroActive) drawOutro(ctx, width, height, outroProgress);
      return;
    }

    if (plan.mode === 'blur') {
      const { backdrop, foreground, sigma } = plan;
      drawBlurBackdrop(ctx, video, backdrop, width, height, sigma);
      ctx.drawImage(video, 0, 0, vw, vh, foreground.x, foreground.y, foreground.width, foreground.height);
      if (outroActive) drawOutro(ctx, width, height, outroProgress);
      return;
    }

    const { box, tiles, tileH, offsetY } = plan;
    for (let index = 0; index < tiles; index += 1) {
      ctx.drawImage(video, box.x, box.y, box.cropW, box.cropH, 0, index * tileH - offsetY, width, tileH);
    }
    if (outroActive) drawOutro(ctx, width, height, outroProgress);
  }, []);

  // Paint on the frames that actually change instead of running a permanent loop.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;

    // A remounted canvas (e.g. returning from burn-in preview) starts blank; the
    // live video also reloads at 0:00, so put it back on the clip start.
    drawnRef.current.stamp = null;
    if (!previewUrl && clip && video.readyState >= 1) seekVideo(clip.start);

    let frame = 0;
    let videoFrame = null;
    let running = false;
    const paint = () => draw();
    const loop = () => {
      paint();
      if (running) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      // Paint once per presented video frame instead of once per display refresh.
      // Canvas blur/filter work is expensive and was stalling the UI at 60 fps.
      if (typeof video.requestVideoFrameCallback === 'function') {
        const onVideoFrame = () => {
          if (!running) return;
          draw();
          videoFrame = video.requestVideoFrameCallback(onVideoFrame);
        };
        videoFrame = video.requestVideoFrameCallback(onVideoFrame);
      } else {
        loop();
      }
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
      if (videoFrame !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(videoFrame);
        videoFrame = null;
      }
      paint();
    };

    video.addEventListener('play', start);
    video.addEventListener('playing', start);
    video.addEventListener('pause', stop);
    video.addEventListener('seeked', paint);
    video.addEventListener('timeupdate', paint);
    video.addEventListener('loadeddata', paint);
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      if (videoFrame !== null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(videoFrame);
      }
      video.removeEventListener('play', start);
      video.removeEventListener('playing', start);
      video.removeEventListener('pause', stop);
      video.removeEventListener('seeked', paint);
      video.removeEventListener('timeupdate', paint);
      video.removeEventListener('loadeddata', paint);
      observer.disconnect();
    };
  }, [draw, previewUrl, clip?.id]);

  useEffect(() => {
    draw();
  }, [draw, layout, frameValue.focus, frameValue.focusY, frameValue.zoom]);

  useEffect(() => {
    setFrame(resolveFrame(clip));
    setPreviewUrl(null);
    setPreviewError(null);
    const video = videoRef.current;
    if (video && clip) {
      seekVideo(clip.start);
      setPlaying(false);
      emitPlayhead(clip.start);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id]);

  // The like & subscribe end card starts right after the content being previewed or played.
  useEffect(() => {
    if (!clip) {
      contentEndRef.current = 0;
      return;
    }
    contentEndRef.current = previewUrl ? Math.min(clip.end, clip.start + 6) : clip.end;
  }, [clip?.id, previewUrl]);

  // Only external playhead changes (a transcript click, choosing a clip) should
  // seek the video. Playhead updates we emitted ourselves must not bounce back as
  // a second seek — that fight is what made editing playback stutter and freeze.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !clip || playing) return;
    if (playhead === lastEmittedRef.current) return;
    if (Math.abs(video.currentTime - playhead) < 0.05) return;
    seekVideo(playhead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playhead, playing, clip]);

  // A rebuilt browser preview reloads at 0:00; seeking is ignored until metadata
  // exists, so restore the playhead from the load event instead of a timer.
  const restoreAfterLoad = () => {
    const video = videoRef.current;
    if (!video || previewUrl || !clip) return;
    const inRange = playheadRef.current >= clip.start - 0.05 && playheadRef.current <= clip.end + OUTRO_DURATION;
    seekVideo(inRange ? playheadRef.current : clip.start);
    draw();
  };

  const toggle = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (clip && !previewUrl) {
        const loopEnd = contentEndRef.current + OUTRO_DURATION;
        if (video.currentTime < clip.start || video.currentTime >= loopEnd - 0.1) seekVideo(clip.start);
      }
      await video.play().catch(() => {});
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const onTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !clip) return;
    const loopEnd = contentEndRef.current + OUTRO_DURATION;
    // The like & subscribe end card runs after the content, then playback loops.
    if (loopEnd > 0 && video.currentTime >= loopEnd - 0.03) {
      const restartAt = previewUrl ? 0 : clip.start;
      video.currentTime = restartAt > 0 ? restartAt : 0.001;
      emitPlayhead(restartAt);
      return;
    }
    emitPlayhead(video.currentTime);
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

  const captionStyle = {
    fontFamily: `'${style.font}', system-ui, sans-serif`,
    color: style.color,
    fontSize: `${18 * (style.size || 1)}px`,
    textTransform: style.uppercase ? 'uppercase' : 'none',
    opacity: style.opacity ?? 1,
    transform: `rotate(${style.tilt || 0}deg)`,
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
  };

  const captionPosition =
    style.position === 'top' ? 'flex-start' : style.position === 'middle' ? 'center' : 'flex-end';

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
    } catch (error) {
      setPreviewError(error.message);
    } finally {
      setPreviewing(false);
    }
  };

  const cropRect = cropRectFor(frameValue);
  const cropStyle = {
    left: `${cropRect.left * 100}%`,
    top: `${cropRect.top * 100}%`,
    width: `${cropRect.size * 100}%`,
    height: `${cropRect.size * 100}%`,
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
        </div>
        <div className="preview-head-right">
          <span className="muted-label">
            {aspectInfo.width}×{aspectInfo.height} · {aspectInfo.short}
          </span>
          <button className="btn ghost small" onClick={renderBurnIn} disabled={!clip || previewing} type="button">
            {previewing ? 'Rendering…' : 'Burn-in preview'}
          </button>
        </div>
      </div>

      <div className="frame-stage">
        <div className="edit-frame" style={{ '--frame-ratio': aspectInfo.width / aspectInfo.height }}>
          <div className="frame-screen" style={{ aspectRatio: `${aspectInfo.width} / ${aspectInfo.height}` }}>
            <video
              ref={videoRef}
              className="frame-video"
              src={previewUrl || videoSrc}
              playsInline
              preload="auto"
              muted={muted}
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={restoreAfterLoad}
              onEnded={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              style={{ visibility: previewUrl ? 'visible' : 'hidden' }}
            />
            {!previewUrl && <canvas ref={canvasRef} className="frame-canvas" />}
            {!previewUrl && (
              <div className="caption-layer" style={{ justifyContent: captionPosition }}>
                {cue ? (
                  <div className="caption-text" style={captionStyle} key={cue.start}>
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
                  aria-label="Framing controls. Drag to move the crop, use the corners to zoom."
                  onPointerDown={beginFrameDrag('pan')}
                  onPointerMove={moveFrameDrag}
                  onPointerUp={endFrameDrag}
                  onPointerCancel={endFrameDrag}
                  onKeyDown={handleFrameKeyDown}
                >
                  <span className="frame-grid" aria-hidden="true" />
                  <span className="frame-center" aria-hidden="true" />
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
                <span className="frame-hint">Drag to reframe · corners to zoom</span>
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
              setPreviewUrl(null);
              setPreviewError(null);
            }}
          >
            Back to live view
          </button>
        </p>
      )}

      <div className="transport">
        <button className="btn primary play" onClick={toggle} type="button" disabled={!clip || Boolean(previewUrl)}>
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
        <div className="clip-progress">
          <span>{formatTime(playhead)}</span>
          <div className="track">
            <span
              style={{
                width: clip ? `${Math.max(0, Math.min(100, ((playhead - clip.start) / (clip.end - clip.start)) * 100))}%` : '0%',
              }}
            />
          </div>
          <span>{clip ? formatTime(clip.end) : '0:00'}</span>
        </div>
      </div>

      <div className="focus-row">
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
        <div className="focus-foot">
          <button className="btn ghost small" type="button" onClick={resetFrame} disabled={!clip}>
            Reset frame
          </button>
          <span className="muted-label">Drag the on-screen handles or scroll to zoom</span>
          {clip && <span className="muted-label">{clip.score}/100 viral score</span>}
        </div>
      </div>
    </section>
  );
}
