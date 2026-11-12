// One game interface, two backends:
//   live     – the deployed contract on testnet (polled views, signed calls)
//   practice – the in-browser rule mirror (engine.ts), also the offline fallback
// The 3D farm and HUD only talk to this hook.

import { useCallback, useEffect, useRef, useState } from "react";
import { DAY_MS, GameEvent, TotemEngine, TotemView, fmt } from "./engine";
import { useNear } from "./chain/near";
import { CONTRACT_ID, EXPLORER, toTokens, toYocto } from "./chain/config";

export type Mode = "live" | "practice";

export interface FeedResult {
  accepted: number;
  burn: number;
  rescue: boolean;
}

export interface Game {
  mode: Mode;
  setMode: (m: Mode) => void;
  liveStatus: "loading" | "ok" | "offline";
  view: TotemView | null;
  palette: number; // index into the panda looks (from on-chain traits when live)
  graves: { name: string; maxLevel: number; generation?: number }[];
  leaderboard: { who: string; points: number; unit: string }[];
  events: GameEvent[];
  accountId: string;
  isGuest: boolean; // playing free: no wallet, the game pays the gas
  balance: number | null; // $TOTEM, live only
  busy: boolean;
  connect: () => Promise<void>;
  playAsGuest: () => Promise<void>;
  /** One tap: (make a free guest if needed,) top up from the faucet if short, feed to full. */
  rescue: () => Promise<FeedResult>;
  disconnect: () => Promise<void>;
  faucet: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  feed: (amount: number | "fill") => Promise<FeedResult>;
  poke: () => Promise<void>;
  hatch: (() => void) | null; // practice only; live hatching is a DAO vote
  explorer: string;
}

// ---- shapes returned by the contract views ----
interface ChainTotem {
  lineage_name: string;
  generation: number;
  alive: boolean;
  fullness_bp: number;
  mood: TotemView["mood"];
  level: number;
  max_level: number;
  bites_until_death: number;
  form: TotemView["form"];
  xp_happy_days: number;
  next_level_happy_days: number | null;
  hoard: string;
  released_stakes?: string;
  treasury?: string;
  meal_size: string;
  fill_amount: string;
  traits: { palette: number };
  seconds_until_starving: string | null;
  seconds_until_rampage: string | null;
  seconds_until_next_bite: string | null;
  seconds_until_death: string | null;
}
interface ChainStats {
  total_burned: string;
  total_fed: string;
}
interface ChainLife {
  generation: number;
  lineage_name: string;
  alive: boolean;
  max_level: number;
  top_feeders: [string, string][];
}

const num = (s: string | null) => (s === null ? null : Number(s));

function toView(t: ChainTotem, s: ChainStats): TotemView {
  return {
    name: t.lineage_name,
    generation: t.generation,
    alive: t.alive,
    fullnessBp: t.fullness_bp,
    mood: t.mood,
    level: t.level,
    maxLevel: t.max_level,
    form: t.form,
    xpHappyDays: t.xp_happy_days,
    nextLevelHappyDays: t.next_level_happy_days,
    hoard: toTokens(t.hoard),
    releasedStakes: toTokens(t.released_stakes ?? "0"),
    treasury: t.treasury,
    totalBurned: toTokens(s.total_burned),
    totalFed: toTokens(s.total_fed),
    mealSize: toTokens(t.meal_size),
    fillAmount: toTokens(t.fill_amount),
    secondsUntilStarving: num(t.seconds_until_starving),
    secondsUntilRampage: num(t.seconds_until_rampage),
    secondsUntilDeath: num(t.seconds_until_death),
    secondsUntilNextBite: num(t.seconds_until_next_bite),
    bitesUntilDeath: t.bites_until_death,
  };
}

export function useGame(): Game {
  const near = useNear();
  const [mode, setMode] = useState<Mode>("live");
  const [, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  // ---------------- practice backend ----------------
  const engineRef = useRef<TotemEngine>();
  if (!engineRef.current) engineRef.current = new TotemEngine();
  const engine = engineRef.current;
  const [practiceGraves, setPracticeGraves] = useState<{ name: string; maxLevel: number }[]>([]);
  const lastAlive = useRef(true);

  useEffect(() => {
    if (mode !== "practice") return;
    const t = setInterval(() => {
      engine.settle(Date.now());
      const v = engine.project(Date.now());
      if (lastAlive.current && !v.alive) setPracticeGraves((g) => [...g, { name: v.name, maxLevel: v.maxLevel }]);
      lastAlive.current = v.alive;
      bump();
    }, 200);
    return () => clearInterval(t);
  }, [mode, engine]);

  // ---------------- live backend ----------------
  const [liveStatus, setLiveStatus] = useState<Game["liveStatus"]>("loading");
  const [live, setLive] = useState<{ t: ChainTotem; s: ChainStats; lineage: ChainLife[]; at: number } | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const liveEvents = useRef<GameEvent[]>([]);
  const evId = useRef(1);
  const pushLive = (kind: GameEvent["kind"], text: string) => {
    liveEvents.current = [{ id: evId.current++, kind, text, ts: Date.now() }, ...liveEvents.current].slice(0, 60);
  };
  const prevLive = useRef<ChainTotem | null>(null);
  const failures = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [t, s, lineage] = await Promise.all([
        near.view<ChainTotem>("get_totem"),
        near.view<ChainStats>("get_stats"),
        near.view<ChainLife[]>("get_lineage", { limit: 100 }),
      ]);
      const p = prevLive.current;
      if (p) {
        if (t.generation > p.generation) pushLive("hatch", `🥚 ${t.lineage_name} hatched (DAO vote)`);
        else {
          if (t.level > p.level && t.alive) pushLive("level_up", `⬆️ ${t.lineage_name} reached Level ${t.level}`);
          if (t.level < p.level && t.alive) pushLive("level_down", `💔 BITE! ${t.lineage_name} dropped to Level ${t.level}`);
          if (t.mood === "rampage" && p.mood !== "rampage") pushLive("rampage_start", `🔥 RAMPAGE: ${t.lineage_name} is starving`);
          if (p.mood === "rampage" && t.mood !== "rampage" && t.alive) pushLive("rampage_end", `🦸 Someone rescued ${t.lineage_name}!`);
          if (p.alive && !t.alive) pushLive("death", `💀 ${t.lineage_name} starved at Level 0. A gravestone NFT joins the lineage.`);
        }
      }
      prevLive.current = t;
      setLive({ t, s, lineage, at: Date.now() });
      failures.current = 0;
      setLiveStatus("ok");
    } catch {
      failures.current += 1;
      if (failures.current >= 3) setLiveStatus("offline");
    }
  }, [near]);

  const refreshBalance = useCallback(async () => {
    if (!near.accountId) return setBalance(null);
    try {
      const b = await near.view<string>("ft_balance_of", { account_id: near.accountId });
      setBalance(toTokens(b));
    } catch {
      setBalance(null);
    }
  }, [near]);

  useEffect(() => {
    if (mode !== "live") return;
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [mode, refresh]);

  useEffect(() => {
    if (mode !== "live") return;
    refreshBalance();
    const t = setInterval(refreshBalance, 10000);
    return () => clearInterval(t);
  }, [mode, refreshBalance, near.accountId]);

  // offline -> fall back to practice automatically
  useEffect(() => {
    if (mode === "live" && liveStatus === "offline") setMode("practice");
  }, [mode, liveStatus]);

  // smooth countdowns between polls
  useEffect(() => {
    if (mode !== "live") return;
    const t = setInterval(bump, 250);
    return () => clearInterval(t);
  }, [mode]);

  // ---------------- unified view ----------------
  let view: TotemView | null;
  let palette: number;
  let graves: Game["graves"];
  let leaderboard: Game["leaderboard"];
  let events: GameEvent[];

  if (mode === "practice") {
    view = engine.project(Date.now());
    palette = view.generation - 1;
    graves = practiceGraves;
    leaderboard = engine.leaderboard().map((r) => ({ ...r, unit: "pts" }));
    events = engine.events;
  } else if (live) {
    const base = toView(live.t, live.s);
    // tick the countdowns and the belly between polls
    const dt = (Date.now() - live.at) / 1000;
    const dec = (x: number | null) => (x === null ? null : Math.max(0, x - dt));
    const drain = base.alive && base.fullnessBp > 0 ? Math.round((dt * 1000 * 10_000) / DAY_MS) : 0;
    view = {
      ...base,
      fullnessBp: Math.max(0, base.fullnessBp - drain),
      secondsUntilStarving: dec(base.secondsUntilStarving),
      secondsUntilRampage: dec(base.secondsUntilRampage),
      secondsUntilNextBite: dec(base.secondsUntilNextBite),
      secondsUntilDeath: dec(base.secondsUntilDeath),
    };
    palette = live.t.traits.palette;
    graves = live.lineage
      .filter((l) => !l.alive)
      .map((l) => ({ name: l.lineage_name, maxLevel: l.max_level, generation: l.generation }));
    const cur = live.lineage.find((l) => l.generation === live.t.generation);
    leaderboard = (cur?.top_feeders ?? []).map(([who, amt]) => ({ who, points: toTokens(amt), unit: "fed" }));
    events = liveEvents.current;
  } else {
    view = null;
    palette = 0;
    graves = [];
    leaderboard = [];
    events = [];
  }

  // ---------------- actions ----------------
  const feed = async (amount: number | "fill"): Promise<FeedResult> => {
    if (mode === "practice") {
      const want = amount === "fill" ? engine.project(Date.now()).fillAmount : amount;
      const r = engine.feed(want, Date.now());
      bump();
      return { accepted: r.accepted, burn: r.burn, rescue: r.rescue };
    }
    if (!live || !view) throw new Error("Still loading the Totem…");
    if (!near.accountId) {
      await near.signIn();
      throw new Error("Wallet connected. Grab some test $TOTEM, then feed again.");
    }
    const fill = toTokens(live.t.fill_amount);
    const want = amount === "fill" ? fill : amount;
    const accepted = Math.min(want, fill);
    if (accepted <= 0) throw new Error("I'm full! 😋");
    if (balance !== null && balance < accepted) throw new Error("Not enough $TOTEM: tap “Get test $TOTEM” first");
    const rescue = live.t.fullness_bp < 3000;
    setBusy(true);
    try {
      await near.call("feed", { amount: amount === "fill" ? live.t.fill_amount : toYocto(want) });
      pushLive(rescue ? "rescue" : "feed", `${rescue ? "⚔️" : "🎋"} you fed ${fmt(accepted)}: ${fmt(accepted / 2)} burned forever`);
    } finally {
      setBusy(false);
      refresh();
      refreshBalance();
    }
    return { accepted, burn: accepted / 2, rescue };
  };

  const poke = async () => {
    if (mode === "practice") {
      engine.poke(Date.now());
      bump();
      return;
    }
    if (!near.accountId) return near.signIn();
    setBusy(true);
    try {
      await near.call("poke");
    } finally {
      setBusy(false);
      refresh();
      refreshBalance();
    }
  };

  const faucet = async () => {
    if (!near.accountId) await near.signIn();
    setBusy(true);
    try {
      await near.call("faucet");
      pushLive("feed", "🚰 +1,000 test $TOTEM from the faucet");
    } finally {
      setBusy(false);
      refreshBalance();
    }
  };

  const rescue = async (): Promise<FeedResult> => {
    if (mode === "practice") return feed("fill");
    if (!live) throw new Error("Still loading the Totem…");
    if (!live.t.alive) throw new Error("Too late: it already starved. Only the tribe's DAO can hatch the next egg.");
    let who = near.accountId;
    if (!who) who = await near.playAsGuest(); // note: `near` here is this render's snapshot; calls read the guest from a ref
    const fillYocto = BigInt(live.t.fill_amount);
    if (fillYocto <= 0n) throw new Error("I'm full! 😋 Someone already rescued me.");
    setBusy(true);
    try {
      const bal = BigInt(await near.view<string>("ft_balance_of", { account_id: who }));
      const calls: { method: string; args?: Record<string, unknown> }[] = [];
      let have = bal;
      if (bal < fillYocto) {
        calls.push({ method: "faucet" });
        have += BigInt(Math.round(1000 * 1e6)) * 10n ** 12n;
      }
      const amt = fillYocto < have ? fillYocto : have;
      if (amt <= 0n) throw new Error("No $TOTEM to feed with.");
      calls.push({ method: "feed", args: { amount: amt.toString() } });
      const rescueNow = live.t.fullness_bp < 3000;
      await near.callMany(calls);
      const accepted = toTokens(amt);
      pushLive("rescue", `${rescueNow ? "🦸" : "🎋"} you fed ${fmt(accepted)}: ${fmt(accepted / 2)} burned forever`);
      return { accepted, burn: accepted / 2, rescue: rescueNow };
    } finally {
      setBusy(false);
      refresh();
      refreshBalance();
    }
  };

  const hatch =
    mode === "practice"
      ? () => {
          engine.hatch(Date.now());
          lastAlive.current = true;
          bump();
        }
      : null;

  return {
    mode,
    setMode,
    liveStatus,
    view,
    palette,
    graves,
    leaderboard,
    events,
    accountId: near.accountId,
    isGuest: near.isGuest,
    balance,
    busy,
    connect: near.signIn,
    playAsGuest: async () => {
      await near.playAsGuest();
    },
    rescue,
    disconnect: near.signOut,
    faucet,
    refreshBalance,
    feed,
    poke,
    hatch,
    explorer: `${EXPLORER}/address/${CONTRACT_ID}`,
  };
}
