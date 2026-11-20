// Like & subscribe end card, appended after the composed clip content.
// Shared by the FFmpeg renderer (drawbox/drawtext) and the canvas preview so
// both paint the same end card.

export const OUTRO_DURATION = 4;

export const OUTRO_BACKGROUND = '#080A0E';
export const OUTRO_LIME = '#C8FF3D';
export const OUTRO_INK = '#0B0D11';
export const OUTRO_TEXT = '#F2F5FA';

export const CHANNEL = {
  name: 'PulseCut',
  handle: '@pulsecut',
  likes: '128K',
  subscribers: '48.2K',
};

// Layout in fractions of the frame so the FFmpeg render and the canvas preview
// agree on where the end card lives at any aspect ratio.
export const OUTRO_GEOMETRY = {
  handle: { y: 0.09, size: 0.042, text: CHANNEL.handle },
  like: { y: 0.33, size: 0.46, text: 'LIKE', textSize: 0.072, counter: CHANNEL.likes, counterY: 0.8 },
  subscribe: { y: 0.78, size: 0.12, text: 'SUBSCRIBE', textSize: 0.052 },
};
