// Procedural sound effects via the Web Audio API — no asset files, all synthesized.
// Game feel 101: every meaningful action makes a sound.

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext {
  if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}
/** The one AudioContext the game uses (sound effects and music share it). */
export const audioCtx = ac;

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

type Wave = OscillatorType;

function tone(freq: number, dur: number, type: Wave, gain = 0.2, delay = 0, slideTo?: number) {
  if (muted) return;
  const a = ac();
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur: number, gain = 0.15, delay = 0) {
  if (muted) return;
  const a = ac();
  const t0 = a.currentTime + delay;
  const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 1800;
  src.connect(f);
  f.connect(g);
  g.connect(a.destination);
  src.start(t0);
}

export const sfx = {
  feed(combo = 1) {
    const base = 420 + Math.min(combo, 12) * 40;
    tone(base, 0.09, "square", 0.18, 0, base * 1.6);
    noise(0.06, 0.08);
  },
  chomp() {
    tone(160, 0.08, "sawtooth", 0.16, 0, 90);
  },
  coin() {
    tone(880, 0.06, "square", 0.1);
    tone(1320, 0.08, "square", 0.08, 0.05);
  },
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, "square", 0.16, i * 0.08));
  },
  rescue() {
    [392, 523, 784].forEach((f, i) => tone(f, 0.14, "triangle", 0.2, i * 0.06));
  },
  rampage() {
    tone(180, 0.5, "sawtooth", 0.18, 0, 70);
    noise(0.4, 0.12);
  },
  death() {
    tone(330, 0.7, "sawtooth", 0.2, 0, 50);
    tone(220, 0.9, "triangle", 0.15, 0.1, 40);
  },
  hatch() {
    [660, 880, 1100].forEach((f, i) => tone(f, 0.1, "sine", 0.15, i * 0.07));
  },
  click() {
    tone(300, 0.04, "square", 0.08);
  },
};
