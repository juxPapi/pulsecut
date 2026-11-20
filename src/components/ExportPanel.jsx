import { formatBytes } from '../api.js';
import { ASPECTS } from '../../shared/captions.js';

const PLATFORMS = {
  '9:16': 'TikTok · Reels · Shorts',
  '4:5': 'Instagram feed · LinkedIn',
  '1:1': 'Feed · X',
};

export default function ExportPanel({ project, clip, jobs, aspects, setAspects, onRender }) {
  const toggleAspect = (id) => {
    setAspects((current) =>
      current.includes(id) ? (current.length > 1 ? current.filter((item) => item !== id) : current) : [...current, id]
    );
  };

  const projectJobs = jobs.filter((job) => job.projectId === project.id);
  const exports = project.exports || [];

  return (
    <div className="export-panel">
      <div className="panel-intro">
        <h2>Export</h2>
        <p>Captions are burned in with FFmpeg. Pick as many ratios as you want; each one renders in a single pass.</p>
      </div>

      <div className="aspect-cards">
        {Object.values(ASPECTS).map((item) => (
          <button
            key={item.id}
            type="button"
            className={`aspect-card ${aspects.includes(item.id) ? 'active' : ''}`}
            onClick={() => toggleAspect(item.id)}
          >
            <span className={`aspect-shape shape-${item.id.replace(':', '-')}`} />
            <strong>{item.id}</strong>
            <span>{PLATFORMS[item.id]}</span>
            <small>
              {item.width}×{item.height}
            </small>
          </button>
        ))}
      </div>

      <div className="export-actions">
        <button type="button" className="btn primary full" disabled={!clip} onClick={() => clip && onRender([clip.id])}>
          Render this clip · {aspects.join(' · ')}
        </button>
        <button
          type="button"
          className="btn ghost full"
          disabled={!project.clips?.length}
          onClick={() => onRender(project.clips.map((item) => item.id))}
        >
          Render all {project.clips?.length || 0} clips × {aspects.length} ratio{aspects.length > 1 ? 's' : ''}
        </button>
      </div>

      <div className="job-list">
        <h3>Render queue</h3>
        {!projectJobs.length && <p className="rail-empty">Nothing rendering yet.</p>}
        {projectJobs.map((job) => (
          <div key={job.id} className={`job ${job.status}`}>
            <div className="job-top">
              <strong>
                Clip {job.clipIndex} · {job.aspect}
              </strong>
              <span>{job.status === 'done' ? 'Ready' : job.status === 'error' ? 'Failed' : `${job.progress}%`}</span>
            </div>
            <div className="bar slim">
              <span style={{ width: `${job.status === 'done' ? 100 : job.progress}%` }} />
            </div>
            {job.status === 'done' && job.url && (
              <div className="job-foot">
                <span>{formatBytes(job.size)}</span>
                <a className="link" href={job.url} download>
                  Download
                </a>
              </div>
            )}
            {job.status === 'error' && <p className="job-error">{job.error}</p>}
          </div>
        ))}
      </div>

      <div className="export-list">
        <h3>On disk</h3>
        {!exports.length && <p className="rail-empty">Rendered clips land in data/exports.</p>}
        {[...exports].reverse().map((item) => (
          <div key={item.file} className="export-row">
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.aspect} · {formatBytes(item.size)} · {new Date(item.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <a className="btn ghost small" href={item.url} download>
              Save
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
