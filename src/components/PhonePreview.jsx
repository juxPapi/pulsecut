import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatTime } from '../api.js';
import { ASPECTS, LAYOUTS } from '../../shared/captions.js';
import { composeLayout, resolveFrame, ZOOM_MAX, ZOOM_MIN } from '../../shared/framing.js';
import { OUTRO_DURATION, OUTRO_BACKGROUND, OUTRO_LIME, OUTRO_INK, OUTRO_TEXT, CHANNEL, OUTRO_GEOMETRY } from '../../shared/outro.js';

let blurBuffer = null;

/**
 * Draw the blurred backdrop the same way FFmpeg builds it: crop, scale to the
 * frame, then blur with the edge pixels extended outwards. The extension lives
 * outside the visible frame and only exists so the blur kernel never samples
 * transparent pixels at the border.
 */
function drawBlurBackdrop(ctx, video, box, width, height, sigma, dpr) {
  const pad = Math.ceil(sigma * 3);
  const outerW = width + pad * 2;
  const outerH = height + pad * 2;

  if (!blurBuffer) blurBuffer = document.createElement('canvas');
  const pixelW = Math.ceil(outerW * dpr);
  const pixelH = Math.ceil(outerH * dpr);
  if (blurBuffer.width !== pixelW || blurBuffer.height !== pixelH) {
    blurBuffer.width = pixelW;
    blurBuffer.height = pixelH;
  }

  const buffer = blurBuffer.getContext('2d');
  buffer.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [frame, setFrame] = useState(() => resolveFrame(clip));
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const aspectInfo = ASPECTS[aspect] || ASPECTS['9:16'];
  const frameValue = resolveFrame(frame);
  const playback = project?.playback || null;
  const videoSrc = `/api/media/${project.id}${playback?.status === 'ready' ? `?v=${playback.version}` : ''}`;

  const frameRef = useRef(frameValue);
  frameRef.current = frameValue;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const drawnRef = useRef({});
  const contentEndRef = useRef(0);

  const updateFrame = (patch) => setFrame((previous) => resolveFrame({ ...previous, ...patch }));
  const commitFrame = (next = frameValue) => {
    if (clip) onFrame?.(next);
  };
  const resetFrame = () => {
    const next = resolveFrame({});
    setFrame(next);
    commitFrame(next);
  };

  /** Paint the live video into the phone frame with the same composition the renderer uses. */
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
      drawBlurBackdrop(ctx, video, backdrop, width, height, sigma, dpr);
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
    if (!previewUrl && clip) video.currentTime = clip.start > 0 ? clip.start : 0.001;

    let frame = 0;
    let running = false;
    const paint = () => draw();
    const loop = () => {
      paint();
      if (running) frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running) return;
      running = true;
      loop();
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
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
      // Nudge zero to 0.001: a same-time assignment is not a seek, and some
      // browsers keep the first decoded frame blank until a seek or play.
      video.currentTime = clip.start > 0 ? clip.start : 0.001;
      setPlaying(false);
      onPlayhead(clip.start);
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video || playing || !clip) return;
    if (Math.abs(video.currentTime - playhead) > 0.45) {
      video.currentTime = playhead > 0 ? playhead : 0.001;
    }
  }, [playhead, playing, clip]);

  // A freshly built browser copy reloads the element at 0:00; keep it on the clip start.
  useEffect(() => {
    const video = videoRef.current;
    if (video && clip) video.currentTime = clip.start > 0 ? clip.start : 0.001;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback?.version]);

  const toggle = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (clip && (video.currentTime < clip.start || video.currentTime >= clip.end + OUTRO_DURATION - 0.1)) {
        video.currentTime = clip.start;
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
    // The like & subscribe end card runs after the content, then playback loops.
    if (video.currentTime >= clip.end + OUTRO_DURATION - 0.03) {
      video.currentTime = clip.start;
      onPlayhead(clip.start);
      return;
    }
    onPlayhead(video.currentTime);
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

  return (
    <section className="preview">
      <div className="preview-head">
        <div className="preview-controls">
          <div className="aspect-switch">
            {Object.values(ASPECTS).map((item) => (
              <button
                key={item.id}
                type="button"
                className={aspect === item.id ? 'active' : ''}
                onClick={() => onAspect(item.id)}
                title={item.short}
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

      <div className="phone-stage">
        <div className="phone" style={{ '--phone-ratio': aspectInfo.width / aspectInfo.height }}>
          <div className="phone-notch" />
          <div className="phone-screen" style={{ aspectRatio: `${aspectInfo.width} / ${aspectInfo.height}` }}>
            <video
              ref={videoRef}
              className="phone-video"
              src={previewUrl || videoSrc}
              playsInline
              muted={muted}
              onTimeUpdate={onTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              style={{ visibility: previewUrl ? 'visible' : 'hidden' }}
            />
            {!previewUrl && <canvas ref={canvasRef} className="phone-canvas" />}
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
            <div className="phone-grain" />
          </div>
        </div>
        <div className="phone-shadow" />
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
            onPointerUp={commitFrame}
            onKeyUp={commitFrame}
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
            onPointerUp={commitFrame}
            onKeyUp={commitFrame}
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
            onPointerUp={commitFrame}
            onKeyUp={commitFrame}
            disabled={!clip}
          />
        </label>
        <div className="focus-foot">
          <button className="btn ghost small" type="button" onClick={resetFrame} disabled={!clip}>
            Reset frame
          </button>
          {clip && <span className="muted-label">{clip.score}/100 viral score</span>}
        </div>
      </div>
    </section>
  );
}
