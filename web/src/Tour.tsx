// "How to play": four short cards for a first visit (and the ❔ button any time
// after). Explains the one thing nobody finds by themselves: BaoBao follows
// the real moon, and full-moon nights are the big ones.
import { useState } from "react";
import { moonEmoji, moonLit, moonPhaseName, moonWaxing, nextFullMoon, MOONLIT_MIN } from "./moon";

export const TOUR_DONE = "totem-tour-done";

export const tourSeen = () => {
  try {
    return !!localStorage.getItem(TOUR_DONE);
  } catch {
    return true; // no storage: don't nag on every load
  }
};

function tonight(now: number): string {
  const lit = moonLit(now);
  const icon = moonEmoji(lit, moonWaxing(now));
  const pct = Math.round(lit * 100);
  if (lit >= MOONLIT_MIN) return `${icon} Tonight: ${moonPhaseName(now)}, ${pct}% lit. It's a Moonlit night: feed now!`;
  const days = Math.max(1, Math.round((nextFullMoon(now) - now) / 86_400_000));
  return `${icon} Tonight: ${moonPhaseName(now)}, ${pct}% lit. Next full moon in ${days} day${days === 1 ? "" : "s"}.`;
}

export function Tour({ name, alive, onClose, onPlay }: { name: string; alive: boolean; onClose: () => void; onPlay: () => void }) {
  const [i, setI] = useState(0);
  const first = name.split(" ")[0] || "BaoBao";
  const done = () => {
    try {
      localStorage.setItem(TOUR_DONE, "1");
    } catch {}
  };
  const close = () => (done(), onClose());

  const steps: { icon: string; title: string; body: JSX.Element }[] = [
    {
      icon: "🐼",
      title: `Meet ${first}`,
      body: (
        <>
          <p>One panda the whole internet shares, living on NEAR. Its belly empties on a clock.</p>
          <p>
            If the belly hits zero it goes on a <b>🔥 Rampage</b>: it bites its own treasury and loses a level with every bite. At Level 0
            it dies.
          </p>
          <p>
            <b>🔗 Connect your NEAR wallet</b> (top right), take free test $TOTEM from the 🚰 faucet, then pick 🎋 and tap the grass to
            feed it. No wallet yet? Tap <b>⚡ Play free as a guest</b> and you can still play.
          </p>
        </>
      ),
    },
    {
      icon: "🔥",
      title: "Every meal burns $TOTEM",
      body: (
        <>
          <p>Half of every meal is burned forever; the rest goes into the panda's own treasury. What you get back:</p>
          <ul>
            <li><b>Points</b> for every token you feed (×2 when you rescue it while it's starving).</li>
            <li><b>Blessings</b>: from Level 3, the treasury pays out to its feeders, split by points.</li>
            <li><b>Badges</b>: 🦸 Hero for a rescue, Bronze, Silver and Gold caretakers, 🤗 Welcome Back.</li>
            <li><b>Poke tips</b> and <b>🔮 bets</b> during a Rampage.</li>
          </ul>
        </>
      ),
    },
    {
      icon: "🌕",
      title: `${first} follows the real moon`,
      body: (
        <>
          <p>The contract works out the moon in the sky from the block time. No oracle, check it against your window.</p>
          <ul>
            <li>The fuller the moon, the <b>hungrier</b> it gets (up to ×1.5 at full moon).</li>
            <li>…and every meal <b>burns more</b> (70% instead of 50%).</li>
            <li>Feed it when the moon is 90%+ full to earn the soulbound <b>🌕 Moonlit badge</b>, once a lunar month.</li>
          </ul>
          <p className="tour-moon">{tonight(Date.now())}</p>
          <p>Full-moon nights are rally nights. The 🌔 chip by its name always shows tonight's moon.</p>
        </>
      ),
    },
    {
      icon: "🏛",
      title: "The tribe decides",
      body: (
        <>
          <ul>
            <li><b>🏛 Keepers</b> vote in a DAO to hatch the next egg, name it and evolve it.</li>
            <li><b>🔮 Bet</b> on whether it survives a Rampage.</li>
            <li><b>🔔 Alerts</b> on Telegram, so you know when it's starving.</li>
            <li><b>💬 Talk</b> to it: it knows who fed it.</li>
          </ul>
          <p>{alive ? "Ready? It's probably hungry." : `${first} has died. The next egg hatches soon: be its first feeder.`}</p>
        </>
      ),
    },
  ];
  const s = steps[i];
  const last = i === steps.length - 1;

  return (
    <div className="sheet-bg" onClick={close}>
      <div className="tribe den glass tour" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={close}>✕</button>
        <div className="tour-step">How to play · {i + 1}/{steps.length}</div>
        <div className="tribe-title">{s.icon} {s.title}</div>
        <div className="tour-body">{s.body}</div>
        <div className="tour-dots">
          {steps.map((_, k) => (
            <button key={k} className={k === i ? "on" : ""} aria-label={`Step ${k + 1}`} onClick={() => setI(k)} />
          ))}
        </div>
        <div className="tour-nav">
          {i > 0 ? <button className="ghost-btn" onClick={() => setI(i - 1)}>Back</button> : <button className="ghost-btn" onClick={close}>Skip</button>}
          {last ? (
            <button className="press-btn" onClick={() => (done(), onPlay())}>{alive ? `🎋 Feed ${first}` : "🐼 Let's go"}</button>
          ) : (
            <button className="press-btn" onClick={() => setI(i + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
