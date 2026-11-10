// The TOTEM game engine — a faithful browser mirror of the on-chain mechanics
// (contract/src/game.rs). It lets the creature live, get fed, rampage and die
// entirely client-side, so the UI is playable with no deployed contract. When we
// wire the real contract, `project()` is replaced by `get_totem()` and `feed()`
// by a signed call — the view shape is intentionally the same.

export type Form = "egg" | "dragon" | "golem";
export type Mood = "happy" | "hungry" | "starving" | "rampage" | "dead";

export interface TotemView {
  name: string;
  generation: number;
  alive: boolean;
  fullnessBp: number; // 0..10000
  mood: Mood;
  level: number;
  maxLevel: number;
  form: Form;
  xpHappyDays: number;
  nextLevelHappyDays: number | null;
  hoard: number;
  totalBurned: number;
  totalFed: number;
  mealSize: number;
  fillAmount: number;
  secondsUntilStarving: number | null;
  secondsUntilRampage: number | null;
  secondsUntilDeath: number | null;
}

export interface GameEvent {
  id: number;
  kind:
    | "feed"
    | "rescue"
    | "bite"
    | "rampage_start"
    | "rampage_end"
    | "level_up"
    | "evolve"
    | "death"
    | "hatch"
    | "blessing"
    | "badge";
  text: string;
  ts: number;
}

// --- parameters (demo clock: one Totem-day = 120 s, matching demo_mode) --------
export const DAY_MS = 120_000;
const FULL = 10_000;
const BASE_MEAL = 100;
const APPETITE = 1.5;
const BURN_SHARE = 0.5;
const HAPPY_BP = 7_000;
const STARVING_BP = 3_000;
const RESCUE_MULT = 2;
const LEVEL_THRESHOLDS = [1, 3, 6, 10]; // cumulative Happy-days
const LEVEL_STEP = 5;
const BITE_INTERVAL_MS = DAY_MS / 24;
const BITE_SIZE = 0.1;
const DEATH_AFTER_MS = 3 * DAY_MS;
const POKE_TIP = 0.01;

function formAppetite(form: Form): number {
  return form === "dragon" ? 1.5 : form === "golem" ? 0.8 : 1.0;
}

export function moodFor(fullnessBp: number, alive: boolean, inRampage: boolean): Mood {
  if (!alive) return "dead";
  if (inRampage || fullnessBp === 0) return "rampage";
  if (fullnessBp >= HAPPY_BP) return "happy";
  if (fullnessBp >= STARVING_BP) return "hungry";
  return "starving";
}

export class TotemEngine {
  name = "Grumbo";
  generation = 1;
  you: string;

  private lastSettledAt: number;
  private fullnessBp = FULL;
  private happyMs = 0;
  private level = 1;
  private maxLevel = 1;
  private form: Form = "egg";
  private l4ReachedAt: number | null = null;
  private rampageStartedAt: number | null = null;
  private bitesApplied = 0;
  private alive = true;

  hoard = 0;
  totalBurned = 0;
  totalFed = 0;

  points = new Map<string, number>();
  events: GameEvent[] = [];
  private nextEventId = 1;

  constructor(you = "you.testnet", now = Date.now()) {
    this.you = you;
    this.lastSettledAt = now;
    this.pushEvent("hatch", `${this.name} hatched at Level 1`, now);
  }

  private pushEvent(kind: GameEvent["kind"], text: string, ts: number) {
    this.events.unshift({ id: this.nextEventId++, kind, text, ts });
    if (this.events.length > 60) this.events.pop();
  }

  mealSize(level = this.level, form = this.form): number {
    return BASE_MEAL * Math.pow(APPETITE, level - 1) * formAppetite(form);
  }

  private levelFor(happyDays: number): number {
    let level = 1;
    for (const thr of LEVEL_THRESHOLDS) {
      if (happyDays >= thr) level += 1;
      else return level;
    }
    let base = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    while (happyDays >= base + LEVEL_STEP) {
      base += LEVEL_STEP;
      level += 1;
    }
    return level;
  }

  private nextThreshold(level: number): number | null {
    const idx = level - 1;
    if (idx < LEVEL_THRESHOLDS.length) return LEVEL_THRESHOLDS[idx];
    const base = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
    const past = level - LEVEL_THRESHOLDS.length;
    return base + LEVEL_STEP * (past + 1);
  }

  /** Advance time-based state to `now`. Mirrors the contract's settle(). */
  settle(now: number, poker?: string) {
    if (now <= this.lastSettledAt || !this.alive) {
      this.lastSettledAt = Math.max(this.lastSettledAt, now);
      return;
    }
    const elapsed = now - this.lastSettledAt;
    const f0 = this.fullnessBp;

    // XP: time spent Happy during the drain.
    if (f0 > HAPPY_BP) {
      const dur = ((f0 - HAPPY_BP) / FULL) * DAY_MS;
      this.happyMs += Math.min(dur, elapsed);
    }

    const toZero = (f0 / FULL) * DAY_MS;
    if (elapsed < toZero) {
      this.fullnessBp = Math.max(0, Math.round(f0 - (elapsed / DAY_MS) * FULL));
    } else {
      const z = this.lastSettledAt + toZero;
      this.fullnessBp = 0;
      if (this.rampageStartedAt === null) {
        this.rampageStartedAt = z;
        this.bitesApplied = 0;
        this.pushEvent("rampage_start", `🔥 RAMPAGE — ${this.name} is eating the Hoard`, z);
      }
      const rampageDur = now - this.rampageStartedAt;
      const death = rampageDur >= DEATH_AFTER_MS;
      const effective = death ? DEATH_AFTER_MS : rampageDur;
      const totalBites = Math.floor(effective / BITE_INTERVAL_MS);
      const newBites = Math.max(0, totalBites - this.bitesApplied);
      if (newBites > 0) this.applyBites(newBites, now, poker);
      this.bitesApplied = totalBites;
      if (death) this.die(now);
    }

    if (this.alive) {
      const happyDays = Math.floor(this.happyMs / DAY_MS);
      const newLevel = this.levelFor(happyDays);
      if (newLevel > this.level) {
        this.level = newLevel;
        this.maxLevel = Math.max(this.maxLevel, newLevel);
        if (this.level >= 4 && this.form === "egg" && this.l4ReachedAt === null)
          this.l4ReachedAt = now;
        this.pushEvent("level_up", `⬆️ ${this.name} reached Level ${this.level}`, now);
      }
    }
    this.lastSettledAt = now;
  }

  private applyBites(n: number, now: number, poker?: string) {
    if (n <= 0 || this.hoard <= 0) return;
    const start = this.hoard;
    let hoard = this.hoard;
    for (let i = 0; i < n && hoard > 0; i++) hoard *= 1 - BITE_SIZE;
    const bitten = start - hoard;
    let tip = 0;
    if (poker) {
      tip = bitten * POKE_TIP;
      this.points.set(poker, this.points.get(poker) ?? 0); // ensure present
    }
    this.hoard = hoard;
    this.totalBurned += bitten - tip;
    this.pushEvent(
      "bite",
      `🔥 The Totem ate ${fmt(bitten)} $TOTEM from the Hoard`,
      now
    );
  }

  private die(now: number) {
    if (this.hoard > 0) {
      this.totalBurned += this.hoard;
      this.hoard = 0;
    }
    this.alive = false;
    this.rampageStartedAt = null;
    this.pushEvent(
      "death",
      `💀 ${this.name} has died after reaching Level ${this.maxLevel}. RIP.`,
      now
    );
  }

  /** Feed the creature. Returns the accepted amount and the split. */
  feed(amount: number, now: number, who = this.you) {
    this.settle(now);
    if (!this.alive) throw new Error("the Totem is dead; hatch a new egg");
    const ms = this.mealSize();
    const roomBp = FULL - this.fullnessBp;
    const maxAccept = (ms * roomBp) / FULL;
    const accepted = Math.min(amount, maxAccept);
    if (accepted <= 0) throw new Error("the Totem is full");

    const rescue = this.fullnessBp < STARVING_BP;
    const burn = accepted * BURN_SHARE;
    const toHoard = accepted - burn;
    this.hoard += toHoard;
    this.totalBurned += burn;
    this.totalFed += accepted;
    this.fullnessBp = Math.min(FULL, Math.round(this.fullnessBp + (accepted / ms) * FULL));

    if (this.rampageStartedAt !== null) {
      this.rampageStartedAt = null;
      this.bitesApplied = 0;
      this.pushEvent("rampage_end", `🦸 ${who} saved the Totem! Hero Badge minted.`, now);
    }

    const pts = Math.floor(accepted) * (rescue ? RESCUE_MULT : 1);
    this.points.set(who, (this.points.get(who) ?? 0) + pts);
    this.pushEvent(
      rescue ? "rescue" : "feed",
      `${rescue ? "⚔️" : "🍖"} ${who} fed ${fmt(accepted)} — ${fmt(burn)} burned, ${fmt(
        toHoard
      )} to Hoard (+${pts} pts)`,
      now
    );
    return { accepted, burn, toHoard, rescue, points: pts };
  }

  poke(now: number, who = this.you) {
    this.settle(now, who);
  }

  rename(name: string, now: number) {
    this.name = name;
    this.pushEvent("hatch", `✨ The tribe named the creature "${name}"`, now);
  }

  hatch(now: number) {
    if (this.alive) return;
    this.generation += 1;
    this.name = "Grumbo " + "I".repeat(this.generation);
    this.lastSettledAt = now;
    this.fullnessBp = FULL;
    this.happyMs = 0;
    this.level = 1;
    this.maxLevel = 1;
    this.form = "egg";
    this.l4ReachedAt = null;
    this.rampageStartedAt = null;
    this.bitesApplied = 0;
    this.alive = true;
    this.hoard = 0;
    this.pushEvent("hatch", `🥚 A new egg hatched: ${this.name}`, now);
  }

  /** Current projected view at `now`. */
  project(now: number): TotemView {
    let fullnessBp = this.fullnessBp;
    if (this.alive && now > this.lastSettledAt) {
      const elapsed = now - this.lastSettledAt;
      const toZero = (this.fullnessBp / FULL) * DAY_MS;
      fullnessBp =
        elapsed < toZero
          ? Math.max(0, Math.round(this.fullnessBp - (elapsed / DAY_MS) * FULL))
          : 0;
    }
    const rampageNow = this.alive && (fullnessBp === 0 || this.rampageStartedAt !== null);
    const mood = moodFor(fullnessBp, this.alive, rampageNow);

    const happyDays = Math.floor(this.happyMs / DAY_MS);
    const level = Math.max(this.level, this.levelFor(happyDays));
    const ms = this.mealSize(level, this.form);
    const fill = (ms * (FULL - fullnessBp)) / FULL;

    const untilStarving =
      fullnessBp > STARVING_BP ? ((fullnessBp - STARVING_BP) / FULL) * DAY_MS / 1000 : null;
    const untilRampage = fullnessBp > 0 ? (fullnessBp / FULL) * DAY_MS / 1000 : null;
    let untilDeath: number | null = null;
    if (rampageNow && this.alive) {
      const started = this.rampageStartedAt ?? now;
      untilDeath = Math.max(0, (DEATH_AFTER_MS - (now - started)) / 1000);
    }

    return {
      name: this.name,
      generation: this.generation,
      alive: this.alive,
      fullnessBp,
      mood,
      level,
      maxLevel: Math.max(this.maxLevel, level),
      form: this.form,
      xpHappyDays: happyDays,
      nextLevelHappyDays: this.nextThreshold(level),
      hoard: this.hoard,
      totalBurned: this.totalBurned,
      totalFed: this.totalFed,
      mealSize: ms,
      fillAmount: fill,
      secondsUntilStarving: untilStarving,
      secondsUntilRampage: untilRampage,
      secondsUntilDeath: untilDeath,
    };
  }

  leaderboard(): { who: string; points: number }[] {
    return [...this.points.entries()]
      .map(([who, points]) => ({ who, points }))
      .filter((r) => r.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);
  }
}

export function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  if (n >= 1) return Math.round(n).toLocaleString();
  return n.toFixed(2);
}

export function fmtTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.max(0, Math.floor(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}
