import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TotemEngine, fmt, fmtTime, TotemView, DAY_MS, GameEvent } from "./engine";
import { World } from "./world/World";
import { PandaLook } from "./world/Panda";
import { Tool, addBurst, dropFood, throwBall, world } from "./world/store";
import { sfx, setMuted } from "./sfx";

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

interface Toast {
  id: number;
  text: string;
  kind: string;
}

export default function App() {
  const engineRef = useRef<TotemEngine>();
  if (!engineRef.current) engineRef.current = new TotemEngine();
  const engine = engineRef.current;
  const start = useRef(Date.now());

  const [, setTick] = useState(0);
  const [tool, setTool] = useState<Tool>("pet");
  const [amount, setAmount] = useState<Amount>(50);
  const [muted, setMutedState] = useState(false);
  const [follow, setFollow] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [info, setInfo] = useState<null | "totem" | "hoard">(null);
  const [graves, setGraves] = useState<{ name: string; maxLevel: number }[]>([]);
  const [hint, setHint] = useState(true);
  const [hurt, setHurt] = useState(0);
  const [combo, setCombo] = useState(0);
  const comboTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastEventId = useRef(0);
  const prev = useRef({ mood: "happy", level: 1, alive: true, name: "" });

  // engine tick
  useEffect(() => {
    const t = setInterval(() => {
      engine.settle(Date.now());
      setTick((n) => n + 1);
    }, 200);
    return () => clearInterval(t);
  }, [engine]);

  const now = Date.now();
  const view: TotemView = engine.project(now);
  const dayFrac = (((now - start.current) / DAY_MS + 0.08) % 1 + 1) % 1;
  const look = LOOKS[(view.generation - 1) % LOOKS.length];

  // events -> toasts
  useEffect(() => {
    const fresh = engine.events.filter((e) => e.id > lastEventId.current).reverse();
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
    if (!view.alive && p.alive) {
      sfx.death();
      setGraves((g) => [...g, { name: p.name || view.name, maxLevel: view.maxLevel }]);
    }
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

  const feedAt = (x: number, z: number) => {
    if (!view.alive) return;
    const want = amount === "fill" ? view.fillAmount : amount;
    try {
      const r = engine.feed(want, Date.now());
      const size = 0.8 + Math.min(1.4, Math.log10(r.accepted + 1) * 0.55);
      dropFood(x, z, "bamboo", size);
      sfx.feed(combo + 1);
      addBurst("text", new THREE.Vector3(x, 2, z), `+${fmt(r.accepted)} 🎋`, "#7be37a");
      addBurst("text", new THREE.Vector3(x + 0.6, 1.4, z), `🔥 ${fmt(r.burn)} burned`, "#ff8a4d");
      if (r.rescue) {
        sfx.rescue();
        addBurst("text", new THREE.Vector3(x, 2.8, z), "RESCUE ×2!", "#ffd54a");
      }
      setCombo((c) => c + 1);
      clearTimeout(comboTimer.current);
      comboTimer.current = setTimeout(() => setCombo(0), 1800);
      setTick((n) => n + 1);
    } catch {
      sfx.click();
      addBurst("text", world.panda.pos.clone().setY(2.8), "I'm full! 😋", "#ffffff");
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

  const doPoke = () => {
    engine.poke(Date.now());
    sfx.coin();
    addBurst("coin", new THREE.Vector3(2.6, 1.6, -7));
    setTick((n) => n + 1);
  };

  const doHatch = () => {
    engine.hatch(Date.now());
    sfx.hatch();
    addBurst("text", world.panda.pos.clone().setY(2.5), "🥚 hatched!", "#ffd54a");
    setTick((n) => n + 1);
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
  const leaderboard = engine.leaderboard();

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
          follow={follow}
          onGround={onGround}
          onPet={() => {
            setHint(false);
            sfx.feed(2);
          }}
          onShakeTree={() => {
            sfx.click();
            pushToast("🍎 Apples are a free snack. Only $TOTEM bamboo fills its belly.", "info");
          }}
          onInfo={(w) => setInfo(w)}
        />
      </div>

      {rampage && <div className="rage-vignette" />}

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
        </div>
        <div className="stat-card glass">
          <div className="stat-lbl">🔥 Burned forever</div>
          <div className="stat-val ember"><Ticker value={view.totalBurned} /></div>
        </div>
        <div className="icon-row">
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
        {combo > 1 && <div className="combo">{combo}× combo!</div>}
      </div>

      {/* ---------- the dock ---------- */}
      <Dock>
        <DockItem active={tool === "pet"} label="Pet (1)" onClick={() => setTool("pet")}>✋</DockItem>
        <DockItem active={tool === "bamboo"} label="Drop bamboo (2)" onClick={() => setTool("bamboo")}>🎋</DockItem>
        <DockItem active={tool === "ball"} label="Throw ball (3)" onClick={() => setTool("ball")}>⚽</DockItem>
        <div className="dock-sep" />
        {([10, 50, "fill"] as Amount[]).map((a) => (
          <DockItem
            key={String(a)}
            active={amount === a}
            label={a === "fill" ? `Fill up (${fmt(view.fillAmount)})` : `${a} $TOTEM`}
            onClick={() => {
              setAmount(a);
              setTool("bamboo");
            }}
            small
          >
            {a === "fill" ? "🍱" : a}
          </DockItem>
        ))}
        <div className="dock-sep" />
        <button className="press-btn" onClick={feedNearPanda} disabled={!view.alive}>
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
          </div>
        </div>
      )}

      {/* ---------- death ---------- */}
      {!view.alive && (
        <div className="death-card glass">
          <div className="dc-title">🪦 {graves[graves.length - 1]?.name ?? view.name}</div>
          <div className="dc-sub">starved at Level 0 · reached Level {view.maxLevel}. A gravestone joins the lineage.</div>
          <button className="press-btn" onClick={doHatch}>🥚 Hatch the next generation</button>
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
            </>
          )}
          <div className="ip-close">tap to close</div>
        </div>
      )}

      {/* ---------- tribe drawer ---------- */}
      <aside className={`drawer glass ${drawer ? "open" : ""}`}>
        <div className="drawer-head">
          <span>🏅 Caretakers</span>
          <button className="icon-btn" onClick={() => setDrawer(false)}>✕</button>
        </div>
        {leaderboard.length === 0 ? (
          <div className="empty">No feeders yet. Be the first.</div>
        ) : (
          leaderboard.map((r, i) => (
            <div className="board-row" key={r.who}>
              <span className="rank">{["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`}</span>
              <span className="who">{r.who}</span>
              <span className="pts">{fmt(r.points)} pts</span>
            </div>
          ))
        )}
        <div className="drawer-head second">📜 Activity</div>
        <div className="feed-list">
          {engine.events.slice(0, 14).map((e: GameEvent) => (
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

function moodEmoji(mood: string): string {
  return { happy: "😊", hungry: "🥺", starving: "😭", rampage: "😡", dead: "💀" }[mood] ?? "·";
}
