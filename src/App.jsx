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

export default function App() {
  const [health, setHealth] = useState(null);
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [activeClipId, setActiveClipId] = useState(null);
  const [aspect, setAspect] = useState('9:16');
  const [layout, setLayout] = useState('fill');
  const [styleId, setStyleId] = useState('bold-pop-coral-pop');
  const [options, setOptions] = useState({ size: 1, position: 'bottom', opacity: 1, tilt: null });
  const [aspectsToRender, setAspectsToRender] = useState(['9:16']);
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

  useEffect(() => {
    api('/api/health').then(setHealth).catch(() => {});
    refreshProjects().catch(() => {});
  }, [refreshProjects]);

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
        setJobs((prev) => [...created, ...prev]);
        setTab('export');
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
      }
    },
    [project]
  );

  const transcribing = project?.status === 'transcribing';
  const overlayVisible = Boolean(project) && (transcribing || (progress && progress.percent < 100 && project?.status !== 'ready'));

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
            <button
              className="btn ghost"
              onClick={() => {
                setProject(null);
                setActiveClipId(null);
                setJobs([]);
                setProgress(null);
                setError(null);
              }}
            >
              New video
            </button>
          )}
          <button
            className="btn ghost icon-only"
            title="Show or hide the transcript"
            onClick={() => setRailOpen((value) => !value)}
          >
            {railOpen ? '▾' : '▸'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-bar">
          <span>{error}</span>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {!project ? (
        <ImportScreen
          health={health}
          projects={projects}
          settings={settings}
          onSettings={setSettings}
          onUpload={handleUpload}
          onOpen={(id) => loadProject(id)}
          onDelete={deleteProject}
          uploading={uploading}
          progress={progress}
        />
      ) : (
        <main className="studio">
          <ClipRail
            project={project}
            activeClipId={clip?.id}
            onSelect={(id) => {
              setActiveClipId(id);
              setPlayhead(0);
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
                onSeek={(time) => setPlayhead(time)}
              />
            </section>
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
              {tab === 'export' && (
                <ExportPanel
                  project={project}
                  clip={clip}
                  jobs={jobs}
                  aspects={aspectsToRender}
                  setAspects={setAspectsToRender}
                  onRender={renderClips}
                  formatOptions={Object.keys(ASPECTS)}
                />
              )}
            </div>
          </aside>

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
        </main>
      )}
    </div>
  );
}
