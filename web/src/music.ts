// Background music, composed live in the browser (Web Audio, no audio files, no
// licences). A gentle pentatonic loop whose mood follows BaoBao's:
//
//   happy / content  bright major pentatonic, easy tempo, soft shaker
//   hungry           same key, slower and sparser
//   starving         minor, low and slow
//   rampage          minor, faster, taiko drums and a low drone
//   dead             a slow, soft pad only
//   moonlit          (moon at least 90% lit) a high shimmer on top
//
// Starts on the first tap (browsers block autoplay), follows the 🔊 button,
// and goes quiet while the tab is hidden.
import { audioCtx } from "./sfx";

export type MusicMood = "happy" | "content" | "hungry" | "starving" | "rampage" | "dead";

interface Style {
  bpm: number;
  root: number; // MIDI note of the key
  scale: number[]; // semitones above the root
  chords: number[][]; // per bar, scale-degree indexes
  density: number; // chance an eighth note plays
  shaker: boolean;
  drums: boolean;
  drone: boolean;
  melody: boolean;
  pad: number; // pad loudness
}

const MAJOR = [0, 2, 4, 7, 9];
const MINOR = [0, 3, 5, 7, 10];
const STYLES: Record<MusicMood, Style> = {
  happy: { bpm: 84, root: 60, scale: MAJOR, chords: [[0, 2, 4], [4, 1, 3], [3, 0, 2], [1, 3, 4]], density: 0.55, shaker: true, drums: false, drone: false, melody: true, pad: 1 },
  content: { bpm: 80, root: 60, scale: MAJOR, chords: [[0, 2, 4], [3, 0, 2], [4, 1, 3], [0, 2, 4]], density: 0.45, shaker: true, drums: false, drone: false, melody: true, pad: 1 },
  hungry: { bpm: 72, root: 60, scale: MAJOR, chords: [[0, 2, 4], [1, 3, 4], [3, 0, 2], [1, 3, 4]], density: 0.3, shaker: false, drums: false, drone: false, melody: true, pad: 0.9 },
  starving: { bpm: 66, root: 57, scale: MINOR, chords: [[0, 2, 4], [3, 0, 2], [1, 3, 4], [4, 1, 3]], density: 0.28, shaker: false, drums: false, drone: true, melody: true, pad: 0.8 },
  rampage: { bpm: 104, root: 57, scale: MINOR, chords: [[0, 2, 4], [0, 2, 4], [3, 0, 2], [4, 1, 3]], density: 0.4, shaker: false, drums: true, drone: true, melody: true, pad: 0.6 },
  dead: { bpm: 52, root: 57, scale: MINOR, chords: [[0, 2, 4], [3, 0, 2]], density: 0, shaker: false, drums: false, drone: false, melody: false, pad: 0.7 },
};

const VOLUME = 1.2;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

let started = false;
let muted = false;
let mood: MusicMood = "content";
let moonlit = false;
let master: GainNode | null = null;
let echo: { input: GainNode } | null = null;
let meter: AnalyserNode | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let nextTime = 0; // when the next eighth note plays (AudioContext time)
let step = 0; // eighth notes since start
let lastNote = 2; // melody position in the scale (index into a two-octave range)

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
  // a soft echo for the melody: delay with filtered feedback
  const input = a.createGain();
  const delay = a.createDelay(1);
  delay.delayTime.value = 0.36;
  const fb = a.createGain();
  fb.gain.value = 0.32;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  input.connect(delay);
  delay.connect(lp);
  lp.connect(fb);
  fb.connect(delay);
  lp.connect(master);
  echo = { input };
}

function fadeTo(v: number, secs = 1.2) {
  const a = audioCtx();
  if (!master) return;
  const t = a.currentTime;
  master.gain.cancelScheduledValues(t);
  master.gain.setValueAtTime(master.gain.value, t);
  master.gain.linearRampToValueAtTime(v, t + secs);
}

function voice(a: AudioContext, freq: number, t: number, dur: number, type: OscillatorType, gain: number, opts: { attack?: number; cutoff?: number; detune?: number; toEcho?: number } = {}) {
  const osc = a.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  if (opts.detune) osc.detune.value = opts.detune;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = opts.cutoff ?? 2400;
  const g = a.createGain();
  const att = opts.attack ?? 0.01;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(f);
  f.connect(g);
  g.connect(master!);
  if (opts.toEcho && echo) {
    const s = a.createGain();
    s.gain.value = opts.toEcho;
    g.connect(s);
    s.connect(echo.input);
  }
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function hit(a: AudioContext, t: number, kind: "shaker" | "taiko") {
  if (kind === "taiko") {
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.25);
    g.gain.setValueAtTime(0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g);
    g.connect(master!);
    o.start(t);
    o.stop(t + 0.4);
    return;
  }
  const len = 0.06;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = 6000;
  const g = a.createGain();
  g.gain.value = 0.09;
  src.connect(f);
  f.connect(g);
  g.connect(master!);
  src.start(t);
}

/** Schedule one eighth note at time t. */
function play(a: AudioContext, t: number) {
  const s = STYLES[mood];
  const eighth = 60 / s.bpm / 2;
  const inBar = step % 8;
  const bar = Math.floor(step / 8);
  const chord = s.chords[bar % s.chords.length];
  const note = (deg: number, octave = 0) => s.root + s.scale[((deg % 5) + 5) % 5] + 12 * (octave + Math.floor(deg / 5));

  // pad: a soft chord held for the whole bar
  if (inBar === 0 && s.pad > 0) {
    const barLen = eighth * 8;
    for (const deg of chord) voice(a, hz(note(deg, -1)), t, barLen * 1.1, "triangle", 0.12 * s.pad, { attack: 0.5, cutoff: 900, detune: (Math.random() - 0.5) * 8 });
  }
  // bass on beats 1 and 3
  if ((inBar === 0 || inBar === 4) && mood !== "dead") voice(a, hz(note(chord[0], -1)), t, eighth * 3, "triangle", 0.2, { attack: 0.02, cutoff: 700 });
  // drone under starving and rampage
  if (s.drone && inBar === 0) voice(a, hz(s.root - 24), t, eighth * 8.5, "sawtooth", 0.03, { attack: 0.8, cutoff: 260 });
  // melody: a gentle random walk on the scale, resting often
  if (s.melody && Math.random() < s.density) {
    const moveBy = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    lastNote = Math.max(0, Math.min(9, lastNote + moveBy));
    if (inBar === 0) lastNote = chord[0] + (lastNote >= 5 ? 5 : 0); // land on the chord at the bar line
    const long = Math.random() < 0.3;
    voice(a, hz(note(lastNote, 0)), t, eighth * (long ? 2.8 : 1.4), "triangle", 0.2, { cutoff: 3200, toEcho: 0.5 });
  }
  // percussion
  if (s.shaker && inBar % 2 === 1) hit(a, t, "shaker");
  if (s.drums && (inBar === 0 || inBar === 3 || inBar === 4 || inBar === 6)) hit(a, t, "taiko");
  // moonlit shimmer: high bell notes now and then
  if (moonlit && mood !== "dead" && inBar % 4 === 2 && Math.random() < 0.6) {
    voice(a, hz(note(Math.floor(Math.random() * 5), 2)), t, eighth * 4, "sine", 0.07, { attack: 0.02, toEcho: 0.8 });
  }
  step++;
}

function tick() {
  const a = audioCtx();
  const eighth = 60 / STYLES[mood].bpm / 2;
  if (nextTime < a.currentTime) nextTime = a.currentTime + 0.05;
  while (nextTime < a.currentTime + 0.2) {
    play(a, nextTime);
    nextTime += eighth;
  }
}

function run() {
  if (timer || muted || document.hidden) return;
  nextTime = 0;
  timer = setInterval(tick, 50);
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
    document.addEventListener("visibilitychange", () => (document.hidden ? halt() : started && run()));
    run();
  },
  setMood(m: MusicMood, isMoonlit = false) {
    moonlit = isMoonlit;
    if (m === mood) return;
    mood = m;
    // land the new mood on a bar line
    step = Math.ceil(step / 8) * 8;
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
