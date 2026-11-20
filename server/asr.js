// Local speech recognition. Runs Whisper on this machine via transformers.js
// (ONNX runtime, no cloud calls). Models are cached in data/models after the
// first download, so later runs work offline.
import fs from 'node:fs/promises';
import { MODEL_DIR } from './store.js';

export const MODELS = {
  tiny: {
    id: 'Xenova/whisper-tiny',
    label: 'Whisper Tiny',
    size: '~75 MB',
    note: 'Fastest. Fine for quick drafts and long files.',
  },
  base: {
    id: 'Xenova/whisper-base',
    label: 'Whisper Base',
    size: '~145 MB',
    note: 'Balanced accuracy and speed. Recommended.',
  },
  small: {
    id: 'Xenova/whisper-small',
    label: 'Whisper Small',
    size: '~480 MB',
    note: 'Most accurate, especially for Urdu, Hindi and accents.',
  },
};

const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 28;
const HOP_SECONDS = 27;

let asrPromise = null;
let asrKey = '';

function wavToFloat32(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Audio extraction produced a non-WAV file.');
  let offset = 12;
  let channels = 1;
  let bitDepth = 16;
  let sampleRate = SAMPLE_RATE;
  let dataOffset = 0;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buffer.readUInt16LE(offset + 10);
      sampleRate = buffer.readUInt32LE(offset + 12);
      bitDepth = buffer.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataOffset = offset + 8;
      dataLength = Math.min(size, buffer.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!dataOffset) throw new Error('WAV file has no data chunk.');
  const bytesPerSample = bitDepth / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) {
      const pos = dataOffset + (i * channels + c) * bytesPerSample;
      if (bitDepth === 16) sum += buffer.readInt16LE(pos) / 32768;
      else if (bitDepth === 32) sum += buffer.readFloatLE(pos);
      else if (bitDepth === 24) sum += buffer.readIntLE(pos, 3) / 8388608;
      else if (bitDepth === 8) sum += (buffer.readUInt8(pos) - 128) / 128;
    }
    samples[i] = sum / channels;
  }
  if (sampleRate !== SAMPLE_RATE) {
    // Whisper needs 16 kHz; resample with simple linear interpolation.
    const ratio = sampleRate / SAMPLE_RATE;
    const out = new Float32Array(Math.floor(samples.length / ratio));
    for (let i = 0; i < out.length; i += 1) {
      const pos = i * ratio;
      const low = Math.floor(pos);
      const frac = pos - low;
      out[i] = (samples[low] || 0) * (1 - frac) + (samples[low + 1] || 0) * frac;
    }
    return out;
  }
  return samples;
}

async function getAsr(model, onLog) {
  const entry = MODELS[model] || MODELS.base;
  if (asrPromise && asrKey === model) return asrPromise;
  asrKey = model;
  asrPromise = (async () => {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.cacheDir = MODEL_DIR;
    env.allowRemoteModels = true;
    onLog?.(`Loading ${entry.label} (${entry.size}). The first run downloads it once, then it runs offline.`);
    const create = (options) =>
      pipeline('automatic-speech-recognition', entry.id, {
        ...options,
        progress_callback: (event) => {
          if (event?.status === 'progress' && event.file?.endsWith('.onnx')) {
            const pct = event.progress ? Math.round(event.progress) : 0;
            onLog?.(`Downloading ${entry.label}: ${event.file.split('/').pop()} ${pct}%`);
          }
        },
      });
    try {
      return await create({ dtype: 'q8' });
    } catch (error) {
      onLog?.(`Quantised weights unavailable (${error.message.slice(0, 80)}), using default precision.`);
      return create({});
    }
  })().catch((error) => {
    asrPromise = null;
    asrKey = '';
    throw error;
  });
  return asrPromise;
}

function normalizeChunks(result, offset, fallbackEnd) {
  const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
  const words = [];
  if (chunks.length && Array.isArray(chunks[0].timestamp)) {
    for (const chunk of chunks) {
      const text = String(chunk.text || '').trim();
      if (!text) continue;
      const [rawStart, rawEnd] = chunk.timestamp;
      const startAt = (Number(rawStart) || 0) + offset;
      const endAt = rawEnd === null || rawEnd === undefined ? fallbackEnd : Number(rawEnd) + offset;
      const pieces = text.split(/\s+/).filter(Boolean);
      const span = Math.max(0.12, endAt - startAt);
      pieces.forEach((piece, index) => {
        words.push({
          start: startAt + (span * index) / pieces.length,
          end: startAt + (span * (index + 1)) / pieces.length,
          text: piece,
        });
      });
    }
    return words;
  }
  const text = String(result?.text || '').trim();
  if (!text) return words;
  const pieces = text.split(/\s+/).filter(Boolean);
  const span = Math.max(0.5, fallbackEnd - offset);
  pieces.forEach((piece, index) => {
    words.push({
      start: offset + (span * index) / pieces.length,
      end: offset + (span * (index + 1)) / pieces.length,
      text: piece,
    });
  });
  return words;
}

export async function transcribe(wavPath, { model = 'base', language = 'auto', onProgress, onLog } = {}) {
  const buffer = await fs.readFile(wavPath);
  const audio = wavToFloat32(buffer);
  if (!audio.length) throw new Error('The extracted audio was empty.');
  const duration = audio.length / SAMPLE_RATE;
  const asr = await getAsr(model, onLog);

  const whisperLanguage = language && language !== 'auto' && language !== 'hinglish' ? language : undefined;
  const words = [];
  const slices = Math.max(1, Math.ceil((duration - WINDOW_SECONDS) / HOP_SECONDS) + 1);

  for (let slice = 0; slice < slices; slice += 1) {
    const startAt = slice * HOP_SECONDS;
    const endAt = Math.min(duration, startAt + WINDOW_SECONDS);
    if (endAt - startAt < 0.4) break;
    const sliceAudio = audio.subarray(Math.floor(startAt * SAMPLE_RATE), Math.floor(endAt * SAMPLE_RATE));
    let result;
    try {
      result = await asr(sliceAudio, {
        ...(whisperLanguage ? { language: whisperLanguage } : {}),
        task: 'transcribe',
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 3,
      });
    } catch (error) {
      onLog?.(`Word timestamps unavailable for this slice (${error.message.slice(0, 90)}); using phrase timings.`);
      result = await asr(sliceAudio, {
        ...(whisperLanguage ? { language: whisperLanguage } : {}),
        task: 'transcribe',
        return_timestamps: true,
        chunk_length_s: 30,
      });
    }

    const sliceWords = normalizeChunks(result, startAt, endAt);
    for (const word of sliceWords) {
      const last = words[words.length - 1];
      if (last && word.start < last.end - 0.18) continue;
      if (last && word.start < last.start) continue;
      words.push(word);
    }
    onLog?.(
      `Transcribed ${Math.min(duration, endAt).toFixed(0)}s of ${duration.toFixed(0)}s · ${words.length} words`
    );
    onProgress?.(((slice + 1) / slices) * 100);
  }

  if (!words.length) throw new Error('No speech detected. Check the audio track or try a larger model.');

  words.sort((a, b) => a.start - b.start);
  return {
    words,
    text: words.map((word) => word.text).join(' ').replace(/\s+([,.!?])/g, '$1'),
    duration,
    model,
    language,
  };
}
