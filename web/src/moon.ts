// The real moon, computed exactly like the contract (contract/src/moon.rs):
// a known new moon (2000-01-06 18:14 UTC), the mean synodic month, and
// Bhaskara's sine approximation for how much of it is lit.

export const NEW_MOON_REF_MS = 947_182_440_000;
export const SYNODIC_MS = 2_551_442_876.8992;

// The contract's moon levers (Config defaults; the live view reports the real values).
export const MOON_HUNGER = 0.5; // up to 1.5x hunger at full moon
export const MOON_BURN = 0.2; // up to +20 points of burn share at full moon
export const MOONLIT_MIN = 0.9; // Moonlit badge when at least 90% lit

/** 0 = new moon … 1 = full moon (fraction lit). */
export function moonLit(nowMs: number): number {
  const age = (((nowMs - NEW_MOON_REF_MS) % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS;
  const u = age / SYNODIC_MS;
  const a = u * (1 - u);
  const sin = (16 * a) / (5 - 4 * a);
  return Math.min(1, sin * sin);
}

/** True while the moon is growing (new → full). */
export function moonWaxing(nowMs: number): boolean {
  const age = (((nowMs - NEW_MOON_REF_MS) % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS;
  return age < SYNODIC_MS / 2;
}

export function moonPhaseName(nowMs: number): string {
  const age = (((nowMs - NEW_MOON_REF_MS) % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS;
  const s = Math.floor((age * 16) / SYNODIC_MS);
  return ["new moon", "waxing crescent", "waxing crescent", "first quarter", "first quarter", "waxing gibbous", "waxing gibbous", "full moon", "full moon", "waning gibbous", "waning gibbous", "last quarter", "last quarter", "waning crescent", "waning crescent", "new moon"][s];
}

export function moonEmoji(lit: number, waxing: boolean): string {
  if (lit < 0.06) return "🌑";
  if (lit > 0.94) return "🌕";
  if (lit < 0.35) return waxing ? "🌒" : "🌘";
  if (lit < 0.65) return waxing ? "🌓" : "🌗";
  return waxing ? "🌔" : "🌖";
}

/** Next full moon after `nowMs` (for "rally night" countdowns). */
export function nextFullMoon(nowMs: number): number {
  const age = (((nowMs - NEW_MOON_REF_MS) % SYNODIC_MS) + SYNODIC_MS) % SYNODIC_MS;
  const toFull = SYNODIC_MS / 2 - age;
  return nowMs + (toFull > 0 ? toFull : toFull + SYNODIC_MS);
}

export const hungerFor = (lit: number) => 1 + MOON_HUNGER * lit;
export const burnShareFor = (lit: number) => Math.min(1, 0.5 + MOON_BURN * lit);
