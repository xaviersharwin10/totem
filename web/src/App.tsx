import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { fmt, fmtTime, TotemView, DAY_MS, GameEvent, roman } from "./engine";
import { useGame } from "./game";
import { World } from "./world/World";
import { PandaLook } from "./world/Panda";
import { Tool, addBurst, dropFood, throwBall, world } from "./world/store";
import { sfx, setMuted } from "./sfx";
import { TotemChat, useTotemChat } from "./TotemChat";
import { RescueCard, SosSheet } from "./Sos";
import { shortGuest } from "./chain/guest";
import { GuestKeySheet } from "./GuestKey";
import { useTribe } from "./chain/dao";
import { HatchVote, TribePanel } from "./Tribe";
import { HistoryPanel } from "./History";
import { BellyLine, StakeSheet, useBelly } from "./Stake";
import { PredictPanel } from "./Predict";
import { friendly } from "./errors";

// Per-generation look (mirrors the contract's cosmetic `palette` trait).
const LOOKS: PandaLook[] = [
  { patch: "#2b2230", scarf: "#ff5d6c", accent: "#ff9db0" }, // classic ink, cherry scarf
  { patch: "#1f4f56", scarf: "#ffc94a", accent: "#7fd6c8" }, // deep teal, sunflower
  { patch: "#5a2236", scarf: "#7fcf5a", accent: "#ff9fbd" }, // plum, leaf
  { patch: "#22305a", scarf: "#ff9a3c", accent: "#9db8ff" }, // navy, tangerine
  { patch: "#3c4a2a", scarf: "#c69cff", accent: "#b6e08f" }, // moss, lilac
  { patch: "#4a3326", scarf: "#5ec8f2", accent: "#f2c49b" }, // cocoa, sky
];

type Amount = 10 | 50 | "fill";

// Shown for the first moment while the live Totem loads from testnet.
const LOADING: TotemView = {
  name: "…", generation: 1, alive: true, fullnessBp: 10_000, mood: "happy", level: 1, maxLevel: 1, form: "egg",
  xpHappyDays: 0, nextLevelHappyDays: 1, hoard: 0, totalBurned: 0, totalFed: 0, mealSize: 100, fillAmount: 0,
  secondsUntilStarving: null, secondsUntilRampage: null, secondsUntilDeath: null, secondsUntilNextBite: null,
  bitesUntilDeath: 1,
};

interface Toast {
  id: number;
  text: string;
  kind: string;
}

export default function App() {
  const game = useGame();
  const chat = useTotemChat(game);
  const [chatOpen, setChatOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  // null = closed; 0 = open on the ledger; n = open on generation n's life
  const [histGen, setHistGen] = useState<number | null>(null);
  const [stakeOpen, setStakeOpen] = useState(false);
  const [predictOpen, setPredictOpen] = useState(false);
  const [tribeOpen, setTribeOpen] = useState(() => new URLSearchParams(location.search).has("tribe"));
  // opened from an SOS link (?rescue=1)
  const [rescueOpen, setRescueOpen] = useState(() => new URLSearchParams(location.search).has("rescue"));
  const closeRescue = () => {
    setRescueOpen(false);
    history.replaceState(null, "", location.pathname);
  };
  useEffect(() => {
    if (rescueOpen) game.setMode("live");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const start = useRef(Date.now());

  const [tool, setTool] = useState<Tool>("pet");
  const [amount, setAmount] = useState<Amount>(50);
  const [muted, setMutedState] = useState(false);
  const [follow, setFollow] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [info, setInfo] = useState<null | "totem" | "hoard">(null);
  const [guestKey, setGuestKey] = useState<null | "backup" | "restore">(null);
  // generation whose death card the player hid (it shrinks to a pill; a new death shows it again)
  const [deathHidden, setDeathHidden] = useState<number | null>(null);
  const [hint, setHint] = useState(true);
  const [hurt, setHurt] = useState(0);
  const [combo, setCombo] = useState(0);
  const comboTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastEventId = useRef(0);
  const prev = useRef({ mood: "happy", level: 1, alive: true, name: "" });

  const now = Date.now();
  const loading = !game.view;
  const view: TotemView = game.view ?? LOADING;
  const graves = game.graves;
  const dayFrac = (((now - start.current) / DAY_MS + 0.08) % 1 + 1) % 1;
  const tribe = useTribe(game.mode === "live" && (tribeOpen || (!loading && !view.alive)));
  const autoHatch = useAutoHatch(game.mode === "live" && !loading && !view.alive);
  const belly = useBelly(game.mode === "live");
  const nextName = `${view.name.replace(/\s+[IVXLCDM]+$/, "")} ${roman(view.generation + 1)}`;
  const look = LOOKS[((game.palette % LOOKS.length) + LOOKS.length) % LOOKS.length];

  // switching backends restarts the event stream
  useEffect(() => {
    lastEventId.current = Math.max(0, ...game.events.map((e) => e.id));
    prev.current = { mood: view.mood, level: view.level, alive: view.alive, name: view.name };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.mode, loading]);

  // events -> toasts
  useEffect(() => {
    const fresh = game.events.filter((e) => e.id > lastEventId.current).reverse();
    if (!fresh.length) return;
    lastEventId.current = Math.max(...fresh.map((e) => e.id));
    fresh
      .filter((e) => e.kind !== "feed")
      .forEach((e) => pushToast(e.text, e.kind));
  });

  const pushToast = (text: string, kind: string) => {
    const id = Math.random();
    setToasts((ts) => [...ts.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4200);
  };

  // transitions -> sound & juice
  useEffect(() => {
    const p = prev.current;
    if (view.alive && view.level > p.level) {
      sfx.levelUp();
      addBurst("text", world.panda.pos.clone().setY(3.2), `LEVEL ${view.level}!`, "#ffd54a");
    }
    if (view.alive && view.level < p.level) {
      setHurt((h) => h + 1);
      sfx.rampage();
    }
    if (view.mood === "rampage" && p.mood !== "rampage") sfx.rampage();
    if (!view.alive && p.alive) sfx.death();
    prev.current = { mood: view.mood, level: view.level, alive: view.alive, name: view.name };
  }, [view.mood, view.level, view.alive, view.name, view.maxLevel]);

  // panda finished a snack
  useEffect(() => {
    world.onAte = (f) => {
      sfx.chomp();
      if (f.kind === "apple") addBurst("text", f.pos.clone().setY(1.6), "yum!", "#ff7a98");
    };
    return () => {
      world.onAte = null;
    };
  }, []);

  const feedAt = async (x: number, z: number) => {
    if (!view.alive || game.busy) return;
    // on live every feed is a transaction: drop mode is one-shot, so later taps don't sign again
    if (game.mode === "live") setTool("pet");
    if (game.mode === "live" && view.secondsUntilDeath !== null && view.secondsUntilDeath < 20)
      pushToast(`⏳ Hurry: ${view.name.split(" ")[0]} dies in ${Math.ceil(view.secondsUntilDeath)}s. If it dies before your transaction lands, the feed is refused (only gas is spent).`, "bite");
    if (game.mode === "live") addBurst("text", new THREE.Vector3(x, 1.2, z), "signing…", "#ffffff");
    try {
      const r = await game.feed(amount);
      const size = 0.8 + Math.min(1.4, Math.log10(r.accepted + 1) * 0.55);
      dropFood(x, z, "bamboo", size);
      sfx.feed(combo + 1);
      addBurst("text", new THREE.Vector3(x, 2, z), `+${fmt(r.accepted)} 🎋`, "#7be37a");
      addBurst("text", new THREE.Vector3(x + 0.6, 1.4, z), `🔥 ${fmt(r.burn)} burned`, "#ff8a4d");
      if (r.rescue) {
        sfx.rescue();
        addBurst("text", new THREE.Vector3(x, 2.8, z), "RESCUE ×2!", "#ffd54a");
      }
      chat.fed();
      setCombo((c) => c + 1);
      clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => setCombo(0), 1800);
    } catch (e) {
      sfx.click();
      const msg = e instanceof Error ? e.message : String(e);
      if (/full/i.test(msg)) addBurst("text", world.panda.pos.clone().setY(2.8), "I'm full! 😋", "#ffffff");
      else pushToast(friendly(e), "info");
    }
  };

  const feedNearPanda = () => {
    const P = world.panda;
    const a = P.heading + (Math.random() - 0.5) * 1.2;
    feedAt(P.pos.x + Math.sin(a) * 2.2, P.pos.z + Math.cos(a) * 2.2);
  };

  const onGround = (p: THREE.Vector3) => {
    setHint(false);
    if (tool === "bamboo") feedAt(p.x, p.z);
    else if (tool === "ball") {
      throwBall(p.x, p.z);
      sfx.click();
    } else addBurst("spark", p.clone().setY(0.3), undefined, "#ffffff");
  };

  const doPoke = async () => {
    try {
      await game.poke();
      sfx.coin();
      addBurst("coin", new THREE.Vector3(2.6, 1.6, -7));
    } catch (e) {
      pushToast(friendly(e), "info");
    }
  };

  const doHatch = () => {
    if (!game.hatch) return;
    game.hatch();
    sfx.hatch();
    addBurst("text", world.panda.pos.clone().setY(2.5), "🥚 hatched!", "#ffd54a");
  };

  const doFaucet = async () => {
    try {
      await game.faucet();
      sfx.coin();
      pushToast("🚰 +1,000 test $TOTEM. Now feed it!", "level_up");
    } catch (e) {
      pushToast(friendly(e), "info");
    }
  };

  const toggleMute = () => {
    const m = !muted;
    setMutedState(m);
    setMuted(m);
    if (!m) sfx.click();
  };

  // keyboard shortcuts
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "1") setTool("pet");
      if (e.key === "2") setTool("bamboo");
      if (e.key === "3") setTool("ball");
      if (e.key === "f") setFollow((f) => !f);
      if (e.key === "t") setChatOpen((o) => !o);
      if (e.key === " ") {
        e.preventDefault();
        feedNearPanda();
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const pct = view.fullnessBp / 100;
  const barColor = view.fullnessBp >= 7000 ? "#5bd87a" : view.fullnessBp >= 3000 ? "#ffc94a" : "#ff5d6c";
  const rampage = view.mood === "rampage";
  const leaderboard = game.leaderboard;

  return (
    <div className={`app mood-${view.mood} ${hurt ? "hurt-" + (hurt % 2) : ""}`}>
      <div className="world">
        <World
          mood={view.mood}
          form={view.form}
          level={view.level}
          hoard={view.hoard}
          dayFrac={dayFrac}
          look={look}
          graves={graves}
          onGrave={game.mode === "live" ? (g) => setHistGen(g) : undefined}
          follow={follow}
          onGround={onGround}
          onPet={() => {
            setHint(false);
            sfx.feed(2);
            chat.hello();
          }}
          speech={chat.speech}
          onShakeTree={() => {
            sfx.click();
            pushToast("🍎 Apples are a free snack. Only $TOTEM bamboo fills its belly.", "info");
          }}
          onInfo={(w) => setInfo(w)}
        />
      </div>

      {rampage && <div className="rage-vignette" />}
      {loading && <div className="loading-pill glass">Waking the Totem on testnet…</div>}

      {/* ---------- top-left: identity ---------- */}
      <div className="hud-tl glass">
        <div className="name-line">
          <span className="shiny">{view.name}</span>
          <span className={`mood-pill m-${view.mood}`}>{moodEmoji(view.mood)} {view.mood}</span>
        </div>
        <div className="sub-line">
          <span className="chip">gen {view.generation}</span>
          <span className="chip">{view.form}</span>
          <span className="chip lvl">Level {view.level}</span>
        </div>
        <div className="lives" title="Each bite costs a level. At Level 0 it dies.">
          {Array.from({ length: Math.max(view.level, 0) }).map((_, i) => (
            <span key={i} className="life">❤</span>
          ))}
          {Array.from({ length: Math.max(0, view.maxLevel - view.level) }).map((_, i) => (
            <span key={i} className="life lost">❤</span>
          ))}
          <span className="lives-lbl">{view.alive ? `${view.bitesUntilDeath} bite${view.bitesUntilDeath === 1 ? "" : "s"} from death` : "gone"}</span>
        </div>
        <div className="xp">
          <div
            className="xp-fill"
            style={{
              width: view.alive && view.nextLevelHappyDays ? `${Math.min(100, (view.xpHappyDays / view.nextLevelHappyDays) * 100)}%` : "0%",
            }}
          />
        </div>
      </div>

      {/* ---------- top-right: treasury ---------- */}
      <div className="hud-tr">
        <div className="stat-card glass" onClick={() => setInfo("hoard")}>
          <div className="stat-lbl">💰 Hoard</div>
          <div className="stat-val gold"><Ticker value={view.hoard} /></div>
          {(view.releasedStakes ?? 0) >= 1 && <div className="stat-sub">+{fmt(view.releasedStakes ?? 0)} stakes to withdraw</div>}
        </div>
        <div className="stat-card glass">
          <div className="stat-lbl">🔥 Burned forever</div>
          <div className="stat-val ember"><Ticker value={view.totalBurned} /></div>
        </div>
        <div className="wallet glass">
          <div className="mode-switch">
            <button className={game.mode === "live" ? "on" : ""} onClick={() => game.setMode("live")}>
              <span className={`dot ${game.liveStatus}`} /> Live testnet
            </button>
            <button className={game.mode === "practice" ? "on" : ""} onClick={() => game.setMode("practice")}>🧪 Practice</button>
          </div>
          {game.mode === "live" &&
            (game.accountId ? (
              <>
                <div className="acct" title={game.accountId}>
                  <span className="acct-id">{game.isGuest ? shortGuest(game.accountId) : game.accountId}</span>
                  <button className="link-btn" onClick={() => game.disconnect()}>sign out</button>
                </div>
                <div className="acct-bal">
                  {game.balance === null ? "…" : `${fmt(game.balance)} $TOTEM`}
                  <button className="mini-btn" onClick={doFaucet} disabled={game.busy}>🚰 Get test $TOTEM</button>
                </div>
                <BellyLine b={belly} onOpen={() => setStakeOpen(true)} />
                {game.isGuest && (
                  <div className="guest-note">
                    ⚡ free guest · the game pays your gas ·{" "}
                    <button className="link-btn" onClick={() => setGuestKey("backup")}>🔑 back up</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <button className="press-btn wallet-btn" onClick={() => game.connect().catch(() => undefined)}>Connect wallet</button>
                {game.freePlay && (
                  <>
                    <button className="ghost-btn guest-btn" onClick={() => game.playAsGuest().catch((e) => pushToast(friendly(e), "info"))}>
                      ⚡ Play free, no wallet
                    </button>
                    <button className="link-btn restore-link" onClick={() => setGuestKey("restore")}>have a guest backup code?</button>
                  </>
                )}
              </>
            ))}
          {game.mode === "live" && (
            <a className="explorer-link" href={game.explorer} target="_blank" rel="noreferrer">contract on explorer ↗</a>
          )}
        </div>
        <div className="icon-row">
          {game.mode === "live" && (
            <button className={`icon-btn ${tribeOpen ? "on" : ""}`} onClick={() => setTribeOpen((o) => !o)} title="The tribe: votes and Keepers">🏛</button>
          )}
          {game.mode === "live" && (
            <button className={`icon-btn ${histGen !== null ? "on" : ""}`} onClick={() => setHistGen((h) => (h === null ? 0 : null))} title="On-chain history: every mint, burn, bite and life">🧾</button>
          )}
          {game.mode === "live" && (
            <button className={`icon-btn ${predictOpen ? "on" : ""} ${game.activeMarket && !game.activeMarket.resolved ? "pulse" : ""}`} onClick={() => setPredictOpen((o) => !o)} title="Prediction market: bet on survival">🔮</button>
          )}
          <button className="icon-btn" onClick={() => setSosOpen(true)} title="Share / call for help">📣</button>
          <button className={`icon-btn ${chatOpen ? "on" : ""}`} onClick={() => setChatOpen((o) => !o)} title="Talk to the Totem (T)">💬</button>
          <button className={`icon-btn ${follow ? "on" : ""}`} onClick={() => setFollow((f) => !f)} title="Follow the panda (F)">🎥</button>
          <button className="icon-btn" onClick={() => setDrawer((d) => !d)} title="Tribe">📜</button>
          <button className="icon-btn" onClick={toggleMute} title="Sound">{muted ? "🔇" : "🔊"}</button>
        </div>
      </div>

      {/* ---------- hunger ---------- */}
      <div className="hud-hunger glass">
        <div className="hunger-head">
          <span>🎋 Belly</span>
          <span style={{ color: barColor }}>{pct.toFixed(0)}%</span>
        </div>
        <div className="liquid">
          <div className="liquid-fill" style={{ width: `${pct}%`, background: barColor }}>
            <span className="bubble b1" />
            <span className="bubble b2" />
            <span className="bubble b3" />
          </div>
          <div className="liquid-mark" style={{ left: "30%" }} />
          <div className="liquid-mark" style={{ left: "70%" }} />
        </div>
        <div className="hunger-foot">
          {!view.alive ? (
            <span className="danger">💀 it starved</span>
          ) : rampage ? (
            <span className="danger blink">⚡ next bite in {fmtTime(view.secondsUntilNextBite)}</span>
          ) : (
            <>
              <span>😰 starving in {fmtTime(view.secondsUntilStarving)}</span>
              <span className="danger">🔥 first bite in {fmtTime(view.secondsUntilNextBite)}</span>
            </>
          )}
        </div>
        {view.alive && view.fullnessBp < 7000 && (
          <button className={`sos-btn ${rampage ? "hot" : ""}`} onClick={() => setSosOpen(true)}>
            🆘 Call for help
          </button>
        )}
        {combo > 1 && <div className="combo">{combo}× combo!</div>}
      </div>

      {/* ---------- the dock ---------- */}
      <Dock>
        <DockItem active={tool === "pet"} label="Pet (1)" onClick={() => setTool("pet")}>✋</DockItem>
        <DockItem active={tool === "bamboo"} label={game.mode === "live" ? "Drop bamboo: tap the grass once (2)" : "Drop bamboo (2)"} onClick={() => setTool("bamboo")}>🎋</DockItem>
        <DockItem active={tool === "ball"} label="Throw ball (3)" onClick={() => setTool("ball")}>⚽</DockItem>
        <div className="dock-sep" />
        {([10, 50, "fill"] as Amount[]).map((a) => (
          <DockItem
            key={String(a)}
            active={amount === a}
            label={a === "fill" ? `Fill up (${fmt(view.fillAmount)})` : `${a} $TOTEM`}
            onClick={() => {
              setAmount(a);
              // practice: tapping the grass drops this much. Live: only sets the FEED amount
              if (game.mode === "practice") setTool("bamboo");
            }}
            small
          >
            {a === "fill" ? "🍱" : a}
          </DockItem>
        ))}
        <div className="dock-sep" />
        <button className="press-btn" onClick={feedNearPanda} disabled={!view.alive || game.busy}>
          FEED <span className="kbd">space</span>
        </button>
      </Dock>

      {/* ---------- toasts ---------- */}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast k-${t.kind}`}>{t.text}</div>
        ))}
      </div>

      {hint && view.alive && (
        <div className="hint glass">
          <b>Say hi to {view.name.split(" ")[0]}!</b> Tap it to pet · pick 🎋 and tap the grass to feed · ⚽ to play · shake the trees · drag to look around
        </div>
      )}

      {/* ---------- rampage ---------- */}
      {rampage && (
        <div className="rampage-card beam">
          <div className="rc-title">🔥 RAMPAGE</div>
          <div className="rc-sub">
            {view.name} is starving. Every bite burns 15% of the Hoard and knocks a block off the totem pole.
          </div>
          <div className="rc-row">
            <button className="press-btn danger-btn" onClick={() => { setAmount("fill"); feedNearPanda(); }}>🎋 RESCUE</button>
            <button className="ghost-btn" onClick={doPoke}>⚡ poke for a tip</button>
            {game.mode === "live" && (
              <button className="ghost-btn" onClick={() => setPredictOpen(true)}>🔮 place a bet</button>
            )}
          </div>
        </div>
      )}

      {tribeOpen && game.mode === "live" && (
        <TribePanel
          t={tribe}
          accountId={game.accountId}
          isGuest={game.isGuest}
          nextName={nextName}
          totemAlive={view.alive}
          onClose={() => {
            setTribeOpen(false);
            if (location.search.includes("tribe")) history.replaceState(null, "", location.pathname);
          }}
          onConnect={() => game.connect().catch(() => undefined)}
          onError={(m) => pushToast(friendly(m), "info")}
        />
      )}
      {stakeOpen && game.mode === "live" && view && (
        <StakeSheet game={game} b={belly} onClose={() => setStakeOpen(false)} toast={(m, k) => pushToast(m, k ?? "info")} />
      )}
      {predictOpen && game.mode === "live" && (
        <PredictPanel game={game} onClose={() => setPredictOpen(false)} toast={(m, k) => pushToast(m, k ?? "info")} />
      )}
      {histGen !== null && game.mode === "live" && <HistoryPanel focusGeneration={histGen || null} onClose={() => setHistGen(null)} />}
      {sosOpen && !loading && <SosSheet view={view} onClose={() => setSosOpen(false)} toast={(t) => pushToast(t, "info")} />}
      {rescueOpen && (
        <RescueCard
          game={game}
          toast={(t) => pushToast(t, "info")}
          onClose={closeRescue}
          onDone={(heroic) => {
            sfx.rescue();
            addBurst("text", world.panda.pos.clone().setY(3), heroic ? "🦸 HERO!" : "+🎋", "#ffd54a");
            chat.fed(heroic ? "rescue" : "fed");
          }}
        />
      )}

      {chatOpen && !loading && (
        <TotemChat name={view.name} live={game.mode === "live"} chat={chat} onClose={() => setChatOpen(false)} />
      )}

      {/* ---------- death ---------- */}
      {!view.alive && deathHidden === view.generation && (
        <button className="death-pill glass" onClick={() => setDeathHidden(null)}>
          🪦 {graves[graves.length - 1]?.name ?? view.name} · tap for details
        </button>
      )}
      {!view.alive && deathHidden !== view.generation && (
        <div className="death-card glass">
          <button className="dc-close" aria-label="Hide" onClick={() => setDeathHidden(view.generation)}>✕</button>
          <div className="dc-title">🪦 {graves[graves.length - 1]?.name ?? view.name}</div>
          <div className="dc-sub">starved at Level 0 · reached Level {view.maxLevel}. A gravestone joins the lineage.</div>
          {autoHatch?.enabled && (
            <div className="dc-auto">
              🛠 Dev auto-hatch:{" "}
              {autoHatch.busy
                ? "the Keepers are voting…"
                : autoHatch.hatchAt
                  ? `the Keepers vote a new egg in ${fmtTime(Math.max(0, (autoHatch.hatchAt - now) / 1000))}`
                  : "the Keepers will vote a new egg soon"}
            </div>
          )}
          {game.hatch ? (
            <button className="press-btn" onClick={doHatch}>🥚 Hatch the next generation</button>
          ) : (
            <HatchVote
              t={tribe}
              nextName={nextName}
              accountId={game.accountId}
              onOpenTribe={() => setTribeOpen(true)}
              onError={(m) => pushToast(friendly(m), "info")}
            />
          )}
        </div>
      )}

      {/* ---------- info popover ---------- */}
      {info && (
        <div className="info-pop glass" onClick={() => setInfo(null)}>
          {info === "totem" ? (
            <>
              <div className="ip-title">🗿 The totem pole</div>
              <p>
                One carved block per level ({view.level} now). When the belly hits 0% the panda bites every ¼ day: each bite
                knocks the top block off. When the last block falls, {view.name} dies.
              </p>
            </>
          ) : (
            <>
              <div className="ip-title">💰 The Hoard</div>
              <p>
                <b>{fmt(view.hoard)} $TOTEM</b>. Half of every meal lands here and half is burned forever. A rampage bite burns
                15% of it. The tribe's caretakers are paid Blessings from it.
              </p>
              {view.treasury && (
                <p>
                  The Reserve sits in its own account,{" "}
                  <a href={`https://testnet.nearblocks.io/address/${view.treasury}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                    {view.treasury}
                  </a>
                  , which has no keys: nobody can sign for it, and its tokens move only by the contract's rules.
                </p>
              )}
              {!view.alive && <p>{view.name} is dead: its Reserve burned at death, so the Hoard is empty until the tribe hatches the next egg.</p>}
              {(view.releasedStakes ?? 0) >= 1 && (
                <p>
                  Not counted: <b>{fmt(view.releasedStakes ?? 0)} $TOTEM</b> of stakes from {view.alive ? "earlier lives" : "this life"}.
                  They belong to their stakers, who can withdraw them any time (or re-stake in the Tribe panel).
                </p>
              )}
            </>
          )}
          <div className="ip-close">tap to close</div>
        </div>
      )}

      {guestKey && <GuestKeySheet mode={guestKey} onClose={() => setGuestKey(null)} onDone={(m) => pushToast(m, "info")} />}

      {/* ---------- tribe drawer ---------- */}
      <aside className={`drawer glass ${drawer ? "open" : ""}`}>
        <div className="drawer-head">
          <span>🏅 Caretakers</span>
          <button className="icon-btn" onClick={() => setDrawer(false)}>✕</button>
        </div>
        {leaderboard.length === 0 ? (
          <div className="empty">{game.mode === "live" ? "No feeders this generation yet. Be the first." : "No feeders yet. Be the first."}</div>
        ) : (
          leaderboard.map((r, i) => (
            <div className="board-row" key={r.who}>
              <span className="rank">{["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`}</span>
              <span className="who">{r.who}</span>
              <span className="pts">{fmt(r.points)} {r.unit}</span>
            </div>
          ))
        )}
        <div className="drawer-head second">📜 Activity</div>
        <div className="feed-list">
          {game.events.slice(0, 14).map((e: GameEvent) => (
            <div className={`feed-item k-${e.kind}`} key={e.id}>{e.text}</div>
          ))}
        </div>
        <div className="drawer-foot">
          One creature. One tribe. No admin key. Built at NEAR HACKATHON.
        </div>
      </aside>
    </div>
  );
}

// --------------------------------------------------------------------------- //
// small UI kit (patterns from MagicUI / ReactBits / uiverse, hand-built)
// --------------------------------------------------------------------------- //

/** Animated number (MagicUI "NumberTicker" style). */
function Ticker({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const cur = useRef(value);
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const d = value - cur.current;
      if (Math.abs(d) < 0.005) {
        cur.current = value;
        setShown(value);
        return;
      }
      cur.current += d * 0.12;
      setShown(cur.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmt(shown)}</>;
}

/** macOS-style magnifying dock (MagicUI "Dock" style). */
function Dock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    ref.current?.querySelectorAll<HTMLElement>(".dock-item").forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(e.clientX - (r.left + r.width / 2));
      const s = 1 + Math.max(0, 1 - d / 140) * 0.45;
      el.style.setProperty("--mag", String(s));
    });
  };
  const onLeave = () => ref.current?.querySelectorAll<HTMLElement>(".dock-item").forEach((el) => el.style.setProperty("--mag", "1"));
  return (
    <div className="dock glass" ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

function DockItem({
  children,
  label,
  active,
  onClick,
  small,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      className={`dock-item ${active ? "active" : ""} ${small ? "small" : ""}`}
      onClick={() => {
        sfx.click();
        onClick();
      }}
    >
      <span className="dock-icon">{children}</span>
      <span className="dock-tip">{label}</span>
    </button>
  );
}


interface AutoHatch {
  enabled: boolean;
  hatchAt: number | null;
  busy: boolean;
}

/** While the team builds, the server re-hatches a dead Totem by DAO vote (server/autohatch.ts). */
function useAutoHatch(active: boolean): AutoHatch | null {
  const [s, setS] = useState<AutoHatch | null>(null);
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = () =>
      fetch("/api/autohatch")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => !stop && setS(j))
        .catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active]);
  return active ? s : null;
}

function moodEmoji(mood: string): string {
  return { happy: "😊", hungry: "🥺", starving: "😭", rampage: "😡", dead: "💀" }[mood] ?? "·";
}
