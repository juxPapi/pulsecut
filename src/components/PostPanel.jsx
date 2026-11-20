import { useEffect, useState } from 'react';
import { formatTime } from '../api.js';

export default function PostPanel({ clip, onUpdate }) {
  const [title, setTitle] = useState(clip?.title || '');
  const [tagDraft, setTagDraft] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setTitle(clip?.title || '');
  }, [clip?.id, clip?.title]);

  if (!clip) return <p className="rail-empty">Pick a clip to write its post.</p>;

  const hashtags = clip.hashtags || [];

  const commitTitle = () => {
    if (title.trim() && title !== clip.title) onUpdate({ title: title.trim() });
  };

  const addTag = () => {
    const tag = tagDraft.trim().replace(/^#/, '').replace(/\s+/g, '');
    if (!tag) return;
    onUpdate({ hashtags: [...new Set([...hashtags, tag])].slice(0, 12) });
    setTagDraft('');
  };

  const removeTag = (tag) => onUpdate({ hashtags: hashtags.filter((item) => item !== tag) });

  const copyAll = async () => {
    const text = `${clip.title}\n\n${hashtags.map((tag) => `#${tag}`).join(' ')}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard can be blocked, the title is still visible */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="post-panel">
      <div className="panel-intro">
        <h2>Post</h2>
        <p>
          Clip {clip.index} · {formatTime(clip.start)} → {formatTime(clip.end)} · {Math.round(clip.duration)}s
        </p>
      </div>

      <div className="score-block">
        <div className="score-big">
          <b>{clip.score}</b>
          <span>{clip.scoreLabel}</span>
        </div>
        <ul className="reasons">
          {(clip.reasons || []).map((reason) => (
            <li key={reason.label} className={reason.tone === 'minus' ? 'minus' : ''}>
              <span>{reason.label}</span>
              <b>
                {reason.points > 0 ? '+' : ''}
                {reason.points}
              </b>
            </li>
          ))}
        </ul>
      </div>

      <label className="field">
        <span>Title</span>
        <textarea
          rows={2}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commitTitle();
              event.target.blur();
            }
          }}
        />
      </label>

      {clip.titleOptions?.length > 1 && (
        <div className="title-options">
          <span>Other angles</span>
          <div>
            {clip.titleOptions
              .filter((option) => option !== clip.title)
              .map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setTitle(option);
                    onUpdate({ title: option });
                  }}
                >
                  {option}
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="field">
        <span>Hashtags</span>
        <div className="tag-editor">
          {hashtags.map((tag) => (
            <button key={tag} type="button" className="tag-chip" onClick={() => removeTag(tag)}>
              #{tag} <i>✕</i>
            </button>
          ))}
          <input
            placeholder="add + Enter"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
          />
        </div>
      </div>

      <button type="button" className="btn ghost full" onClick={copyAll}>
        {copied ? 'Copied' : 'Copy title + hashtags'}
      </button>

      <div className="post-stats">
        <div>
          <span>Speech pace</span>
          <b>{clip.wordsPerSecond ?? '—'} w/s</b>
        </div>
        <div>
          <span>Words</span>
          <b>{clip.words?.length || 0}</b>
        </div>
        <div>
          <span>Start</span>
          <b>{formatTime(clip.start)}</b>
        </div>
      </div>

      <details className="clip-text">
        <summary>Clip transcript</summary>
        <p>{clip.text}</p>
      </details>
    </div>
  );
}
