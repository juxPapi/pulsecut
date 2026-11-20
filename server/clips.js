// Finds the moments worth cutting and explains why they scored the way they did.
// Purely local heuristics: hook strength, numbers, emotion, pacing, payoff, language mix.

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those i you he she it we they me him her us them my your his its our their
   to of in on at for with from by as is are was were be been being am do does did done have has had not no so just very really
   can could would should will shall may might about into over under again more most some any all what who whom which when where
   why how there here they're we're you're it's that's i'm don't didn't doesn't isn't aren't wasn't weren't won't can't
   get got go going like know think want need make made say said thing things one two also because while out up down off`
    .split(/\s+/)
    .filter(Boolean)
);

const HOOK_RE = /\b(how|why|what|nobody|everyone|never|always|stop|secret|truth|mistake|biggest|worst|best|free|actually|listen|imagine|most people|turns out|the problem|the reason|here'?s)\b/gi;
const EMOTION_RE = /\b(love|hate|scared|afraid|crazy|insane|shocked|amazing|terrible|painful|proud|angry|hard|hurt|risk|fail|failure|win|broke|broke down|breakthrough|obsessed)\b/gi;
const PAYOFF_RE = /\b(that'?s why|which means|the result|and that|turns out|here'?s|bottom line|in short|at the end|so the)\b/i;
const FILLER_RE = /\b(um+|uh+|erm+|you know|basically|literally|kind of|sort of)\b/gi;
const STORY_RE = /\b(when i|i was|one day|last year|my friend|my client|we built|i tried|i lost|i made|i spent)\b/i;
const MONEY_RE = /(\d+[.,]?\d*\s?(k|m|%|dollars?|bucks|euros?|rupees?|pkr|inr|usd)\b|\$\s?\d)/gi;

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimTo(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.6 ? space : max).trim()}…`;
}

function sentenceCase(text) {
  const cleaned = cleanText(text).replace(/^[\s,.;:–—-]+/, '');
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function buildSentences(words) {
  const sentences = [];
  let current = [];
  words.forEach((word, index) => {
    current.push(word);
    const next = words[index + 1];
    const ended = /[.!?…]$/.test(word.text);
    const gap = next ? next.start - word.end : 10;
    if (!next || ended || gap > 0.55) {
      const start = current[0].start;
      const end = current[current.length - 1].end;
      if (end - start > 0.25) {
        sentences.push({
          words: current,
          start,
          end,
          text: current.map((w) => w.text).join(' '),
        });
      }
      current = [];
    }
  });
  if (current.length) {
    sentences.push({
      words: current,
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((w) => w.text).join(' '),
    });
  }
  return sentences;
}

export function wordsFromText(text, duration) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const weighted = tokens.map((token) => ({
    token,
    weight: Math.max(1, token.replace(/[^\p{L}\p{N}]/gu, '').length),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0) || 1;
  let cursor = 0;
  return weighted.map(({ token, weight }) => {
    const span = (weight / total) * duration;
    const start = cursor;
    cursor += span;
    return { start, end: Math.min(duration, cursor), text: token };
  });
}

function keywords(text) {
  const counts = new Map();
  for (const raw of String(text).toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{3,}/gu) || []) {
    const word = raw.replace(/[’']s$/, '');
    if (STOPWORDS.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
}

function hashtagsFor(text, language) {
  const tags = keywords(text)
    .slice(0, 4)
    .map(([word]) => `#${word.replace(/[^\p{L}\p{N}]/gu, '')}`)
    .filter((tag) => tag.length > 2);
  const platform =
    language === 'ur'
      ? ['#urdu', '#shorts', '#reels']
      : language === 'hi'
        ? ['#hindi', '#shorts', '#reels']
        : language === 'hinglish'
          ? ['#hinglish', '#shorts', '#reels']
          : ['#shorts', '#reels', '#fyp'];
  return [...new Set([...tags, ...platform])].slice(0, 7);
}

function titleFor(window) {
  const first = sentenceCase(cleanText(window.sentences[0]?.text || ''));
  const second = sentenceCase(cleanText(window.sentences[1]?.text || ''));
  const third = sentenceCase(cleanText(window.sentences[2]?.text || ''));

  const strip = (value) => value.replace(/^(so|and|but|like|you know|um+|uh+)[,\s]+/i, '').replace(/[,;:–—-]+$/, '');

  const options = [];
  const primary = strip(first);
  if (primary) options.push(trimTo(primary, 68));
  if (second && second.length > 12) options.push(trimTo(strip(second), 68));
  const combined = strip(`${first} ${second}`);
  if (combined.length > 24) options.push(trimTo(combined, 68));
  if (!options.length && third) options.push(trimTo(strip(third), 68));

  const title = options[0] || 'Untitled clip';
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    titleOptions: [...new Set(options)].slice(0, 3),
  };
}

function scoreLabel(score) {
  if (score >= 82) return 'Scroll-stopper';
  if (score >= 68) return 'Strong hook';
  if (score >= 52) return 'Solid';
  return 'Filler';
}

function evaluate(sentences, from, to, duration, language) {
  const windowSentences = sentences.slice(from, to);
  const words = windowSentences.flatMap((sentence) => sentence.words);
  const start = words[0].start;
  const end = words[words.length - 1].end;
  const seconds = Math.max(0.5, end - start);
  const text = cleanText(windowSentences.map((sentence) => sentence.text).join(' '));
  const lower = text.toLowerCase();
  const reasons = [];
  let score = 34;

  const hookText = cleanText(windowSentences[0]?.text || '').toLowerCase();
  if (hookText.includes('?')) {
    score += 11;
    reasons.push({ label: 'Opens with a question', points: 11, tone: 'plus' });
  }
  const hookHits = [...new Set((hookText.match(HOOK_RE) || []).map((hit) => hit.toLowerCase()))];
  if (hookHits.length) {
    const points = Math.min(13, 5 + hookHits.length * 3);
    score += points;
    reasons.push({ label: `Hook words: ${hookHits.slice(0, 3).join(', ')}`, points, tone: 'plus' });
  }
  const numbers = (lower.match(/\b\d+([.,]\d+)?%?\b/g) || []).length;
  if (numbers) {
    const points = Math.min(14, numbers * 4);
    score += points;
    reasons.push({ label: `${numbers} concrete number${numbers > 1 ? 's' : ''}`, points, tone: 'plus' });
  }
  if (MONEY_RE.test(lower)) {
    score += 6;
    reasons.push({ label: 'Mentions money or a result', points: 6, tone: 'plus' });
  }
  const emotions = [...new Set((lower.match(EMOTION_RE) || []).map((hit) => hit.toLowerCase()))];
  if (emotions.length) {
    const points = Math.min(12, emotions.length * 3);
    score += points;
    reasons.push({ label: `Feeling: ${emotions.slice(0, 2).join(', ')}`, points, tone: 'plus' });
  }
  if (STORY_RE.test(lower)) {
    score += 7;
    reasons.push({ label: 'Personal story beat', points: 7, tone: 'plus' });
  }
  if (PAYOFF_RE.test(lower.slice(-180))) {
    score += 9;
    reasons.push({ label: 'Lands a payoff line', points: 9, tone: 'plus' });
  }

  const wordsPerSecond = words.length / seconds;
  if (wordsPerSecond >= 2.3 && wordsPerSecond <= 3.9) {
    score += 10;
    reasons.push({ label: 'Pace fits short-form', points: 10, tone: 'plus' });
  } else if (wordsPerSecond >= 1.5 && wordsPerSecond < 2.3) {
    score += 4;
  } else if (wordsPerSecond < 1.2) {
    score -= 14;
    reasons.push({ label: 'Long silent stretches', points: -14, tone: 'minus' });
  } else if (wordsPerSecond > 5) {
    score -= 6;
    reasons.push({ label: 'Too fast to follow', points: -6, tone: 'minus' });
  }

  if (seconds >= 20 && seconds <= 40) {
    score += 8;
    reasons.push({ label: 'Length is right on', points: 8, tone: 'plus' });
  } else if ((seconds >= 14 && seconds < 20) || (seconds > 40 && seconds <= 52)) {
    score += 3;
  } else if (seconds > 55) {
    score -= 7;
    reasons.push({ label: 'Longer than a short', points: -7, tone: 'minus' });
  }

  if (/[.!?…]$/.test(text)) {
    score += 4;
    reasons.push({ label: 'Ends on a complete thought', points: 4, tone: 'plus' });
  }

  const fillers = (lower.match(FILLER_RE) || []).length;
  if (fillers > 1) {
    const points = -Math.min(8, fillers * 2);
    score += points;
    reasons.push({ label: `${fillers} filler words`, points, tone: 'minus' });
  }

  const hasLatin = /[A-Za-z]/.test(text);
  const hasOtherScript = /[\u0600-\u06FF\u0900-\u097F]/.test(text);
  if (hasLatin && hasOtherScript) {
    score += 6;
    reasons.push({ label: 'Code-switched speech detected', points: 6, tone: 'plus' });
  }

  score = Math.round(Math.max(24, Math.min(98, score)));
  const sorted = reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 4);
  const meta = titleFor({ sentences: windowSentences });

  return {
    start: Number(start.toFixed(2)),
    end: Number(end.toFixed(2)),
    duration: Number(seconds.toFixed(2)),
    score,
    scoreLabel: scoreLabel(score),
    reasons: sorted,
    text,
    excerpt: trimTo(text, 190),
    words,
    sentences: windowSentences.map((sentence) => ({
      start: Number(sentence.start.toFixed(2)),
      end: Number(sentence.end.toFixed(2)),
      text: sentence.text,
    })),
    ...meta,
    hashtags: hashtagsFor(text, language),
    wordsPerSecond: Number(wordsPerSecond.toFixed(2)),
  };
}

/** Score an exact range (used when the user trims a clip by hand). */
export function scoreRange(allWords, start, end, language = 'auto') {
  const words = allWords.filter((word) => word.end > start && word.start < end);
  if (!words.length) return null;
  const sentences = buildSentences(words);
  if (!sentences.length) return null;
  return evaluate(sentences, 0, sentences.length, Math.max(end, 1), language);
}

export function findClips({ words, duration, language = 'auto', limit = 8 }) {
  const sentences = buildSentences(words);
  if (!sentences.length) return [];
  const candidates = [];
  const longest = 58;

  for (let from = 0; from < sentences.length; from += 1) {
    if (sentences[from].start > duration - 8) continue;
    let to = from + 1;
    while (to < sentences.length && sentences[to].end - sentences[from].start <= longest) to += 1;
    // Evaluate every prefix ending between 14s and 58s so we keep the best ending.
    for (let end = from + 1; end <= to; end += 1) {
      const span = sentences[end - 1].end - sentences[from].start;
      if (span < 14) continue;
      if (span > longest) break;
      candidates.push({ from, to: end, span });
    }
  }

  const scored = candidates.map((candidate) => evaluate(sentences, candidate.from, candidate.to, duration, language));
  scored.sort((a, b) => b.score - a.score);

  const picked = [];
  for (const clip of scored) {
    if (picked.length >= limit) break;
    const clashes = picked.some((other) => {
      const overlap = Math.min(other.end, clip.end) - Math.max(other.start, clip.start);
      const shorter = Math.min(other.end - other.start, clip.end - clip.start);
      return overlap > 0 && overlap / shorter > 0.35;
    });
    if (clashes) continue;
    picked.push(clip);
  }

  return picked
    .sort((a, b) => a.start - b.start)
    .map((clip, index) => ({
      ...clip,
      index: index + 1,
      id: `clip-${index + 1}-${Math.round(clip.start)}`,
      focus: 0.5,
      focusY: 0.5,
      zoom: 1,
    }));
}
