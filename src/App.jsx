import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, useEvents } from './api';
import ImportScreen from './components/ImportScreen.jsx';
import ClipRail from './components/ClipRail.jsx';
import PhonePreview from './components/PhonePreview.jsx';
import TranscriptPanel from './components/TranscriptPanel.jsx';
import StylePanel from './components/StylePanel.jsx';
import PostPanel from './components/PostPanel.jsx';
import ExportPanel from './components/ExportPanel.jsx';
import { ASPECTS, resolveLayout, resolveStyle } from '../shared/captions.js';

const TABS = [
  { id: 'style', label: 'Captions' },
  { id: 'post', label: 'Post' },
  { id: 'export', label: 'Export' },
];

const STAGES = [
  { id: 'import', label: 'Import', short: 'Import', icon: 'import' },
  { id: 'edit', label: 'Editing', short: 'Edit', icon: 'edit' },
  { id: 'export', label: 'Render', short: 'Render', icon: 'export' },
];

function StageIcon({ name }) {
  if (name === 'import') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    );
  }
  if (name === 'edit') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h9M4 17h5" />
        <circle cx="17" cy="7" r="2.5" />
        <circle cx="13" cy="17" r="2.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21V9m0 0 4 4m-4-4-4 4" />
      <path d="M5 8V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
    </svg>
  );
}

function StageNav({ stage, onStage, hasProject, variant }) {
  return (
    <nav className={`stage-nav stage-nav-${variant}`} aria-label="Workspace pages">
      {STAGES.map((item, index) => {
        const active = stage === item.id;
        const disabled = item.id !== 'import' && !hasProject;
        return (
          <button
            key={item.id}
            type="button"
            className={`stage-tab ${active ? 'active' : ''}`}
            onClick={() => onStage(item.id)}
            disabled={disabled}
            aria-current={active ? 'page' : undefined}
            title={disabled ? 'Import a video first' : item.label}
          >
            <span className="stage-tab-icon">
              <StageIcon name={item.icon} />
            </span>
            <span className="stage-tab-text">
              <small>{String(index + 1).padStart(2, '0')}</small>
              {variant === 'side' ? item.short : item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [stage, setStage] = useState('import');
  const [activeClipId, setActiveClipId] = useState(null);
  // Editing opens in the same 16:9 window exports default to. The ratio tabs in
  // the preview switch this at any time without touching the source file.
  const [aspect, setAspect] = useState('16:9');
  const [layout, setLayout] = useState('fill');
  const [styleId, setStyleId] = useState('bold-pop-coral-pop');
  const [options, setOptions] = useState({ size: 1, position: 'bottom', opacity: 1, tilt: null });
  const [aspectsToRender, setAspectsToRender] = useState(['16:9']);
  const [tab, setTab] = useState('style');
  const [settings, setSettings] = useState({ language: 'auto', model: 'base' });
  const [progress, setProgress] = useState(null);
  const [logs, setLogs] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [playhead, setPlayhead] = useState(0);
  const [railOpen, setRailOpen] = useState(true);

  const projectRef = useRef(null);
  projectRef.current = project;

  const loadProject = useCallback(async (id) => {
    const data = await api(`/api/projects/${id}`);
    setProject(data.project);
    setLayout(resolveLayout(data.project.layout));
    setActiveClipId((current) => {
      const clips = data.project.clips || [];
      if (current && clips.some((clip) => clip.id === current)) return current;
      const best = [...clips].sort((a, b) => b.score - a.score)[0];
      return best?.id ?? null;
    });
    return data.project;
  }, []);

  const refreshProjects = useCallback(async () => {
    const data = await api('/api/projects');
    setProjects(data.projects || []);
  }, []);

  // Pick up jobs that were already queued before this page was opened, so a
  // reload during a render still shows its live speed and progress.
  const refreshJobs = useCallback(async () => {
    const data = await api('/api/jobs');
    setJobs(data.jobs || []);
  }, []);

  useEffect(() => {
    api('/api/health').then(setHealth).catch(() => {});
    refreshProjects().catch(() => {});
    refreshJobs().catch(() => {});
  }, [refreshProjects, refreshJobs]);

  useEvents((event, data) => {
    const current = projectRef.current;
    if (event === 'log') {
      setLogs((prev) => [...prev.slice(-60), data.message]);
      return;
    }
    if (!current || data.projectId !== current.id) return;
    if (event === 'progress') {
      setProgress(data);
      return;
    }
    if (event === 'project') {
      loadProject(current.id).catch(() => {});
      if (data.status === 'ready') setProgress({ phase: 'Ready', percent: 100 });
      return;
    }
    if (event === 'job') {
      setJobs((prev) => {
        const next = prev.filter((job) => job.id !== data.id);
        return [data, ...next];
      });
      if (data.status === 'done') loadProject(current.id).catch(() => {});
    }
  });

  const clip = useMemo(() => {
    if (!project?.clips?.length) return null;
    return project.clips.find((item) => item.id === activeClipId) || project.clips[0];
  }, [project, activeClipId]);

  const style = useMemo(() => {
    const resolved = resolveStyle(styleId, options);
    return {
      ...resolved,
      size: options.size ?? 1,
      position: options.position || 'bottom',
      opacity: options.opacity ?? 1,
    };
  }, [styleId, options]);

  const setOption = useCallback((key, value) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Stable identity keeps the memoized transcript lines from re-rendering on
  // every playhead tick.
  const seekTo = useCallback((time) => setPlayhead(time), []);

  const chooseLayout = useCallback(
    (next) => {
      const id = resolveLayout(next);
      setLayout(id);
      setProject((prev) => (prev ? { ...prev, layout: id } : prev));
      if (!project) return;
      api(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ layout: id }),
      }).catch((err) => setError(err.message));
    },
    [project]
  );

  const openProject = useCallback(
    async (id) => {
      try {
        await loadProject(id);
        setStage('edit');
        setTab('style');
        // Keep queued jobs for this project: the export panel filters by
        // project id, so they reappear when its render page is opened.
        setPlayhead(0);
        setError(null);
      } catch (err) {
        setError(err.message);
      }
    },
    [loadProject]
  );

  const handleUpload = useCallback(
    async (file) => {
      setError(null);
      setUploading(true);
      setLogs([]);
      setProgress({ phase: 'Copying the file in', percent: 2 });
      try {
        const form = new FormData();
        form.append('video', file);
        const { project: created } = await api('/api/upload', { method: 'POST', body: form });
        setProject(created);
        setLayout(resolveLayout(created.layout));
        setActiveClipId(null);
        setJobs([]);
        setPlayhead(0);
        setStage('edit');
        setTab('style');
        setProgress({ phase: 'Starting transcription', percent: 4 });
        await api(`/api/projects/${created.id}/transcribe`, {
          method: 'POST',
          body: JSON.stringify(settings),
        });
        await refreshProjects();
      } catch (err) {
        setError(err.message);
        setProgress(null);
      } finally {
        setUploading(false);
      }
    },
    [refreshProjects, settings]
  );

  const retranscribe = useCallback(async () => {
    if (!project) return;
    setError(null);
    setLogs([]);
    setProgress({ phase: 'Queued', percent: 1 });
    try {
      await api(`/api/projects/${project.id}/transcribe`, {
        method: 'POST',
        body: JSON.stringify(settings),
      });
    } catch (err) {
      setError(err.message);
    }
  }, [project, settings]);

  const updateClip = useCallback(
    async (patch) => {
      if (!project || !clip) return;
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          clips: prev.clips.map((item) => (item.id === clip.id ? { ...item, ...patch } : item)),
        };
      });
      try {
        const { clip: updated } = await api(`/api/projects/${project.id}/clips/${clip.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        setProject((prev) =>
          prev
            ? { ...prev, clips: prev.clips.map((item) => (item.id === updated.id ? updated : item)) }
            : prev
        );
      } catch (err) {
        setError(err.message);
      }
    },
    [clip, project]
  );

  const renderClips = useCallback(
    async (clipIds) => {
      if (!project) return;
      setError(null);
      try {
        const { jobs: created } = await api(`/api/projects/${project.id}/render`, {
          method: 'POST',
          body: JSON.stringify({ clipIds, aspects: aspectsToRender, styleId, options, layout }),
        });
        // The same jobs also arrive over SSE; dedupe so the queue never shows
        // a render twice (which also broke React's list keys).
        setJobs((prev) => {
          const ids = new Set(created.map((job) => job.id));
          return [...created, ...prev.filter((job) => !ids.has(job.id))];
        });
        setTab('export');
        setStage('export');
      } catch (err) {
        setError(err.message);
      }
    },
    [aspectsToRender, layout, options, project, styleId]
  );

  const deleteProject = useCallback(
    async (id) => {
      await api(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((item) => item.id !== id));
      if (project?.id === id) {
        setProject(null);
        setActiveClipId(null);
        setStage('import');
      }
    },
    [project]
  );

  const startNewVideo = useCallback(() => {
    setProject(null);
    setActiveClipId(null);
    setJobs([]);
    setProgress(null);
    setError(null);
    setPlayhead(0);
    setStage('import');
  }, []);

  const transcribing = project?.status === 'transcribing';
  const overlayVisible = Boolean(project) && (transcribing || (progress && progress.percent < 100 && project?.status !== 'ready'));
  const activeStage = stage !== 'import' && !project ? 'import' : stage;
  const exportProps = {
    project,
    clip,
    jobs,
    aspects: aspectsToRender,
    setAspects: setAspectsToRender,
    onRender: renderClips,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PC</span>
          <div>
            <strong>PulseCut</strong>
            <span className="brand-sub">local studio</span>
          </div>
          <span className="badge-local">100% local</span>
        </div>

        <StageNav stage={activeStage} onStage={setStage} hasProject={Boolean(project)} variant="top" />

        {project ? (
          <div className="project-chip">
            <span className="project-thumb" style={{ backgroundImage: `url(${project.thumbnail})` }} />
            <div className="project-chip-text">
              <strong>{project.name}</strong>
              <span>
                {project.width}×{project.height} · {Math.round(project.duration)}s · {project.clips?.length || 0} clips
              </span>
            </div>
          </div>
        ) : (
          <span className="topbar-note">Nothing leaves this machine. No uploads, no credits, no account.</span>
        )}

        <div className="topbar-actions">
          <span
            className={`engine-dot ${health?.ffmpeg ? 'ok' : 'bad'}`}
            title={health?.ffmpeg ? health.version : 'FFmpeg not found on PATH'}
          />
          {project && (
            <button className="btn ghost" onClick={startNewVideo}>
              New video
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="workspace">
        <StageNav stage={activeStage} onStage={setStage} hasProject={Boolean(project)} variant="side" />

        {activeStage === 'import' && (
          <ImportScreen
            health={health}
            projects={projects}
            settings={settings}
            onSettings={setSettings}
            onUpload={handleUpload}
            onOpen={openProject}
            onDelete={deleteProject}
            uploading={uploading}
            progress={progress}
          />
        )}

        {activeStage === 'edit' && project && (
          <main className="studio">
            <ClipRail
              project={project}
              activeClipId={clip?.id}
              onSelect={(id) => {
                const next = project.clips?.find((item) => item.id === id);
                setActiveClipId(id);
                // Move the playhead into the new clip. Setting it to 0 made the
                // preview fight two competing seeks and stutter on long files.
                setPlayhead(next?.start ?? 0);
              }}
              settings={settings}
              onSettings={setSettings}
              onRetranscribe={retranscribe}
              onRenderAll={() => renderClips(project.clips.map((item) => item.id))}
              transcribing={transcribing}
              formatDurationLabel
            />

            <section className="stage">
              <PhonePreview
                project={project}
                clip={clip}
                aspect={aspect}
                onAspect={setAspect}
                layout={layout}
                onLayout={chooseLayout}
                style={style}
                options={options}
                playhead={playhead}
                onPlayhead={setPlayhead}
                onFrame={(frame) => updateClip(frame)}
                transcribing={transcribing}
              />

              <section className={`bits ${railOpen ? '' : 'collapsed'}`}>
                <TranscriptPanel
                  project={project}
                  clip={clip}
                  playhead={playhead}
                  onSeek={seekTo}
                />
              </section>

              <button
                className={`transcript-toggle ${railOpen ? 'open' : ''}`}
                type="button"
                aria-expanded={railOpen}
                onClick={() => setRailOpen((value) => !value)}
                title={railOpen ? 'Hide the transcript' : 'Show the transcript'}
              >
                <span aria-hidden="true">{railOpen ? '▾' : '▸'}</span>
                {railOpen ? 'Hide transcript' : 'Transcript'}
              </button>

              {(transcribing || overlayVisible) && project.status !== 'ready' && (
                <div className="overlay">
                  <div className="overlay-card">
                    <h2>{project.status === 'error' ? 'Something went wrong' : 'Working on it, locally'}</h2>
                    <p className="overlay-phase">
                      {project.status === 'error'
                        ? project.error
                        : `${progress?.phase || 'Getting ready'} · ${Math.round(progress?.percent || 0)}%`}
                    </p>
                    <div className="bar">
                      <span style={{ width: `${Math.round(progress?.percent || 0)}%` }} />
                    </div>
                    {project.status === 'error' ? (
                      <button className="btn primary" onClick={retranscribe}>
                        Try again
                      </button>
                    ) : (
                      <p className="overlay-hint">
                        Speech recognition runs on your CPU. A 90 minute podcast usually takes a few minutes.
                        {project.status !== 'error' && ' You can leave this tab open.'}
                      </p>
                    )}
                    <div className="log">
                      {logs.slice(-8).map((line, index) => (
                        <div key={`${index}-${line.slice(0, 12)}`}>{line}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>

            <aside className="panel">
              <nav className="tabs">
                {TABS.map((item) => (
                  <button
                    key={item.id}
                    className={tab === item.id ? 'active' : ''}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
              <div className="panel-body">
                {tab === 'style' && (
                  <StylePanel styleId={styleId} onStyle={setStyleId} options={options} onChange={setOption} style={style} />
                )}
                {tab === 'post' && <PostPanel clip={clip} onUpdate={updateClip} />}
                {tab === 'export' && <ExportPanel {...exportProps} formatOptions={Object.keys(ASPECTS)} />}
              </div>
            </aside>
          </main>
        )}

        {activeStage === 'export' && project && (
          <main className="render-stage">
            <section className="render-hero">
              <span className="eyebrow">Final step</span>
              <h1>Render & export</h1>
              <p>
                Burn captions into your selected clips with FFmpeg. Pick the formats you need, then watch the queue
                finish locally — no upload, no waiting on someone else's server.
              </p>
              <button className="btn ghost small" type="button" onClick={() => setStage('edit')}>
                ← Back to editing
              </button>
            </section>
            <div className="render-card">
              <ExportPanel {...exportProps} />
            </div>
          </main>
        )}
      </div>
    </div>
  );
}
