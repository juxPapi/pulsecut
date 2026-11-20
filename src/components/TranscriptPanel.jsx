import { useMemo } from 'react';
import { formatTime } from '../api.js';

const MAX_WORDS = 7000;

export default function TranscriptPanel({ project, clip, playhead, onSeek }) {
  const words = project.transcript?.words || [];

  const lines = useMemo(() => {
    const limited = words.slice(0, MAX_WORDS);
    const groups = [];
    let current = [];
    limited.forEach((word, index) => {
      current.push(word);
      const next = limited[index + 1];
      const gap = next ? next.start - word.end : 10;
      if (!next || /[.!?…]$/.test(word.text) || gap > 0.8 || current.length >= 42) {
        groups.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
        current = [];
      }
    });
    if (current.length) groups.push({ start: current[0].start, end: current[current.length - 1].end, words: current });
    return groups;
  }, [words]);

  return (
    <section className="transcript">
      <div className="transcript-head">
        <h2>Transcript</h2>
        <span>
          {words.length ? `${words.length} words · ${project.transcript?.model || 'manual'}` : 'Not transcribed yet'}
          {words.length > MAX_WORDS ? ` · showing first ${MAX_WORDS}` : ''}
        </span>
      </div>
      <div className="transcript-scroll">
        {!lines.length && <p className="rail-empty">The transcript lands here as soon as the audio has been read.</p>}
        {lines.map((line) => {
          const inClip = clip && line.end > clip.start && line.start < clip.end;
          return (
            <p key={`${line.start}-${line.end}`} className={`transcript-line ${inClip ? 'in-clip' : ''}`}>
              {line.words.map((word, index) => {
                const active = playhead >= word.start && playhead < word.end;
                return (
                  <span
                    key={`${word.start}-${index}`}
                    className={active ? 'word active' : 'word'}
                    onClick={() => onSeek(word.start)}
                    title={formatTime(word.start)}
                  >
                    {word.text}{' '}
                  </span>
                );
              })}
            </p>
          );
        })}
      </div>
    </section>
  );
}
