// Caption style catalogue, cue chunking and ASS subtitle generation.
// Shared by the studio UI (live preview) and the renderer (burned-in captions).

export const GROUPS = [
  'Bold Pop',
  'Minimal Clean',
  'Neon Nights',
  'Boxed & Blocked',
  'Retro Type',
  'Karaoke Glow',
];

export const FONT_CHOICES = [
  'Arial Black',
  'Arial',
  'Impact',
  'Segoe UI',
  'Trebuchet MS',
  'Verdana',
  'Tahoma',
  'Georgia',
  'Consolas',
  'Comic Sans MS',
];

export const ASPECTS = {
  '9:16': { id: '9:16', label: '9:16 Vertical', short: 'TikTok · Reels · Shorts', width: 1080, height: 1920 },
  '4:5': { id: '4:5', label: '4:5 Portrait', short: 'Instagram feed · LinkedIn', width: 1080, height: 1350 },
  '1:1': { id: '1:1', label: '1:1 Square', short: 'Feed · X', width: 1080, height: 1080 },
};

// Video layouts — how the source frame is composed inside the output before captions burn in.
export const LAYOUTS = [
  { id: 'fill', label: 'Fill', hint: 'One full-frame crop' },
  { id: 'blur', label: 'Blur', hint: 'Blurred backdrop behind a crisp centre' },
  { id: 'split', label: 'Split', hint: 'The frame split in half, two stacked copies' },
  { id: 'triple', label: 'Triple', hint: 'Three stacked copies' },
];

export const LAYOUT_IDS = LAYOUTS.map((item) => item.id);

export function resolveLayout(id) {
  return LAYOUT_IDS.includes(id) ? id : LAYOUTS[0].id;
}

export const LANGUAGES = [
  { id: 'auto', label: 'Auto detect', whisper: null },
  { id: 'en', label: 'English', whisper: 'en' },
  { id: 'hi', label: 'Hindi', whisper: 'hi' },
  { id: 'ur', label: 'Urdu', whisper: 'ur' },
  { id: 'hinglish', label: 'Hinglish (mixed)', whisper: 'hi' },
  { id: 'es', label: 'Spanish', whisper: 'es' },
  { id: 'fr', label: 'French', whisper: 'fr' },
  { id: 'de', label: 'German', whisper: 'de' },
  { id: 'pt', label: 'Portuguese', whisper: 'pt' },
  { id: 'ar', label: 'Arabic', whisper: 'ar' },
  { id: 'tr', label: 'Turkish', whisper: 'tr' },
  { id: 'id', label: 'Indonesian', whisper: 'id' },
  { id: 'bn', label: 'Bengali', whisper: 'bn' },
  { id: 'ta', label: 'Tamil', whisper: 'ta' },
  { id: 'ru', label: 'Russian', whisper: 'ru' },
];

export const DEFAULT_OPTIONS = {
  font: null,
  color: null,
  accent: null,
  outline: null,
  uppercase: null,
  tilt: null,
  opacity: 1,
  size: 1,
  position: 'bottom',
  boxOpacity: null,
  highlight: null,
};

function s(group, name, o = {}) {
  return {
    id: `${group.toLowerCase().replace(/[^a-z]+/g, '-')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    group,
    name,
    font: 'Arial Black',
    color: '#FFFFFF',
    accent: '#FFE14D',
    outline: '#000000',
    outlineWidth: 0,
    shadow: 0,
    box: null,
    boxOpacity: 0.88,
    uppercase: true,
    italic: false,
    tilt: 0,
    animate: 'pop',
    highlight: 'word',
    ...o,
  };
}

export const CAPTION_STYLES = [
  // ---------------------------------------------------------------- Bold Pop (15)
  s('Bold Pop', 'Coral Pop', { accent: '#FF5A47', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Lemon Punch', { accent: '#FFE14D', color: '#111111', outline: '#FFFFFF', outlineWidth: 2 }),
  s('Bold Pop', 'Mint Snap', { accent: '#38E8A6', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Sky Pop', { accent: '#4CC9F0', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Grape Soda', { accent: '#A66CFF', outlineWidth: 3, shadow: 3 }),
  s('Bold Pop', 'Tangerine', { accent: '#FF9F1C', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Cherry Bomb', { accent: '#FF3B5C', outlineWidth: 4, shadow: 2 }),
  s('Bold Pop', 'Bubblegum', { accent: '#FF7AD9', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Electric Lime', { accent: '#C6FF00', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Hot Honey', { accent: '#FFB703', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Ultra Violet', { accent: '#7B61FF', outlineWidth: 3, shadow: 3 }),
  s('Bold Pop', 'Fresh Mint', { accent: '#00E5B0', outlineWidth: 3, shadow: 2 }),
  s('Bold Pop', 'Sunset', { accent: '#FF7043', outlineWidth: 3, tilt: -2 }),
  s('Bold Pop', 'Cobalt', { accent: '#2F6BFF', outlineWidth: 3 }),
  s('Bold Pop', 'Rose Gold', { accent: '#F2B8A2', color: '#1B1B1B', outline: '#FFFFFF', outlineWidth: 2 }),

  // ------------------------------------------------------------- Minimal Clean (15)
  s('Minimal Clean', 'Paper White', { font: 'Segoe UI', uppercase: false, outlineWidth: 0, shadow: 1, accent: '#FFFFFF' }),
  s('Minimal Clean', 'Ink', { font: 'Segoe UI', color: '#111111', accent: '#FF5A47', uppercase: false, shadow: 0, box: '#FFFFFF', boxOpacity: 0.92, outlineWidth: 0 }),
  s('Minimal Clean', 'Soft Grey', { font: 'Arial', color: '#F5F5F5', accent: '#B9B9B9', uppercase: false, shadow: 2 }),
  s('Minimal Clean', 'Serif Calm', { font: 'Georgia', color: '#FFFFFF', accent: '#EADFC8', uppercase: false, shadow: 2, animate: 'fade' }),
  s('Minimal Clean', 'Lower Left', { font: 'Trebuchet MS', uppercase: false, shadow: 1, accent: '#8FE3FF' }),
  s('Minimal Clean', 'Cloud', { font: 'Segoe UI', color: '#20303C', accent: '#0A84FF', uppercase: false, box: '#F4FAFF', boxOpacity: 0.9 }),
  s('Minimal Clean', 'Mono Cut', { font: 'Consolas', uppercase: false, shadow: 2, accent: '#9AE6B4' }),
  s('Minimal Clean', 'Thin Caps', { font: 'Segoe UI', accent: '#FFFFFF', italic: false, shadow: 1 }),
  s('Minimal Clean', 'Slate', { font: 'Tahoma', color: '#E8EEF5', accent: '#7AA2FF', uppercase: false, box: '#0E1622', boxOpacity: 0.82 }),
  s('Minimal Clean', 'Warm Cream', { font: 'Georgia', color: '#FFF8EC', accent: '#FFC98B', uppercase: false, shadow: 2 }),
  s('Minimal Clean', 'Editorial', { font: 'Georgia', uppercase: false, shadow: 0, box: '#000000', boxOpacity: 0.72, accent: '#FFFFFF' }),
  s('Minimal Clean', 'Quiet Caps', { font: 'Verdana', color: '#FAFAFA', accent: '#D7FF6B', shadow: 2, outlineWidth: 1 }),
  s('Minimal Clean', 'Newsprint', { font: 'Arial', color: '#151515', accent: '#B00020', uppercase: false, box: '#FFFFFF', boxOpacity: 0.86 }),
  s('Minimal Clean', 'Night Text', { font: 'Segoe UI', color: '#FFFFFF', accent: '#6EE7FF', uppercase: false, shadow: 3 }),
  s('Minimal Clean', 'Studio', { font: 'Trebuchet MS', color: '#F7F7F7', accent: '#FFE14D', uppercase: false, shadow: 1, tilt: 0 }),

  // --------------------------------------------------------------- Neon Nights (14)
  s('Neon Nights', 'Cyber Cyan', { accent: '#00FFF0', color: '#EAFBFF', outline: '#003A3A', outlineWidth: 3, shadow: 6, font: 'Impact' }),
  s('Neon Nights', 'Hot Pink', { accent: '#FF2DAA', color: '#FFE9F6', outline: '#3D0022', outlineWidth: 3, shadow: 6, font: 'Impact' }),
  s('Neon Nights', 'Acid', { accent: '#B4FF39', color: '#F4FFE0', outline: '#173300', outlineWidth: 3, shadow: 5, font: 'Impact' }),
  s('Neon Nights', 'Ultraviolet', { accent: '#B14BFF', color: '#F3E9FF', outline: '#20003D', outlineWidth: 3, shadow: 6, font: 'Impact' }),
  s('Neon Nights', 'Arcade', { accent: '#FFE24B', color: '#FFFDEB', outline: '#332600', outlineWidth: 3, shadow: 5, font: 'Impact', tilt: -2 }),
  s('Neon Nights', 'Laser Red', { accent: '#FF3B3B', color: '#FFEDED', outline: '#330000', outlineWidth: 3, shadow: 6, font: 'Impact' }),
  s('Neon Nights', 'Deep Sea', { accent: '#3B82FF', color: '#E8F1FF', outline: '#00122E', outlineWidth: 3, shadow: 6, font: 'Impact' }),
  s('Neon Nights', 'Synthwave', { accent: '#FF6AD5', color: '#FFF0FB', outline: '#2B0033', outlineWidth: 3, shadow: 7, font: 'Impact', italic: true }),
  s('Neon Nights', 'Toxic', { accent: '#39FF88', color: '#EEFFF5', outline: '#003318', outlineWidth: 3, shadow: 5, font: 'Impact' }),
  s('Neon Nights', 'Neon Mono', { accent: '#FFFFFF', color: '#FFFFFF', outline: '#1A1A1A', outlineWidth: 2, shadow: 8, font: 'Arial Black' }),
  s('Neon Nights', 'Club', { accent: '#FF8A00', color: '#FFF4E6', outline: '#331A00', outlineWidth: 3, shadow: 5, font: 'Impact' }),
  s('Neon Nights', 'Ice', { accent: '#9FE8FF', color: '#FFFFFF', outline: '#002B3A', outlineWidth: 3, shadow: 5, font: 'Impact' }),
  s('Neon Nights', 'Glow Ink', { accent: '#7FFFD4', color: '#E9FFFA', outline: '#00241C', outlineWidth: 2, shadow: 9, font: 'Segoe UI', uppercase: false }),
  s('Neon Nights', 'Retrowave', { accent: '#FFD166', color: '#FFF6E0', outline: '#3A2400', outlineWidth: 3, shadow: 6, font: 'Impact', tilt: 1 }),

  // ----------------------------------------------------------- Boxed & Blocked (15)
  s('Boxed & Blocked', 'Black Bar', { font: 'Arial', uppercase: false, box: '#000000', boxOpacity: 0.85, accent: '#FFE14D' }),
  s('Boxed & Blocked', 'White Slab', { font: 'Arial Black', color: '#111111', box: '#FFFFFF', boxOpacity: 0.95, accent: '#FF3B5C' }),
  s('Boxed & Blocked', 'Highlight Pen', { font: 'Arial', color: '#111111', box: '#FFE14D', boxOpacity: 0.95, accent: '#111111' }),
  s('Boxed & Blocked', 'Red Corner', { font: 'Arial Black', box: '#E02424', boxOpacity: 0.9, accent: '#FFFFFF' }),
  s('Boxed & Blocked', 'Mint Bar', { font: 'Arial Black', color: '#04231A', box: '#7CFFC4', boxOpacity: 0.92, accent: '#04231A' }),
  s('Boxed & Blocked', 'Blue Tag', { font: 'Trebuchet MS', box: '#1B4DFF', boxOpacity: 0.9, accent: '#FFE14D' }),
  s('Boxed & Blocked', 'News Ticker', { font: 'Arial', box: '#111111', boxOpacity: 0.92, accent: '#FF3B3B', uppercase: false }),
  s('Boxed & Blocked', 'Caption Card', { font: 'Segoe UI', color: '#0B1B26', box: '#EAF7FF', boxOpacity: 0.94, accent: '#0077CC', uppercase: false }),
  s('Boxed & Blocked', 'Pink Block', { font: 'Arial Black', box: '#FF3D8B', boxOpacity: 0.9, accent: '#FFFFFF' }),
  s('Boxed & Blocked', 'Sun Bar', { font: 'Impact', color: '#2A1A00', box: '#FFC300', boxOpacity: 0.94, accent: '#2A1A00' }),
  s('Boxed & Blocked', 'Night Bar', { font: 'Impact', box: '#0A0F1A', boxOpacity: 0.86, accent: '#6EE7FF' }),
  s('Boxed & Blocked', 'Split', { font: 'Arial Black', box: '#FFFFFF', boxOpacity: 0.92, color: '#111111', accent: '#FF0057' }),
  s('Boxed & Blocked', 'Olive', { font: 'Arial', box: '#2F3B1E', boxOpacity: 0.9, accent: '#D8FF8A' }),
  s('Boxed & Blocked', 'Purple Slab', { font: 'Arial Black', box: '#5B21B6', boxOpacity: 0.9, accent: '#FFE14D' }),
  s('Boxed & Blocked', 'Paper Cut', { font: 'Georgia', color: '#1A1A1A', box: '#FFF8E7', boxOpacity: 0.95, accent: '#C2410C', uppercase: false }),

  // ---------------------------------------------------------------- Retro Type (14)
  s('Retro Type', 'Varsity', { font: 'Impact', color: '#FFF3D6', outline: '#7A1F1F', outlineWidth: 4, shadow: 2, tilt: -2 }),
  s('Retro Type', 'Poster', { font: 'Georgia', color: '#2B1B0E', box: '#F2E3C6', boxOpacity: 0.93, accent: '#9C2B00', uppercase: false }),
  s('Retro Type', 'Arcade Cabinet', { font: 'Consolas', color: '#FFE24B', outline: '#3B2A00', outlineWidth: 2, shadow: 4 }),
  s('Retro Type', 'Sepia', { font: 'Georgia', color: '#F6E7C9', accent: '#E0A458', uppercase: false, shadow: 3 }),
  s('Retro Type', 'Typewriter', { font: 'Courier New', color: '#111111', box: '#EFE7D3', boxOpacity: 0.94, accent: '#8B0000', uppercase: false }),
  s('Retro Type', 'Disco', { font: 'Impact', accent: '#FFD166', color: '#FFFFFF', outline: '#2B1B4D', outlineWidth: 3, shadow: 5, tilt: 2 }),
  s('Retro Type', 'Comic', { font: 'Comic Sans MS', color: '#FFFFFF', outline: '#000000', outlineWidth: 4, accent: '#FFE14D' }),
  s('Retro Type', 'Warm Grain', { font: 'Trebuchet MS', color: '#FFF1D6', accent: '#FFB26B', uppercase: false, shadow: 3, tilt: -1 }),
  s('Retro Type', 'Motel', { font: 'Impact', color: '#FF5A47', outline: '#FFFFFF', outlineWidth: 3, shadow: 3 }),
  s('Retro Type', 'Vinyl', { font: 'Georgia', color: '#111111', box: '#F8F0E0', boxOpacity: 0.9, accent: '#B45309', uppercase: false, italic: true }),
  s('Retro Type', 'Drive In', { font: 'Impact', color: '#FFF8E1', outline: '#1F3A2E', outlineWidth: 3, shadow: 4 }),
  s('Retro Type', 'Faded Film', { font: 'Segoe UI', color: '#EDEAE3', accent: '#C9B18B', uppercase: false, shadow: 2 }),
  s('Retro Type', 'Sticker', { font: 'Arial Black', color: '#FFFFFF', outline: '#111111', outlineWidth: 3, accent: '#FF7AD9', tilt: -3 }),
  s('Retro Type', 'Broadcast', { font: 'Verdana', color: '#FFFFFF', box: '#101820', boxOpacity: 0.82, accent: '#FFD400' }),

  // -------------------------------------------------------------- Karaoke Glow (14)
  s('Karaoke Glow', 'Sing Along', { font: 'Arial Black', accent: '#FFE14D', color: '#4A4A4A', outline: '#000000', outlineWidth: 2 }),
  s('Karaoke Glow', 'Pop Line', { font: 'Arial Black', accent: '#FF5A47', color: '#FFFFFF', shadow: 2, highlight: 'line' }),
  s('Karaoke Glow', 'Wave', { font: 'Segoe UI', accent: '#4CC9F0', color: '#F0FBFF', uppercase: false, shadow: 2 }),
  s('Karaoke Glow', 'Highlight Blue', { font: 'Arial Black', accent: '#3B82FF', color: '#FFFFFF', box: '#000000', boxOpacity: 0.6 }),
  s('Karaoke Glow', 'Golden', { font: 'Georgia', accent: '#FFC94D', color: '#FFF6DA', uppercase: false, shadow: 3 }),
  s('Karaoke Glow', 'Focus', { font: 'Arial', accent: '#FFFFFF', color: '#8E8E8E', uppercase: false, shadow: 2 }),
  s('Karaoke Glow', 'Bright Word', { font: 'Trebuchet MS', accent: '#C6FF00', color: '#FFFFFF', outline: '#111111', outlineWidth: 2 }),
  s('Karaoke Glow', 'Soft Glow', { font: 'Segoe UI', accent: '#FFB3C7', color: '#FFFFFF', uppercase: false, shadow: 5 }),
  s('Karaoke Glow', 'Duet', { font: 'Arial Black', accent: '#A66CFF', color: '#FFFFFF', shadow: 3 }),
  s('Karaoke Glow', 'Underline', { font: 'Arial', accent: '#FFE14D', color: '#FFFFFF', uppercase: false, box: '#000000', boxOpacity: 0.55 }),
  s('Karaoke Glow', 'Pulse', { font: 'Impact', accent: '#00E5B0', color: '#FFFFFF', shadow: 4 }),
  s('Karaoke Glow', 'Studio Karaoke', { font: 'Verdana', accent: '#FF7AD9', color: '#FFFFFF', box: '#1A0016', boxOpacity: 0.62 }),
  s('Karaoke Glow', 'Night Line', { font: 'Segoe UI', accent: '#9AE6B4', color: '#E6FFF3', uppercase: false, shadow: 3, highlight: 'line' }),
  s('Karaoke Glow', 'Bold Track', { font: 'Arial Black', accent: '#FF9F1C', color: '#FFFFFF', outline: '#000000', outlineWidth: 3 }),
];

export function stylesByGroup() {
  return GROUPS.map((group) => ({ group, styles: CAPTION_STYLES.filter((st) => st.group === group) }));
}

export function getStyle(id) {
  return CAPTION_STYLES.find((st) => st.id === id) || CAPTION_STYLES[0];
}

export function resolveStyle(id, options = {}) {
  const base = getStyle(id);
  const out = { ...base };
  for (const key of ['font', 'color', 'accent', 'outline', 'uppercase', 'tilt', 'highlight']) {
    if (options[key] !== null && options[key] !== undefined && options[key] !== '') out[key] = options[key];
  }
  if (options.opacity !== undefined && options.opacity !== null) out.opacity = Number(options.opacity);
  if (options.boxOpacity !== undefined && options.boxOpacity !== null && out.box) {
    out.boxOpacity = Number(options.boxOpacity);
  }
  return out;
}

// ------------------------------------------------------------------ helpers

function hexToAss(hex, alpha = 0) {
  const clean = String(hex || '#FFFFFF').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const r = full.slice(0, 2);
  const g = full.slice(2, 4);
  const b = full.slice(4, 6);
  return `&H${Math.round(alpha * 255).toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}&`.toUpperCase();
}

function assTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(Math.min(cs, 99)).padStart(2, '0')}`;
}

function escapeAss(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, ' ');
}

// Split a cue's words into at most two balanced lines.
function wrapWords(words, maxCharsPerLine) {
  const lines = [[]];
  let len = 0;
  for (const word of words) {
    const add = (len ? 1 : 0) + word.text.length;
    if (len + add > maxCharsPerLine && lines[lines.length - 1].length) {
      lines.push([]);
      len = 0;
    }
    lines[lines.length - 1].push(word);
    len += (len ? 1 : 0) + word.text.length;
  }
  return lines;
}

export function toCues(words, opts = {}) {
  const maxWords = opts.maxWords ?? 4;
  const maxChars = opts.maxChars ?? 24;
  const cues = [];
  let cur = null;
  const push = () => {
    if (cur && cur.words.length) cues.push({ start: cur.start, end: cur.end, words: cur.words });
    cur = null;
  };
  for (const raw of words || []) {
    const text = String(raw.text || '').trim();
    if (!text) continue;
    const word = { start: Number(raw.start) || 0, end: Number(raw.end) || Number(raw.start) || 0, text };
    if (cur) {
      const gap = word.start - cur.end;
      const prev = cur.words[cur.words.length - 1];
      const wouldBeLong = cur.words.length >= maxWords;
      const wouldBeWide = cur.chars + 1 + text.length > maxChars;
      const sentenceEnd = /[.!?…]$/.test(prev.text);
      const tooLong = word.end - cur.start > 3.6;
      if (gap > 0.55 || wouldBeLong || wouldBeWide || sentenceEnd || tooLong) push();
    }
    if (!cur) cur = { start: word.start, end: word.end, words: [], chars: 0 };
    cur.words.push(word);
    cur.chars += (cur.chars ? 1 : 0) + text.length;
    cur.end = word.end;
    if (word.end - cur.start > 0.1 && cur.words.length === 1) cur.end = word.end;
  }
  push();
  return cues;
}

/**
 * Build an ASS subtitle document for a rendered clip.
 * `cues` are the chunked caption lines, `style` is a resolved caption style.
 */
export function buildAss({ width, height, cues, style, offset = 0 }) {
  const st = style;
  const sizeScale = Number(st.size || 1);
  const fontSize = Math.round(width * 0.068 * sizeScale);
  const outline = Number(st.outlineWidth || 0) * (width / 1080);
  const shadow = Number(st.shadow || 0) * (width / 1080);
  const marginV = Math.round(height * (st.position === 'top' ? 0.14 : st.position === 'middle' ? 0.42 : 0.16));
  const alignment = st.position === 'top' ? 8 : st.position === 'middle' ? 5 : 2;
  const textColor = hexToAss(st.color, 1 - Number(st.opacity ?? 1));
  const accentColor = hexToAss(st.accent, 1 - Number(st.opacity ?? 1));
  const outlineColor = hexToAss(st.outline, Number(st.opacity ?? 1) < 0.9 ? 0.35 : 0);
  const boxColor = hexToAss(st.box || '#000000', 1 - Number(st.boxOpacity ?? 0.88));
  const borderStyle = st.box ? 3 : 1;
  const bold = -1;
  const uppercase = st.uppercase ? (text) => text.toUpperCase() : (text) => text;
  const tilt = Number(st.tilt || 0);
  // Arial Black averages ~0.62em per glyph; keep 8% of the frame as side margin.
  const maxCharsPerLine = Math.max(10, Math.floor((width * 0.84) / (fontSize * 0.62)));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
`;
  const styles = `
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${st.font},${fontSize},${textColor},${accentColor},${outlineColor},${boxColor},${bold},${st.italic ? -1 : 0},0,0,100,100,0,0,${borderStyle},${outline.toFixed(1)},${shadow.toFixed(1)},${alignment},40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  const rot = tilt ? `\\frz${tilt}` : '';
  const anim =
    st.animate === 'pop' ? '\\fscx86\\fscy86\\t(0,130,\\fscx100\\fscy100)' : st.animate === 'fade' ? '\\fad(160,120)' : '';

  for (const cue of cues) {
    const lines = wrapWords(cue.words, maxCharsPerLine);
    const start = cue.start - offset;
    const end = cue.end - offset;
    if (end <= 0) continue;
    const plain = lines
      .map((line) => line.map((w) => escapeAss(uppercase(w.text))).join(' '))
      .join('\\N');

    if (st.highlight === 'word' && cue.words.length > 1) {
      cue.words.forEach((word, idx) => {
        const wStart = Math.max(start, word.start - offset);
        const wEnd = idx === cue.words.length - 1 ? end : Math.min(end, cue.words[idx + 1].start - offset);
        if (wEnd <= wStart) return;
        const bodyLines = lines.map((line) =>
          line
            .map((w) => {
              const label = escapeAss(uppercase(w.text));
              return w === word ? `{\\c${accentColor}}${label}{\\c${textColor}}` : label;
            })
            .join(' ')
        );
        const intro = idx === 0 ? anim : '';
        events.push(
          `Dialogue: 0,${assTime(wStart)},${assTime(Math.max(wEnd, wStart + 0.05))},Cap,,0,0,0,,{${rot}${intro}}${bodyLines.join('\\N')}`
        );
      });
    } else {
      events.push(
        `Dialogue: 0,${assTime(Math.max(start, 0))},${assTime(Math.max(end, start + 0.1))},Cap,,0,0,0,,{${rot}${anim}}${plain}`
      );
    }
  }

  return `${header}${styles}${events.join('\n')}\n`;
}
