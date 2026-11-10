import { useEffect, useRef, useState } from "react";
import { TotemEngine, fmt, fmtTime, TotemView } from "./engine";
import { Creature } from "./components/Creature";
import { ParticleCanvas, ParticleHandle } from "./components/ParticleCanvas";
import { sfx, setMuted } from "./sfx";

interface FloatLabel {
  id: number;
  text: string;
  cls: string;
  x: number;
}

export default function App() {
  const engineRef = useRef<TotemEngine>();
  if (!engineRef.current) engineRef.current = new TotemEngine();
  const engine = engineRef.current;

  const [, setTick] = useState(0);
  const [floats, setFloats] = useState<FloatLabel[]>([]);
  const [reacting, setReacting] = useState(false);
  const [combo, setCombo] = useState(0);
  const [muted, setMutedState] = useState(false);
  const floatId = useRef(1);
  const comboTimer = useRef<ReturnType<typeof setTimeout>>();
  const pc = useRef<ParticleHandle>(null);
  const shakeNode = useRef<HTMLDivElement>(null);
  const shake = useRef(0);
  const prev = useRef({ mood: "happy", level: 1, alive: true });

  // engine tick
  useEffect(() => {
    const t = setInterval(() => {
      engine.settle(Date.now());
      setTick((n) => n + 1);
    }, 180);
    return () => clearInterval(t);
  }, [engine]);

  // screen-shake rAF loop (no React re-render)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      shake.current *= 0.86;
      if (shake.current < 0.15) shake.current = 0;
      const s = shake.current;
      if (shakeNode.current) {
        const dx = (Math.random() - 0.5) * s;
        const dy = (Math.random() - 0.5) * s;
        shakeNode.current.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const addShake = (n: number) => {
    shake.current = Math.min(28, shake.current + n);
  };

  const now = Date.now();
  const view: TotemView = engine.project(now);

  // mood / level / death transitions -> sound + particles
  useEffect(() => {
    const p = prev.current;
    if (view.level > p.level) {
      sfx.levelUp();
      pc.current?.emit("coin", 22, 0.5, 0.42);
      addShake(7);
    }
    if (view.mood === "rampage" && p.mood !== "rampage") {
      sfx.rampage();
      addShake(18);
    }
    if (!view.alive && p.alive) {
      sfx.death();
      pc.current?.emit("soul", 26, 0.5, 0.4);
    }
    prev.current = { mood: view.mood, level: view.level, alive: view.alive };
  }, [view.mood, view.level, view.alive]);

  // continuous rampage effects
  const isRampage = view.mood === "rampage";
  useEffect(() => {
    if (!isRampage) return;
    const id = setInterval(() => {
      pc.current?.emit("burn", 7, 0.5, 0.46);
      addShake(5);
    }, 420);
    return () => clearInterval(id);
  }, [isRampage]);

  const addFloat = (text: string, cls: string) => {
    const id = floatId.current++;
    const x = 50 + (Math.random() - 0.5) * 26;
    setFloats((f) => [...f, { id, text, cls, x }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100);
  };

  const bumpCombo = () => {
    setCombo((c) => c + 1);
    clearTimeout(comboTimer.current);
    comboTimer.current = setTimeout(() => setCombo(0), 1700);
  };

  const doFeed = (amount: number) => {
    if (!view.alive) return;
    try {
      const r = engine.feed(amount, Date.now());
      sfx.feed(combo + 1);
      sfx.chomp();
      setReacting(true);
      setTimeout(() => setReacting(false), 360);
      pc.current?.emit("crumb", 16, 0.5, 0.44);
      pc.current?.emit("coin", 8, 0.5, 0.72);
      addShake(5 + Math.min(combo, 8));
      addFloat(`+${fmt(r.accepted)} 🍖`, "float-fed");
      addFloat(`🔥 −${fmt(r.burn)}`, "float-burn");
      if (r.rescue) {
        addFloat("RESCUE ×2!", "float-rescue");
        sfx.rescue();
        pc.current?.emit("heart", 8, 0.5, 0.4);
      }
      bumpCombo();
      setTick((n) => n + 1);
    } catch {
      addFloat("full!", "float-burn");
      sfx.click();
    }
  };

  const doPoke = () => {
    engine.poke(Date.now());
    sfx.coin();
    pc.current?.emit("coin", 6, 0.5, 0.72);
    setTick((n) => n + 1);
  };

  const doHatch = () => {
    engine.hatch(Date.now());
    sfx.hatch();
    pc.current?.emit("coin", 14, 0.5, 0.42);
    setTick((n) => n + 1);
  };

  const toggleMute = () => {
    const m = !muted;
    setMutedState(m);
    setMuted(m);
    if (!m) sfx.click();
  };

  const pct = view.fullnessBp / 100;
  const segs = 20;
  const litSegs = Math.round((pct / 100) * segs);
  const barColor =
    view.fullnessBp >= 7000 ? "#39d353" : view.fullnessBp >= 3000 ? "#e3b341" : "#f85149";

  const leaderboard = engine.leaderboard();
  const coinCount = Math.min(36, Math.max(0, Math.floor(Math.log10(view.hoard + 1) * 9)));

  return (
    <div className={`app mood-bg-${view.mood}`}>
      <div className="crt" />
      <div className="scanlines" />

      {view.mood === "rampage" && (
        <RampageOverlay view={view} onRescue={() => doFeed(view.fillAmount)} onPoke={doPoke} />
      )}

      <header className="topbar">
        <div className="brand">🗿 TOTEM</div>
        <div className="tagline">feed it, or it eats your treasury</div>
        <div className="top-right">
          <div className="demo-pill">1 day = 2 min</div>
          <button className="mute" onClick={toggleMute}>{muted ? "🔇" : "🔊"}</button>
        </div>
      </header>

      <div className="game" ref={shakeNode}>
        <section className="scene">
          <ParticleCanvas ref={pc} mood={view.mood} />
          <div className="bg-layer bg-far" />
          <div className="bg-layer bg-pillars" />

          <div className="name-row">
            <h1 className="creature-name">{view.name}</h1>
            <span className="gen">gen {view.generation}</span>
            <span className={`mood-chip mood-${view.mood}`}>
              {moodEmoji(view.mood)} {view.mood}
            </span>
            {combo > 1 && <span className="combo">{combo}× COMBO!</span>}
          </div>

          <div className="pedestal-area">
            <Creature mood={view.mood} form={view.form} reacting={reacting} />
            <div className="pedestal" />
            <div className="floats">
              {floats.map((f) => (
                <span key={f.id} className={`float ${f.cls}`} style={{ left: `${f.x}%` }}>
                  {f.text}
                </span>
              ))}
            </div>
          </div>

          {/* Hoard treasure pile */}
          <div className={`hoard ${isRampage ? "shaking" : ""}`}>
            <div className="coin-pile">
              {Array.from({ length: coinCount }).map((_, i) => (
                <span
                  key={i}
                  className="coin"
                  style={{
                    left: `${50 + (i % 9) * 5 - 20 + (Math.floor(i / 9) % 2) * 2.5}%`,
                    bottom: `${Math.floor(i / 9) * 7}px`,
                  }}
                />
              ))}
            </div>
            <div className="hoard-label">
              HOARD · {fmt(view.hoard)} $TOTEM
            </div>
          </div>
        </section>

        {/* HUD */}
        <section className="hud">
          <div className="hud-bars">
            <div className="hunger-block">
              <div className="hunger-top">
                <span>HUNGER</span>
                <span style={{ color: barColor }}>{pct.toFixed(0)}%</span>
              </div>
              <div className={`seg-bar ${view.fullnessBp < 3000 ? "pulse" : ""}`}>
                {Array.from({ length: segs }).map((_, i) => (
                  <span
                    key={i}
                    className="seg"
                    style={{ background: i < litSegs ? barColor : "#1a2130" }}
                  />
                ))}
              </div>
              <div className="countdowns">
                {view.alive ? (
                  isRampage ? (
                    <span className="danger blink">💀 dies in {fmtTime(view.secondsUntilDeath)}</span>
                  ) : (
                    <>
                      <span>😰 starving in {fmtTime(view.secondsUntilStarving)}</span>
                      <span className="danger">🔥 rampage in {fmtTime(view.secondsUntilRampage)}</span>
                    </>
                  )
                ) : (
                  <span className="danger">💀 dead — hatch a new egg</span>
                )}
              </div>
            </div>

            <div className="level-badge">
              <div className="lvl-num">L{view.level}</div>
              <div className="lvl-form">{view.form}</div>
              <div className="xp-mini">
                <div
                  className="xp-mini-fill"
                  style={{
                    width: view.nextLevelHappyDays
                      ? `${Math.min(100, (view.xpHappyDays / view.nextLevelHappyDays) * 100)}%`
                      : "100%",
                  }}
                />
              </div>
            </div>
          </div>

          {view.alive ? (
            <div className="feed-controls">
              <button className="feed-btn" onClick={() => doFeed(10)}>+10 🍖</button>
              <button className="feed-btn" onClick={() => doFeed(50)}>+50 🍖</button>
              <button className="feed-btn fill" onClick={() => doFeed(view.fillAmount)}>
                FILL UP ({fmt(view.fillAmount)}) 🍖
              </button>
              {isRampage && <button className="poke-btn" onClick={doPoke}>⚡ POKE</button>}
            </div>
          ) : (
            <div className="feed-controls">
              <button className="feed-btn fill" onClick={doHatch}>🥚 HATCH NEW EGG</button>
            </div>
          )}
        </section>
      </div>

      {/* bottom panels */}
      <div className="bottom">
        <div className="panel stats-panel">
          <Stat label="🔥 Burned forever" value={fmt(view.totalBurned)} hint="50% of every meal" />
          <Stat label="🍖 Total fed" value={fmt(view.totalFed)} />
          <Stat label="🏆 Max level" value={`L${view.maxLevel}`} />
          <Stat label="🍽 Meal size" value={fmt(view.mealSize)} />
        </div>

        <div className="panel board-panel">
          <div className="panel-title">🏅 Caretakers</div>
          {leaderboard.length === 0 ? (
            <div className="empty">No feeders yet — be the first.</div>
          ) : (
            leaderboard.map((r, i) => (
              <div className="board-row" key={r.who}>
                <span className="rank">#{i + 1}</span>
                <span className="who">{r.who}</span>
                <span className="pts">{fmt(r.points)}</span>
              </div>
            ))
          )}
        </div>

        <div className="panel ticker-panel">
          <div className="panel-title">📜 Activity</div>
          <div className="ticker-feed">
            {engine.events.slice(0, 7).map((e) => (
              <div className={`tick-item kind-${e.kind}`} key={e.id}>
                {e.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="footer">
        <span>One creature. One tribe. No admin key.</span>
        <span className="muted">
          Built at NEAR HACKATHON · burn-on-feed · the NFT owns the treasury · Sputnik DAO governed
        </span>
      </footer>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function RampageOverlay({
  view,
  onRescue,
  onPoke,
}: {
  view: TotemView;
  onRescue: () => void;
  onPoke: () => void;
}) {
  return (
    <div className="rampage-overlay">
      <div className="rampage-card">
        <div className="rampage-title">🔥 RAMPAGE</div>
        <div className="rampage-sub">{view.name} is eating the Hoard!</div>
        <div className="rampage-numbers">
          <div>
            <div className="rn-val">{fmt(view.hoard)}</div>
            <div className="rn-lbl">Hoard left</div>
          </div>
          <div>
            <div className="rn-val danger">{fmtTime(view.secondsUntilDeath)}</div>
            <div className="rn-lbl">until death</div>
          </div>
        </div>
        <button className="rescue-btn" onClick={onRescue}>🍖 RESCUE IT</button>
        <button className="poke-link" onClick={onPoke}>or poke it for a tip ⚡</button>
      </div>
    </div>
  );
}

function moodEmoji(mood: string): string {
  return { happy: "😊", hungry: "😐", starving: "😰", rampage: "🔥", dead: "💀" }[mood] ?? "·";
}
