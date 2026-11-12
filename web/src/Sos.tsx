// SOS: when the Totem starves, anyone can call for help with a share card and a
// link. The link opens a one-tap Rescue card; with no wallet, the rescuer gets a
// free guest account and the game pays the gas (web/src/chain/guest.ts).

import { friendly } from "./errors";
import { useEffect, useMemo, useState } from "react";
import { fmt, fmtTime, TotemView } from "./engine";
import type { Game } from "./game";
import { shortGuest } from "./chain/guest";

export const rescueUrl = () => `${location.origin}${location.pathname}?rescue=1`;

export function sosText(v: TotemView): string {
  const url = rescueUrl();
  if (!v.alive) return `🪦 ${v.name} starved on NEAR. The tribe can vote to hatch the next egg. Come see the farm 👉 ${url}`;
  const atRisk = fmt(v.hoard * 0.15);
  if (v.mood === "rampage")
    return `🆘 ${v.name} is STARVING on NEAR! ${v.bitesUntilDeath} bite${v.bitesUntilDeath === 1 ? "" : "s"} from death, and the next bite burns ${atRisk} $TOTEM from its Treasury. Rescue it in one tap, no wallet needed 👉 ${url}`;
  if (v.fullnessBp < 7000)
    return `🥺 ${v.name} is getting hungry (belly ${Math.round(v.fullnessBp / 100)}%). It starts biting in ${fmtTime(v.secondsUntilRampage)}. Feed it in one tap, free 👉 ${url}`;
  return `🐼 Meet ${v.name}, our tribe's Totem on NEAR: Level ${v.level}, ${fmt(v.hoard)} $TOTEM in its Treasury. Feed it, free 👉 ${url}`;
}

/** 1200×630 share image: a snapshot of the 3D farm with the SOS banner. */
function drawCard(v: TotemView): string | null {
  const src = document.querySelector(".world canvas") as HTMLCanvasElement | null;
  const c = document.createElement("canvas");
  c.width = 1200;
  c.height = 630;
  const g = c.getContext("2d");
  if (!g) return null;
  const danger = v.alive && v.mood === "rampage";
  const bg = g.createLinearGradient(0, 0, 0, 630);
  bg.addColorStop(0, danger ? "#ff9a8a" : "#a8dcff");
  bg.addColorStop(1, danger ? "#7a1f2b" : "#7fcf5a");
  g.fillStyle = bg;
  g.fillRect(0, 0, 1200, 630);
  if (src && src.width > 0) {
    // cover-crop the farm into the card
    const r = Math.max(1200 / src.width, 630 / src.height);
    const w = src.width * r;
    const h = src.height * r;
    try {
      g.drawImage(src, (1200 - w) / 2, (630 - h) / 2 - 40, w, h);
    } catch {
      /* tainted or lost context: keep the gradient */
    }
  }
  const shade = g.createLinearGradient(0, 330, 0, 630);
  shade.addColorStop(0, "rgba(20,10,20,0)");
  shade.addColorStop(1, "rgba(20,10,20,0.82)");
  g.fillStyle = shade;
  g.fillRect(0, 300, 1200, 330);

  const title = !v.alive ? `🪦 ${v.name} starved` : danger ? `🆘 ${v.name} is starving!` : v.fullnessBp < 7000 ? `🥺 ${v.name} is hungry` : `🐼 ${v.name}`;
  const sub = !v.alive
    ? `Reached Level ${v.maxLevel}. The tribe can hatch the next egg.`
    : danger
      ? `${v.bitesUntilDeath} bite${v.bitesUntilDeath === 1 ? "" : "s"} from death · next bite burns ${fmt(v.hoard * 0.15)} $TOTEM`
      : `Level ${v.level} · belly ${Math.round(v.fullnessBp / 100)}% · Treasury ${fmt(v.hoard)} $TOTEM`;
  g.fillStyle = "#fff";
  g.font = "700 64px Fredoka, Nunito, sans-serif";
  g.fillText(title, 56, 500);
  g.font = "700 30px Nunito, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fillText(sub, 58, 548);
  g.font = "800 24px Nunito, sans-serif";
  g.fillStyle = danger ? "#ffd54a" : "#d6ffcf";
  g.fillText("One tap to rescue · no wallet needed · TOTEM on NEAR", 58, 592);
  if (danger) {
    g.fillStyle = "#ff3b4e";
    roundRect(g, 56, 40, 210, 56, 28);
    g.fill();
    g.fillStyle = "#fff";
    g.font = "800 28px Nunito, sans-serif";
    g.fillText("🔥 RAMPAGE", 80, 78);
  }
  return c.toDataURL("image/png");
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function dataUrlToFile(url: string, name: string): Promise<File> {
  const b = await (await fetch(url)).blob();
  return new File([b], name, { type: "image/png" });
}

// ---------------- share sheet ----------------
export function SosSheet({ view, onClose, toast }: { view: TotemView; onClose: () => void; toast: (t: string) => void }) {
  const text = useMemo(() => sosText(view), [view.name, view.mood, view.alive, view.bitesUntilDeath, Math.round(view.hoard)]);
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    setImg(drawCard(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const url = rescueUrl();
  const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text.replace(` 👉 ${url}`, ""))}`;
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  const nativeShare = async () => {
    try {
      const files = img ? [await dataUrlToFile(img, "totem-sos.png")] : [];
      const data: ShareData = { text, url };
      if (files.length && navigator.canShare?.({ files })) data.files = files;
      await navigator.share(data);
    } catch {
      /* cancelled */
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast("📋 SOS copied. Paste it anywhere!");
    } catch {
      toast(url);
    }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sos-sheet glass" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="sos-title">{view.mood === "rampage" ? "🆘 Call for help" : "📣 Share the Totem"}</div>
        {img && <img className="sos-img" src={img} alt="SOS card" />}
        <div className="sos-text">{text}</div>
        <div className="sos-btns">
          {canShare && <button className="press-btn" onClick={nativeShare}>Share…</button>}
          <a className="press-btn x-btn" href={xUrl} target="_blank" rel="noreferrer">Post on X</a>
          <a className="press-btn tg-btn" href={tgUrl} target="_blank" rel="noreferrer">Telegram</a>
          <button className="ghost-btn" onClick={copy}>Copy text</button>
          {img && <a className="ghost-btn" href={img} download="totem-sos.png">Save image</a>}
        </div>
        <div className="sos-foot">You choose where it goes; nothing is posted for you. Whoever opens the link can rescue in one tap, without a wallet: the game pays their gas.</div>
      </div>
    </div>
  );
}

// ---------------- rescue landing (?rescue) ----------------
type Phase = "ready" | "working" | "done" | "error";

export function RescueCard({
  game,
  onDone,
  onClose,
  toast,
}: {
  game: Game;
  onDone: (heroic: boolean) => void;
  onClose: () => void;
  toast: (t: string) => void;
}) {
  const v = game.view;
  const [phase, setPhase] = useState<Phase>("ready");
  const [err, setErr] = useState("");
  const [heroic, setHeroic] = useState(false);
  const [step, setStep] = useState("");

  if (!v) return <div className="rescue-card glass"><div className="rs-big">Finding the Totem on NEAR…</div></div>;

  const danger = v.alive && v.mood === "rampage";
  const hungry = v.alive && v.fullnessBp < 7000;
  const who = game.accountId ? (game.isGuest ? shortGuest(game.accountId) : game.accountId) : null;

  const go = async () => {
    setPhase("working");
    setErr("");
    try {
      setStep(game.accountId ? "Feeding…" : "Making you a free account…");
      const t = setTimeout(() => setStep("Feeding… (the game is paying your gas)"), 2500);
      const r = await game.rescue();
      clearTimeout(t);
      setHeroic(r.rescue);
      setPhase("done");
      onDone(r.rescue);
    } catch (e) {
      setErr(friendly(e));
      setPhase("error");
    }
  };

  if (phase === "done") {
    const brag = `🦸 I just ${heroic ? "saved" : "fed"} ${v.name} on NEAR${heroic ? " from starving" : ""}! Your turn 👉 ${rescueUrl()}`;
    return (
      <div className="rescue-card glass">
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="rs-emoji">🦸</div>
        <div className="rs-big">{heroic ? `You saved ${v.name}!` : `You fed ${v.name}!`}</div>
        <div className="rs-sub">
          {heroic
            ? <>The Rampage is over. A soulbound <b>Hero</b> badge NFT was minted to <b>{who}</b>.</>
            : <>Its belly is full. Half of your meal burned forever, half went to its Treasury.</>}
          {game.isGuest && <><br />You paid no gas: the game relayed it for you.</>}
        </div>
        <div className="rs-row">
          <a className="press-btn x-btn" href={`https://x.com/intent/post?text=${encodeURIComponent(brag)}`} target="_blank" rel="noreferrer">Brag on X</a>
          <button className="ghost-btn" onClick={onClose}>Visit the farm</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rescue-card glass ${danger ? "danger" : ""}`}>
      <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
      {!v.alive ? (
        <>
          <div className="rs-emoji">🪦</div>
          <div className="rs-big">Too late… {v.name} starved</div>
          <div className="rs-sub">It reached Level {v.maxLevel}. Only the tribe's DAO can vote to hatch the next egg.</div>
          <div className="rs-row"><button className="press-btn" onClick={onClose}>Visit the farm</button></div>
        </>
      ) : (
        <>
          <div className="rs-emoji">{danger ? "🆘" : hungry ? "🥺" : "😊"}</div>
          <div className="rs-big">{danger ? `${v.name} needs you!` : hungry ? `${v.name} is hungry` : `${v.name} is safe`}</div>
          <div className="rs-stats">
            {danger ? (
              <>
                <div><b>{v.bitesUntilDeath}</b><span>bite{v.bitesUntilDeath === 1 ? "" : "s"} from death</span></div>
                <div><b>{fmtTime(v.secondsUntilNextBite)}</b><span>to the next bite</span></div>
                <div><b>{fmt(v.hoard * 0.15)}</b><span>$TOTEM burns per bite</span></div>
              </>
            ) : (
              <>
                <div><b>{Math.round(v.fullnessBp / 100)}%</b><span>belly</span></div>
                <div><b>{v.level}</b><span>level</span></div>
                <div><b>{fmt(v.hoard)}</b><span>$TOTEM Treasury</span></div>
              </>
            )}
          </div>
          {!hungry && <div className="rs-sub">Someone got here first. You can still top it up.</div>}
          <button className={`press-btn rs-go ${danger ? "danger-btn" : ""}`} onClick={go} disabled={phase === "working" || game.busy}>
            {phase === "working" ? step : danger ? `🎋 Rescue ${v.name}` : `🎋 Feed ${v.name}`}
          </button>
          <div className="rs-note">
            {who ? <>as <b>{who}</b>{game.isGuest ? " · gas paid by the game" : ""}</> : <>Free · no wallet · the game pays the gas</>}
          </div>
          {phase === "error" && <div className="rs-err">{err}</div>}
          {!who && game.mode === "live" && (
            <button className="link-btn" onClick={() => game.connect().catch(() => toast("Wallet not connected"))}>I have a NEAR wallet</button>
          )}
        </>
      )}
    </div>
  );
}
