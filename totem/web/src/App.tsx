import { useEffect, useRef, useState } from "react";
import { TotemEngine, fmt, fmtTime, TotemView } from "./engine";
import { Creature } from "./components/Creature";

interface FloatLabel {
  id: number;
  text: string;
  cls: string;
}

export default function App() {
  const engineRef = useRef<TotemEngine>();
  if (!engineRef.current) engineRef.current = new TotemEngine();
  const engine = engineRef.current;

  const [, setTick] = useState(0);
  const [floats, setFloats] = useState<FloatLabel[]>([]);
  const [chomp, setChomp] = useState(false);
  const floatId = useRef(1);

  useEffect(() => {
    const t = setInterval(() => {
      engine.settle(Date.now());
      setTick((n) => n + 1);
    }, 200);
    return () => clearInterval(t);
  }, [engine]);

  const now = Date.now();
  const view: TotemView = engine.project(now);

  const addFloat = (text: string, cls: string) => {
    const id = floatId.current++;
    setFloats((f) => [...f, { id, text, cls }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 1100);
  };

  const doFeed = (amount: number) => {
    if (!view.alive) return;
    try {
      const r = engine.feed(amount, Date.now());
      setChomp(true);
      setTimeout(() => setChomp(false), 380);
      addFloat(`+${fmt(r.accepted)} 🍖`, "float-fed");
      addFloat(`🔥 −${fmt(r.burn)}`, "float-burn");
      if (r.rescue) addFloat("RESCUE! ×2", "float-rescue");
      setTick((n) => n + 1);
    } catch {
      addFloat("full!", "float-burn");
    }
  };

  const doPoke = () => {
    engine.poke(Date.now());
    setTick((n) => n + 1);
  };

  const doHatch = () => {
    engine.hatch(Date.now());
    setTick((n) => n + 1);
  };

  const pct = (view.fullnessBp / 100).toFixed(0);
  const barColor =
    view.fullnessBp >= 7000
      ? "#39d353"
      : view.fullnessBp >= 3000
      ? "#e3b341"
      : view.fullnessBp > 0
      ? "#f85149"
      : "#b62324";

  const leaderboard = engine.leaderboard();

  return (
    <div className={`app mood-bg-${view.mood}`}>
      {view.mood === "rampage" && <RampageOverlay view={view} onRescue={() => doFeed(view.fillAmount)} onPoke={doPoke} />}

      <header className="topbar">
        <div className="brand">🗿 TOTEM</div>
        <div className="tagline">feed it, or it eats your treasury</div>
        <div className="demo-pill">demo clock · 1 day = 2 min</div>
      </header>

      <main className="stage">
        <section className="creature-stage">
          <div className="name-row">
            <h1>{view.name}</h1>
            <span className="gen">gen {view.generation}</span>
            <span className={`mood-chip mood-${view.mood}`}>{moodEmoji(view.mood)} {view.mood}</span>
          </div>

          <div className={`creature-holder ${chomp ? "chomp" : ""}`}>
            <Creature mood={view.mood} form={view.form} />
            <div className="floats">
              {floats.map((f) => (
                <span key={f.id} className={`float ${f.cls}`}>
                  {f.text}
                </span>
              ))}
            </div>
          </div>

          {/* Hunger bar */}
          <div className="hunger">
            <div className="hunger-bar">
              <div
                className={`hunger-fill ${view.fullnessBp < 3000 ? "pulse" : ""}`}
                style={{ width: `${pct}%`, background: barColor }}
              />
              <span className="hunger-label">{pct}% full</span>
            </div>
            <div className="countdowns">
              {view.alive ? (
                view.mood === "rampage" ? (
                  <span className="danger">💀 dies in {fmtTime(view.secondsUntilDeath)}</span>
                ) : (
                  <>
                    <span>😰 starving in {fmtTime(view.secondsUntilStarving)}</span>
                    <span className="danger">🔥 rampage in {fmtTime(view.secondsUntilRampage)}</span>
                  </>
                )
              ) : (
                <span className="danger">💀 dead — the DAO may hatch a new egg</span>
              )}
            </div>
          </div>

          {/* Feed controls */}
          {view.alive ? (
            <div className="feed-controls">
              <button className="feed-btn" onClick={() => doFeed(10)}>Feed 10 🍖</button>
              <button className="feed-btn" onClick={() => doFeed(50)}>Feed 50 🍖</button>
              <button className="feed-btn fill" onClick={() => doFeed(view.fillAmount)}>
                Fill up ({fmt(view.fillAmount)}) 🍖
              </button>
              {view.mood === "rampage" && (
                <button className="poke-btn" onClick={doPoke}>⚡ Poke (earn tip)</button>
              )}
            </div>
          ) : (
            <div className="feed-controls">
              <button className="feed-btn fill" onClick={doHatch}>🥚 Hatch a new egg</button>
            </div>
          )}
        </section>

        {/* Side panels */}
        <aside className="panels">
          <div className="panel level-panel">
            <div className="panel-title">Level {view.level} · {view.form}</div>
            <div className="xp-row">
              <span>XP {view.xpHappyDays} Happy-days</span>
              {view.nextLevelHappyDays && <span>next: {view.nextLevelHappyDays}</span>}
            </div>
            <div className="xp-bar">
              <div
                className="xp-fill"
                style={{
                  width: view.nextLevelHappyDays
                    ? `${Math.min(100, (view.xpHappyDays / view.nextLevelHappyDays) * 100)}%`
                    : "100%",
                }}
              />
            </div>
          </div>

          <div className="panel stats-panel">
            <Stat label="Hoard" value={`${fmt(view.hoard)} $TOTEM`} hint="the treasury the Totem owns" />
            <Stat label="Burned forever" value={`🔥 ${fmt(view.totalBurned)}`} hint="50% of every meal" />
            <Stat label="Total fed" value={fmt(view.totalFed)} />
            <Stat label="Meal size" value={`${fmt(view.mealSize)} to fill`} />
          </div>

          <div className="panel board-panel">
            <div className="panel-title">Caretakers</div>
            {leaderboard.length === 0 ? (
              <div className="empty">No feeders yet — be the first.</div>
            ) : (
              leaderboard.map((r, i) => (
                <div className="board-row" key={r.who}>
                  <span className="rank">#{i + 1}</span>
                  <span className="who">{r.who}</span>
                  <span className="pts">{fmt(r.points)} pts</span>
                </div>
              ))
            )}
          </div>
        </aside>
      </main>

      {/* Activity ticker */}
      <section className="ticker">
        <div className="ticker-title">Activity</div>
        <div className="ticker-feed">
          {engine.events.slice(0, 8).map((e) => (
            <div className={`tick-item kind-${e.kind}`} key={e.id}>
              {e.text}
            </div>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>One creature. One tribe. No admin key.</span>
        <span className="muted">
          Built at NEAR HACKATHON · burn-on-feed · NFT owns the treasury · Sputnik DAO governed
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
        <div className="rampage-sub">{view.name} is eating the Hoard</div>
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
  return (
    { happy: "😊", hungry: "😐", starving: "😰", rampage: "🔥", dead: "💀" }[mood] ?? "·"
  );
}
