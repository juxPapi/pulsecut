import { useRef, useState } from 'react';
import { formatTime } from '../api.js';
import { LANGUAGES, CAPTION_STYLES } from '../../shared/captions.js';

const MODELS = [
  { id: 'tiny', label: 'Tiny', detail: '~75 MB · fastest' },
  { id: 'base', label: 'Base', detail: '~145 MB · balanced' },
  { id: 'small', label: 'Small', detail: '~480 MB · most accurate' },
];

export default function ImportScreen({
  health,
  projects,
  settings,
  onSettings,
  onUpload,
  onOpen,
  onDelete,
  uploading,
  progress,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const pick = (file) => {
    if (file) onUpload(file);
  };

  return (
    <div className="import">
      <section className="import-hero">
        <div className="hero-copy">
          <span className="eyebrow">Long videos in. Short clips out.</span>
          <h1>
            Find the ten clips
            <br />
            hiding in a 90 minute video.
          </h1>
          <p>
            Drop a long video in. PulseCut transcribes it on your own machine, scores the moments worth posting,
            reframes them vertical and burns in captions. No subscription, no credits, no upload limits.
          </p>

          <div
            className={`dropzone ${dragging ? 'dragging' : ''} ${uploading ? 'busy' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              pick(event.dataTransfer.files?.[0]);
            }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/*,.mkv,.mov,.mp4"
              hidden
              onChange={(event) => pick(event.target.files?.[0])}
            />
            <div className="dropzone-icon">▶</div>
            <strong>{uploading ? 'Copying your video in…' : 'Drop a video, or click to choose'}</strong>
            <span>mp4 · mov · mkv · webm — any length, straight off your disk</span>
            {uploading && progress && (
              <div className="bar slim">
                <span style={{ width: `${Math.min(100, progress.percent || 3)}%` }} />
              </div>
            )}
          </div>

          <div className="settings-row">
            <label>
              <span>Spoken language</span>
              <select value={settings.language} onChange={(event) => onSettings({ ...settings, language: event.target.value })}>
                {LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="model-picker">
              <span>Whisper model</span>
              <div className="segmented">
                {MODELS.map((model) => (
                  <button
                    key={model.id}
                    className={settings.model === model.id ? 'active' : ''}
                    onClick={() => onSettings({ ...settings, model: model.id })}
                    title={model.detail}
                    type="button"
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ul className="feature-strip">
            <li>{CAPTION_STYLES.length} caption styles</li>
            <li>Viral score, with reasons</li>
            <li>16:9 · 9:16 · 4:5 · 1:1</li>
            <li>15 languages</li>
            <li>Offline after setup</li>
          </ul>
        </div>

        <aside className="hero-side">
          <div className="side-card">
            <h3>On this machine</h3>
            <div className="health-row">
              <span>FFmpeg</span>
              <strong className={health?.ffmpeg ? 'ok' : 'bad'}>{health?.ffmpeg ? 'ready' : 'missing'}</strong>
            </div>
            <div className="health-row">
              <span>Whisper models cached</span>
              <strong>{health ? `${health.cachedModelFiles} file(s)` : '—'}</strong>
            </div>
            <div className="health-row">
              <span>Caption styles</span>
              <strong>{health?.captionStyles ?? CAPTION_STYLES.length}</strong>
            </div>
            <p className="side-note">
              Audio is extracted with FFmpeg and transcribed with Whisper running locally. The first run downloads
              the model once; after that the whole app works offline.
            </p>
          </div>

          <div className="side-card">
            <h3>The pipeline</h3>
            <ol className="pipeline">
              <li>
                <b>Transcribe</b> — word-level timings, Urdu, Hindi and Hinglish included.
              </li>
              <li>
                <b>Score</b> — hook, numbers, emotion, pacing and payoff, with the reason attached.
              </li>
              <li>
                <b>Reframe</b> — drag handles in a 16:9 editing window, focus control per clip.
              </li>
              <li>
                <b>Export</b> — captions burned in, four aspect ratios in one pass, with live conversion speed.
              </li>
            </ol>
          </div>
        </aside>
      </section>

      <section className="recent">
        <div className="section-head">
          <h2>Recent videos</h2>
          <span>{projects.length ? `${projects.length} on disk` : 'Nothing here yet'}</span>
        </div>
        {projects.length === 0 ? (
          <p className="empty-line">Your first drop will show up here, with its clips and exports.</p>
        ) : (
          <div className="recent-grid">
            {projects.map((item) => (
              <article key={item.id} className="recent-card">
                <button className="recent-open" onClick={() => onOpen(item.id)}>
                  <span className="recent-thumb" style={{ backgroundImage: `url(${item.thumb})` }} />
                  <span className="recent-text">
                    <strong>{item.name}</strong>
                    <span>
                      {formatTime(item.duration)} · {item.clips} clips · {item.exports} exports
                    </span>
                  </span>
                </button>
                <button
                  className="recent-delete"
                  title="Remove from disk"
                  onClick={() => onDelete(item.id)}
                  type="button"
                >
                  ✕
                </button>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
