import { memo, useMemo } from 'react';
import { formatTime } from '../api.js';

const MAX_WORDS = 7000;

/** Words are sorted by start time, so the active word is a binary search away. */
function activeWordAt(words, playhead) {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= playhead) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found >= 0 && playhead < words[found].end) return words[found];
  return null;
}

// The transcript can hold thousands of words. Re-creating every span on each
// `timeupdate` was the main cause of playback freezing. Only the one line that
// contains the spoken word is allowed to re-render.
const TranscriptLine = memo(function TranscriptLine({ line, inClip, activeWordStart, onSeek }) {
  return (
    <p className={`transcript-line ${inClip ? 'in-clip' : ''}`}>
      {line.words.map((word, index) => {
        const active = activeWordStart !== null && word.start <= activeWordStart && activeWordStart < word.end;
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
});

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
        // Two groups can share identical start/end stamps (a transcription
        // artifact), so key off the group's position rather than its timestamps.
        groups.push({ id: groups.length, start: current[0].start, end: current[current.length - 1].end, words: current });
        current = [];
      }
    });
    if (current.length) groups.push({ id: groups.length, start: current[0].start, end: current[current.length - 1].end, words: current });
    return groups;
  }, [words]);

  const activeWord = useMemo(() => activeWordAt(words, playhead), [words, playhead]);

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
          const inClip = Boolean(clip && line.end > clip.start && line.start < clip.end);
          const isActiveLine = Boolean(activeWord && activeWord.start >= line.start && activeWord.start < line.end);
          return (
            <TranscriptLine
              key={line.id}
              line={line}
              inClip={inClip}
              activeWordStart={isActiveLine ? activeWord.start : null}
              onSeek={onSeek}
            />
          );
        })}
      </div>
    </section>
  );
}
