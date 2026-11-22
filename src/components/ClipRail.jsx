import { useMemo, useState } from 'react';
import { formatTime } from '../api.js';
import { LANGUAGES } from '../../shared/captions.js';

function ScoreRing({ score }) {
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference;
  const color = score >= 82 ? '#c8ff3d' : score >= 68 ? '#9fe870' : score >= 52 ? '#ffd166' : '#ff8a72';
  return (
    <span className="score-ring" title={`Viral score ${score}/100`}>
      <svg viewBox="0 0 40 40" width="40" height="40">
        <circle cx="20" cy="20" r={radius} stroke="rgba(255,255,255,0.09)" strokeWidth="3.5" fill="none" />
        <circle
          cx="20"
          cy="20"
          r={radius}
          stroke={color}
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <b style={{ color }}>{score}</b>
    </span>
  );
}

export default function ClipRail({
  project,
  activeClipId,
  onSelect,
  settings,
  onSettings,
  onRetranscribe,
  onRenderAll,
  transcribing,
  hidden = false,
  onHide,
}) {
  const [sort, setSort] = useState('score');
  const clips = useMemo(() => {
    const list = [...(project.clips || [])];
    return sort === 'score' ? list.sort((a, b) => b.score - a.score) : list.sort((a, b) => a.start - b.start);
  }, [project.clips, sort]);

  return (
    <aside className={`rail clip-rail ${hidden ? 'is-hidden' : ''}`}>
      <div className="rail-head">
        <div>
          <h2>Clips</h2>
          <span>{project.clips?.length || 0} found in {formatTime(project.duration, true)}</span>
        </div>
        <div className="segmented tiny">
          <button className={sort === 'score' ? 'active' : ''} onClick={() => setSort('score')} type="button">
            Score
          </button>
          <button className={sort === 'time' ? 'active' : ''} onClick={() => setSort('time')} type="button">
            Timeline
          </button>
        </div>
        <button
          className="rail-hide"
          type="button"
          onClick={onHide}
          title="Hide clips"
          aria-label="Hide clips"
        >
          ×
        </button>
      </div>

      <div className="rail-scroll">
        {!clips.length && (
          <p className="rail-empty">
            {transcribing ? 'Reading the audio…' : 'No clips yet. Transcribe this video to find the moments.'}
          </p>
        )}
        {clips.map((clip) => (
          <button
            key={clip.id}
            type="button"
            className={`clip-card ${clip.id === activeClipId ? 'active' : ''}`}
            onClick={() => onSelect(clip.id)}
          >
            <div className="clip-card-top">
              <ScoreRing score={clip.score} />
              <div className="clip-card-text">
                <strong>{clip.title}</strong>
                <span className="clip-time">
                  {formatTime(clip.start)} → {formatTime(clip.end)} · {Math.round(clip.duration)}s
                </span>
              </div>
            </div>
            <p className="clip-excerpt">{clip.excerpt}</p>
            <div className="clip-tags">
              <span className="tag score-label">{clip.scoreLabel}</span>
              {clip.reasons?.slice(0, 2).map((reason) => (
                <span key={reason.label} className={`tag ${reason.tone === 'minus' ? 'warn' : ''}`}>
                  {reason.label}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="rail-foot">
        <div className="mini-settings">
          <label>
            <span>Language</span>
            <select
              value={settings.language}
              onChange={(event) => onSettings({ ...settings, language: event.target.value })}
            >
              {LANGUAGES.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select value={settings.model} onChange={(event) => onSettings({ ...settings, model: event.target.value })}>
              <option value="tiny">Tiny</option>
              <option value="base">Base</option>
              <option value="small">Small</option>
            </select>
          </label>
        </div>
        <div className="rail-actions">
          <button className="btn ghost small" onClick={onRetranscribe} disabled={transcribing} type="button">
            {transcribing ? 'Generating…' : project.clips?.length ? 'Re-transcribe' : 'Generate transcription'}
          </button>
          <button
            className="btn primary small"
            onClick={onRenderAll}
            disabled={!project.clips?.length}
            type="button"
          >
            Export all
          </button>
        </div>
      </div>
    </aside>
  );
}
