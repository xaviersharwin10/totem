// 🚀 "BaoBao is coming to mainnet": a one-time popup with a single
// "Join the waitlist" button. The list (and its count) stay on the server
// (/api/waitlist); visitors never see a number.
import { useEffect, useState } from "react";
import { useNear } from "./chain/near";

const SEEN = "totem-mainnet-seen";
const JOINED = "totem-mainnet-joined";
const ID = "totem-visitor-id";
const DELAY_MS = 45_000; // let them meet BaoBao first

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

function visitorId(): string {
  let id = store.get(ID);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    store.set(ID, id);
  }
  return id;
}

/** Shows itself once per visitor, DELAY_MS after the farm opens. */
export function MainnetPopup({ ready }: { ready: boolean }) {
  const near = useNear();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(store.get(JOINED) ? "done" : "idle");

  useEffect(() => {
    if (!ready || store.get(SEEN)) return;
    const t = setTimeout(() => {
      setOpen(true);
      store.set(SEEN, "1");
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [ready]);

  if (!open) return null;
  const close = () => setOpen(false);

  const join = async () => {
    setState("busy");
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: visitorId(), account: near.accountId ?? undefined }),
      });
      if (!r.ok) throw new Error();
      store.set(JOINED, "1");
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="sheet-bg" onClick={close}>
      <div className="tribe den glass mainnet-pop" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={close}>✕</button>
        <div className="tribe-title">🚀 BaoBao is coming to mainnet</div>
        <div className="tribe-sub">
          This is the testnet demo: free test $TOTEM and a fast clock. The real BaoBao, with real $TOTEM, hatches on NEAR mainnet later.
        </div>
        <div className="den-door">
          {state === "done" ? (
            <p>
              ✅ You're on the waitlist. Follow{" "}
              <a href="https://x.com/babaoOnNear" target="_blank" rel="noreferrer">@babaoOnNear</a> to be there when it hatches.
            </p>
          ) : (
            <>
              <button className="press-btn" disabled={state === "busy"} onClick={join}>
                {state === "busy" ? "Joining…" : "🚀 Join the waitlist"}
              </button>
              {state === "error" && <p className="rs-err">Couldn't join right now. Try again in a moment.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
