// The Den: a page only badge holders can open. The gate is enforced by the
// server (web/server/den.ts): you sign a message proving you own the account,
// and the server checks on chain that the account holds a TOTEM badge NFT
// (Hero, Founder, Moonlit or a Caretaker badge). Lose the badge, lose the Den.

import { useCallback, useEffect, useState } from "react";
import { useNear } from "./chain/near";
import { friendly } from "./errors";

interface Key {
  id: string;
  title: string;
}
interface Post {
  who: string;
  text: string;
  at: number;
}
interface DenData {
  account: string;
  keys: Key[];
  wall: Post[];
  diary: { text: string; at: number } | null;
}

const RECIPIENT = "totem-den";
const tokenKey = (a: string) => `totem-den:${a}`;
const load = (a: string) => {
  try {
    return localStorage.getItem(tokenKey(a));
  } catch {
    return null;
  }
};
const save = (a: string, t: string | null) => {
  try {
    if (t) localStorage.setItem(tokenKey(a), t);
    else localStorage.removeItem(tokenKey(a));
  } catch {}
};

const icon = (id: string) => (id.startsWith("hero-") ? "🦸" : id.startsWith("founder-") ? "🏛" : id.startsWith("moonlit-") ? "🌕" : "🏅");
const nice = (id: string) => (/^g[0-9a-f]{8}\./.test(id) ? `guest ${id.split(".")[0]}` : id.length > 28 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id);
const ago = (t: number) => {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};

/** Badge NFTs this account holds (public chain data), for the door. */
function useKeys(accountId: string) {
  const near = useNear();
  const [keys, setKeys] = useState<Key[] | null>(null);
  useEffect(() => {
    if (!accountId) return setKeys(null);
    let stop = false;
    near
      .view<{ token_id: string; metadata?: { title?: string } }[]>("nft_tokens_for_owner", { account_id: accountId, limit: 100 })
      .then((ts) => {
        if (stop) return;
        setKeys(
          ts
            .filter((t) => ["hero-", "founder-", "moonlit-", "badge-"].some((p) => t.token_id.startsWith(p)))
            .map((t) => ({ id: t.token_id, title: t.metadata?.title ?? t.token_id }))
        );
      })
      .catch(() => !stop && setKeys([]));
    return () => {
      stop = true;
    };
  }, [accountId, near]);
  return keys;
}

export function DenPanel({ onClose, onConnect, onGuest }: { onClose: () => void; onConnect: () => void; onGuest: () => void }) {
  const near = useNear();
  const who = near.accountId;
  const keys = useKeys(who);
  const [token, setToken] = useState<string | null>(() => (who ? load(who) : null));
  const [data, setData] = useState<DenData | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [text, setText] = useState("");

  useEffect(() => setToken(who ? load(who) : null), [who]);

  const refresh = useCallback(async () => {
    if (!token || !who) return;
    const r = await fetch(`/api/den?token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (r.status === 401) {
      save(who, null);
      setToken(null);
      return;
    }
    if (!r.ok) return setErr(j.error ?? "The Den is closed right now.");
    setErr("");
    setData(j);
  }, [token, who]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [token, refresh]);

  const enter = async () => {
    setErr("");
    setBusy("Sign the message in your wallet…");
    try {
      // the first 8 bytes are the time, so the server can refuse stale signatures
      const nonce = new Uint8Array(32);
      new DataView(nonce.buffer).setBigUint64(0, BigInt(Date.now()));
      crypto.getRandomValues(nonce.subarray(8));
      const s = await near.signMessage(`Enter the TOTEM Den as ${who}`, RECIPIENT, nonce);
      let bin = "";
      nonce.forEach((b) => (bin += String.fromCharCode(b)));
      setBusy("Checking your badges on chain…");
      const r = await fetch("/api/den/enter", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: s.accountId, publicKey: s.publicKey, signature: s.signature, nonce: btoa(bin) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "The Den refused you.");
      save(who, j.token);
      setToken(j.token);
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy("");
    }
  };

  const post = async () => {
    if (!token || !text.trim()) return;
    setBusy("Posting…");
    try {
      const r = await fetch("/api/den/wall", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, text }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setText("");
      setData((d) => (d ? { ...d, wall: j.wall } : d));
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
        <div className="tribe-title">🗝 The Den</div>
        <div className="tribe-sub">
          Only for holders of a TOTEM badge NFT. Your badge is your key: the server checks your signature and your badges on chain
          every time, so if a badge leaves your account, so does your key.
        </div>

        {!who ? (
          <div className="den-door">
            <p>Connect first so we can see your badges.</p>
            <div className="rs-row">
              <button className="press-btn" onClick={onConnect}>Connect wallet</button>
              {near.freePlay && <button className="ghost-btn den-ghost" onClick={onGuest}>⚡ Play free</button>}
            </div>
          </div>
        ) : !data ? (
          <div className="den-door">
            {keys === null ? (
              <p>Looking for your badges…</p>
            ) : keys.length ? (
              <>
                <div className="den-keys">
                  {keys.slice(0, 8).map((k) => (
                    <span key={k.id} className="den-key" title={k.id}>{icon(k.id)} {k.title}</span>
                  ))}
                </div>
                <p>
                  You hold {keys.length} badge{keys.length === 1 ? "" : "s"}. Sign a message to prove {nice(who)} is yours (free, nothing is sent to the
                  chain).
                </p>
                <button className="press-btn" disabled={!!busy} onClick={enter}>{busy || "🗝 Enter the Den"}</button>
              </>
            ) : (
              <>
                <p><b>{nice(who)}</b> holds no badge yet. Earn one:</p>
                <ul className="den-earn">
                  <li>🦸 <b>Hero</b>: feed BaoBao back from a Rampage.</li>
                  <li>🌕 <b>Moonlit</b>: feed it on a night the moon is at least 90% full.</li>
                  <li>🏅 <b>Bronze</b>: reach 100 points (1 point per $TOTEM fed), then mint it in 🛡 Stake.</li>
                  <li>🏛 <b>Founder</b>: be a top-3 feeder of a life; you get it when the next egg hatches.</li>
                </ul>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="den-keys">
              {data.keys.map((k) => (
                <span key={k.id} className="den-key" title={k.id}>{icon(k.id)} {k.title}</span>
              ))}
            </div>
            <div className="tribe-title small">📓 BaoBao's secret diary</div>
            <div className="den-diary">{data.diary?.text ?? "The diary is locked for a moment. Try again soon."}</div>
            <div className="tribe-title small">🪵 The holders' wall</div>
            <div className="den-post">
              <input value={text} maxLength={200} placeholder="Say something only badge holders will see…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && post()} />
              <button className="press-btn" disabled={!!busy || !text.trim()} onClick={post}>Post</button>
            </div>
            <div className="den-wall">
              {data.wall.length === 0 && <div className="tribe-empty">Nobody has written here yet. Be the first.</div>}
              {data.wall.map((p, i) => (
                <div className="den-msg" key={i}>
                  <span className="den-who">{nice(p.who)}</span> {p.text} <span className="den-at">{ago(p.at)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {err && <div className="rs-err">{err}</div>}
      </div>
    </div>
  );
}
