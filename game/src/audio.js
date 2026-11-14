// Sound, synthesized live with WebAudio — no audio files, no network. Every
// effect is a few oscillators or a burst of filtered noise. Created lazily on the
// first user gesture; in screenshot mode there is no gesture, so it stays silent.
let ctx = null;
let master = null;
let enabled = true;

export function initAudio() {
  if (ctx || !enabled) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { enabled = false; return; }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  } catch {
    enabled = false;
  }
}

export function suspendAudio() {
  enabled = false;
}

function noiseBuffer(seconds) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function burst({ duration = 0.12, freq = 1200, type = 'lowpass', gain = 0.5, when = 0 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + when;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(duration + 0.05);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  source.connect(filter).connect(amp).connect(master);
  source.start(t);
  source.stop(t + duration + 0.05);
}

function tone({ freq = 440, to = null, duration = 0.12, type = 'square', gain = 0.18, when = 0 }) {
  if (!ctx || !enabled) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, t);
  amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(amp).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

export const sfx = {
  shot(kind) {
    if (kind === 'deadeye') { burst({ duration: 0.28, freq: 900, gain: 0.8 }); tone({ freq: 160, to: 60, duration: 0.22, type: 'sine', gain: 0.5 }); }
    else if (kind === 'sidewinder') { burst({ duration: 0.09, freq: 1600, gain: 0.42 }); tone({ freq: 220, to: 90, duration: 0.08, type: 'sine', gain: 0.3 }); }
    else if (kind === 'raptor') { burst({ duration: 0.07, freq: 1900, gain: 0.36 }); }
    else { burst({ duration: 0.11, freq: 1300, gain: 0.5 }); tone({ freq: 190, to: 80, duration: 0.1, type: 'sine', gain: 0.32 }); }
  },
  enemyShot() {
    burst({ duration: 0.1, freq: 900, gain: 0.2 });
  },
  hit() { tone({ freq: 1150, duration: 0.06, type: 'sine', gain: 0.3 }); },
  kill() { tone({ freq: 660, duration: 0.09, type: 'sine', gain: 0.3 }); tone({ freq: 990, duration: 0.14, type: 'sine', gain: 0.3, when: 0.09 }); },
  hurt() { tone({ freq: 140, to: 70, duration: 0.18, type: 'sawtooth', gain: 0.28 }); },
  reload() { tone({ freq: 900, duration: 0.04, type: 'square', gain: 0.14 }); tone({ freq: 620, duration: 0.05, type: 'square', gain: 0.14, when: 0.22 }); tone({ freq: 1100, duration: 0.04, type: 'square', gain: 0.16, when: 0.55 }); },
  dry() { tone({ freq: 1400, duration: 0.03, type: 'square', gain: 0.12 }); },
  buy() { tone({ freq: 520, duration: 0.07, type: 'sine', gain: 0.25 }); tone({ freq: 780, duration: 0.1, type: 'sine', gain: 0.25, when: 0.07 }); },
  denied() { tone({ freq: 220, duration: 0.12, type: 'square', gain: 0.18 }); },
  plantBeep() { tone({ freq: 880, duration: 0.09, type: 'sine', gain: 0.25 }); },
  defuseBeep() { tone({ freq: 1180, duration: 0.09, type: 'sine', gain: 0.25 }); },
  explosion() {
    burst({ duration: 0.9, freq: 420, gain: 0.9 });
    tone({ freq: 90, to: 28, duration: 0.8, type: 'sine', gain: 0.7 });
  },
  roundWin() { [523, 659, 784].forEach((f, i) => tone({ freq: f, duration: 0.16, type: 'sine', gain: 0.28, when: i * 0.13 })); },
  roundLose() { [392, 330, 262].forEach((f, i) => tone({ freq: f, duration: 0.18, type: 'sine', gain: 0.25, when: i * 0.14 })); },
  flash() { tone({ freq: 2400, to: 300, duration: 0.5, type: 'sine', gain: 0.22 }); },
};
