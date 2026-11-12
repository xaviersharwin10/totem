// The farm's background sound: birdsong, made live in the browser (Web Audio,
// no audio files, no licences). A few kinds of birds call now and then from the
// left or the right, near and far, with a light garden echo.
//
// The garden follows BaoBao's mood: lively while it's happy, quieter as it gets
// hungry, fewer still when it's starving, in a Rampage or dead.
//
// Starts on the first tap (browsers block autoplay), follows the 🔊 button, and
// goes quiet while the tab is hidden.
import { audioCtx } from "./sfx";

export type MusicMood = "happy" | "content" | "hungry" | "starving" | "rampage" | "dead";

/** Chance per tick (every TICK seconds) that a bird starts a call. */
const CALLS: Record<MusicMood, number> = { happy: 0.16, content: 0.13, hungry: 0.09, starving: 0.06, rampage: 0.04, dead: 0.06 };
const TICK = 0.3;
const VOLUME = 1;

// a few species: a short phrase of quick sine chirps with fast pitch glides
const BIRDS: { notes: number; base: [number, number]; glide: number; len: [number, number]; gap: number }[] = [
  { notes: 3, base: [3200, 4200], glide: 0.75, len: [0.05, 0.09], gap: 0.06 }, // quick tweets, falling
  { notes: 2, base: [2400, 3000], glide: 1.35, len: [0.12, 0.18], gap: 0.1 }, // two rising whistles
  { notes: 5, base: [4200, 5200], glide: 0.9, len: [0.03, 0.05], gap: 0.035 }, // a fast trill
  { notes: 4, base: [2800, 3400], glide: 1.15, len: [0.06, 0.1], gap: 0.08 }, // a sing-song warble
];

let started = false;
let muted = false;
let mood: MusicMood = "content";
let master: GainNode | null = null;
let echo: GainNode | null = null;
let meter: AnalyserNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function graph(a: AudioContext) {
  if (master) return;
  master = a.createGain();
  master.gain.value = 0;
  const comp = a.createDynamicsCompressor();
  comp.threshold.value = -18;
  master.connect(comp);
  comp.connect(a.destination);
  meter = a.createAnalyser();
  meter.fftSize = 2048;
  comp.connect(meter);
  // a soft garden echo: delay with filtered feedback
  echo = a.createGain();
  const delay = a.createDelay(1);
  delay.delayTime.value = 0.23;
  const fb = a.createGain();
  fb.gain.value = 0.28;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 3500;
  echo.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(master);
}

function fadeTo(v: number, secs = 1.2) {
  const a = audioCtx();
  if (!master) return;
  const t = a.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(v, t + secs);
}

function bird(a: AudioContext, t: number) {
  const b = BIRDS[Math.floor(Math.random() * BIRDS.length)];
  const pan = a.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  const out = a.createGain();
  out.gain.value = 0.06 + Math.random() * 0.05; // near and far birds
  pan.connect(out);
  out.connect(master!);
  const wet = a.createGain();
  wet.gain.value = 0.3;
  out.connect(wet);
  wet.connect(echo!);
  let at = t;
  const base = b.base[0] + Math.random() * (b.base[1] - b.base[0]);
  const n = b.notes + (Math.random() < 0.5 ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const len = b.len[0] + Math.random() * (b.len[1] - b.len[0]);
    const f0 = base * (1 + (Math.random() - 0.5) * 0.12);
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * b.glide, at + len);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(1, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g);
    g.connect(pan);
    o.start(at);
    o.stop(at + len + 0.02);
    at += len + b.gap * (0.7 + Math.random() * 0.6);
  }
}

function tick() {
  const a = audioCtx();
  if (Math.random() < CALLS[mood]) bird(a, a.currentTime + 0.05 + Math.random() * TICK);
}

function run() {
  if (timer || muted || document.hidden) return;
  timer = setInterval(tick, TICK * 1000);
  fadeTo(VOLUME);
}
function halt() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  fadeTo(0, 0.4);
}

export const music = {
  /** Call from a user gesture (first tap): browsers block audio before one. */
  start() {
    if (started) return;
    started = true;
    graph(audioCtx());
    document.addEventListener("visibilitychange", () => (document.hidden ? halt() : run()));
    run();
  },
  setMood(m: MusicMood) {
    mood = m;
  },
  /** Loudness right now, in dBFS (for tests and tuning). */
  levelDb(): number {
    if (!meter) return -Infinity;
    const d = new Float32Array(meter.fftSize);
    meter.getFloatTimeDomainData(d);
    let sum = 0;
    for (const x of d) sum += x * x;
    return 10 * Math.log10(sum / d.length || 1e-12);
  },
  setMuted(m: boolean) {
    muted = m;
    if (!started) return;
    if (m) halt();
    else run();
  },
};
