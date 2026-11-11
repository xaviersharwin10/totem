// Move a free guest account between browsers: show its backup code, or paste one.

import { useState } from "react";
import { useNear } from "./chain/near";
import { guestBackupCode, shortGuest } from "./chain/guest";

export function GuestKeySheet({ mode, onClose, onDone }: { mode: "backup" | "restore"; onClose: () => void; onDone: (msg: string) => void }) {
  const near = useNear();
  const [code, setCode] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const mine = near.guest ? guestBackupCode(near.guest) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mine);
      onDone("Backup code copied. Keep it somewhere private.");
    } catch {
      setShown(true);
    }
  };
  const restore = async () => {
    setBusy(true);
    setErr("");
    try {
      const id = await near.restoreGuestCode(code);
      onDone(`Welcome back, ${shortGuest(id)} 🐼`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sos-sheet glass" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        {mode === "backup" ? (
          <>
            <div className="sos-title">🔑 Back up your guest</div>
            <p className="gk-p">
              Your free account <b>{near.guest ? shortGuest(near.guest.accountId) : ""}</b> lives in this browser only. Save this code to
              keep your $TOTEM, stake, badges and Keeper seat if you clear the browser or switch devices.
            </p>
            <p className="gk-warn">Anyone with this code controls the account. Never post it.</p>
            {shown ? <textarea className="gk-code" readOnly value={mine} onFocus={(e) => e.currentTarget.select()} /> : null}
            <div className="sos-btns">
              <button className="press-btn" onClick={copy}>Copy code</button>
              {!shown && <button className="ghost-btn" onClick={() => setShown(true)}>Show code</button>}
            </div>
          </>
        ) : (
          <>
            <div className="sos-title">🔑 Restore a guest</div>
            <p className="gk-p">Paste the backup code from your other browser. We check on-chain that it opens that account.</p>
            <textarea className="gk-code" placeholder="totem-guest:…" value={code} onChange={(e) => setCode(e.target.value)} />
            {err && <p className="gk-warn">{err}</p>}
            <div className="sos-btns">
              <button className="press-btn" disabled={busy || !code.trim()} onClick={restore}>{busy ? "Checking…" : "Restore"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
