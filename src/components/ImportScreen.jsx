import { useRef, useState } from 'react';
import { formatTime } from '../api.js';
import { CAPTION_STYLES } from '../../shared/captions.js';

const PIPELINE = [
  { title: 'Import', detail: 'Local file, no upload' },
  { title: 'Score', detail: 'Hooks and payoff' },
  { title: 'Reframe', detail: 'Crop any section' },
  { title: 'Export', detail: 'Burned-in captions' },
];

export default function ImportScreen({
  health,
  projects,
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
      <div className="game-backdrop" aria-hidden="true" />

      <section className="import-hero">
        <div className="hero-copy">
          <span className="eyebrow">Local studio · ready when you are</span>
          <h1>
            Find the moments
            <br />
            worth reposting.
          </h1>
          <p>
            Drop in a long video, choose the exact section you want, and reframe it in a preset canvas.
            Caption generation starts only when you ask for it in the editing window.
          </p>
        </div>
        <div className="hero-status">
          <span className={`status-pill ${health?.ffmpeg ? 'ok' : 'bad'}`}>
            <i />
            {health?.ffmpeg ? 'Engine online' : 'Engine missing'}
          </span>
          <span className="status-pill">
            <i />
            {health ? `${health.cachedModelFiles} caption model file(s)` : 'Checking models'}
          </span>
          <span className="status-pill">
            <i />
            {health?.captionStyles ?? CAPTION_STYLES.length} caption styles
          </span>
        </div>
      </section>

      <section className="import-grid">
        <div className="import-column">
          <div className="import-card">
            <div className="card-heading">
              <h2>Start a project</h2>
              <span>Any length · stays on this machine</span>
            </div>
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
              <div className="dropzone-icon">＋</div>
              <strong>{uploading ? 'Copying your video in…' : 'Drop a video here'}</strong>
              <span>or click to browse · mp4, mov, mkv, webm</span>
              {uploading && progress && (
                <div className="bar slim">
                  <span style={{ width: `${Math.min(100, progress.percent || 3)}%` }} />
                </div>
              )}
            </div>
            <ul className="import-features">
              <li>Preset 16:9 canvas</li>
              <li>Drag-to-crop framing</li>
              <li>4 export ratios</li>
            </ul>
          </div>

          <div className="popular-card">
            <div className="popular-shade" />
            <div className="popular-content">
              <span className="popular-tag">Most popular</span>
              <h2>GTA6</h2>
              <p>
                Vice City is taking over feeds. Drop your gameplay in and cut the moments everyone is
                rewatching.
              </p>
              <div className="popular-chips">
                <span>Open world</span>
                <span>Stream clips</span>
                <span>Neon nights</span>
              </div>
            </div>
          </div>
        </div>

        <div className="import-column">
          <div className="pipeline-card">
            <div className="card-heading">
              <h2>Live pipeline</h2>
              <span>Runs locally, step by step</span>
            </div>
            <ol className="pipeline">
              {PIPELINE.map((step, index) => (
                <li key={step.title}>
                  <b>{step.title}</b>
                  <span>{step.detail}</span>
                  <em>{String(index + 1).padStart(2, '0')}</em>
                </li>
              ))}
            </ol>
          </div>

          <div className="recent-panel">
            <div className="card-heading">
              <h2>Recent videos</h2>
              <span>{projects.length ? `${projects.length} on disk` : 'Nothing here yet'}</span>
            </div>
            {projects.length === 0 ? (
              <p className="empty-line">Your first import will show up here with its clips and exports.</p>
            ) : (
              <div className="recent-grid">
                {projects.map((item) => (
                  <article key={item.id} className="recent-card">
                    <button className="recent-open" onClick={() => onOpen(item.id)} type="button">
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
          </div>
        </div>
      </section>
    </div>
  );
}
