// 🔔 Get BaoBao's alerts on Telegram: one button instead of typing /watch.
// The player signs a free message (proves the account is theirs), the server
// hands back a one-time t.me link, and opening it links this account to the bot.
import { useEffect, useState } from "react";
import { freshNonce, useNear } from "./chain/near";
import { friendly } from "./errors";

const RECIPIENT = "totem-telegram";

export function AlertsPanel({ onClose, onConnect }: { onClose: () => void; onConnect: () => void }) {
  const near = useNear();
  const who = near.accountId;
  const [bot, setBot] = useState<string | null | undefined>(undefined);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/link")
      .then((r) => r.json())
      .then((j) => setBot(j.enabled ? j.bot : null))
      .catch(() => setBot(null));
  }, []);
  useEffect(() => setUrl(""), [who]);

  const link = async () => {
    setErr("");
    setBusy("Sign the message in your wallet…");
    try {
      const nonce = freshNonce();
      const s = await near.signMessage(`Send BaoBao's Telegram alerts about ${who}`, RECIPIENT, nonce.bytes);
      setBusy("Making your link…");
      const r = await fetch("/api/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...s, nonce: nonce.b64 }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Couldn't make a link.");
      setUrl(j.url);
      // a popup after an await can be blocked: the button below always works
      window.open(j.url, "_blank", "noopener");
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="tribe den glass" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="tribe-title">🔔 BaoBao on Telegram</div>
        <div className="tribe-sub">
          BaoBao tells you when it's starving or on a Rampage, when your shield is running out, when a Blessing is waiting for you, and when it
          misses you. Turn it off any time with /unwatch.
        </div>
        {bot === null ? (
          <div className="den-door"><p>Telegram alerts aren't switched on for this server.</p></div>
        ) : !who ? (
          <div className="den-door">
            <p>Connect first, so BaoBao knows which account is yours.</p>
            <button className="press-btn" onClick={onConnect}>Connect wallet</button>
          </div>
        ) : url ? (
          <div className="den-door">
            <p>Your link is ready. Open it and press <b>Start</b> in Telegram. It works once, for 15 minutes.</p>
            <a className="press-btn" href={url} target="_blank" rel="noreferrer">Open Telegram</a>
          </div>
        ) : (
          <div className="den-door">
            <p>Sign a free message to prove this account is yours. Nothing is sent to the chain.</p>
            <button className="press-btn" disabled={!!busy || bot === undefined} onClick={link}>{busy || "🔔 Get alerts on Telegram"}</button>
            {bot && <p className="den-at">Or add <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a> to your group for the tribe-wide alarms.</p>}
          </div>
        )}
        {err && <div className="rs-err">{err}</div>}
      </div>
    </div>
  );
}
