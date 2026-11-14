// 🏅 NFTs: the living Totem NFT (its art is drawn on chain and changes as
// it lives) and every NFT the player owns: soulbound badges and anything else
// from this contract. All read straight from the contract's NEP-171 views;
// the images are the contract's own SVGs (`metadata.media`).
import { useEffect, useState } from "react";
import { useNear } from "./chain/near";
import { CONTRACT_ID, EXPLORER } from "./chain/config";

interface Nft {
  token_id: string;
  owner_id: string;
  metadata?: { title?: string | null; description?: string | null; media?: string | null };
}

const HOW: [string, string, string][] = [
  ["🦸", "Hero", "Feed BaoBao while it's on a Rampage and end it."],
  ["🥚", "Founder", "Be one of the top 3 feeders of a life: you get it when the next egg hatches."],
  ["🤗", "Welcome Back", "Come back and feed after 3+ days away."],
  ["🌕", "Moonlit", "Feed when the real moon is 90%+ lit (once a lunar month)."],
  ["🥉", "Caretaker", "Earn 100 / 1,000 / 10,000 points, then claim Bronze / Silver / Gold in 🎋 the stake panel."],
];

const tokenUrl = (id: string) => `${EXPLORER}/nft-token/${CONTRACT_ID}/${encodeURIComponent(id)}`;

function groupNfts(nfts: Nft[]): (Nft & { count: number })[] {
  const map = new Map<string, Nft & { count: number }>();
  for (const n of nfts) {
    const key = n.metadata?.title ?? n.token_id;
    const e = map.get(key);
    if (e) e.count++;
    else map.set(key, { ...n, count: 1 });
  }
  return Array.from(map.values());
}

export function CollectionPanel({ accountId, isGuest, onClose, onConnect }: { accountId: string | null; isGuest: boolean; onClose: () => void; onConnect: () => void }) {
  const near = useNear();
  const [totem, setTotem] = useState<Nft | null>(null);
  const [mine, setMine] = useState<Nft[] | null>(null);
  const [open, setOpen] = useState<Nft | null>(null);

  useEffect(() => {
    let stop = false;
    near
      .view<{ totem_id: string }>("get_totem", {})
      .then((t) => near.view<Nft | null>("nft_token", { token_id: t.totem_id }))
      .then((n) => !stop && setTotem(n))
      .catch(() => undefined);
    if (accountId)
      near
        .view<Nft[]>("nft_tokens_for_owner", { account_id: accountId, limit: 100 })
        .then((ts) => !stop && setMine(ts))
        .catch(() => !stop && setMine([]));
    else setMine(null);
    return () => {
      stop = true;
    };
  }, [accountId, near]);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="tribe den glass nfts" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="tribe-title">🏅 NFTs</div>
        <div className="tribe-sub">
          Every picture here is drawn by the contract itself, on chain: no server, no IPFS. They're standard NEP-171 NFTs, so your
          NEAR wallet's NFT tab shows them too.
        </div>

        {totem && (
          <button className="nft-live" onClick={() => setOpen(totem)}>
            {totem.metadata?.media && <img src={totem.metadata.media} alt={totem.metadata?.title ?? ""} />}
            <div>
              <b>{totem.metadata?.title}</b>
              <span>
                {totem.metadata?.title?.startsWith("🪦")
                  ? "It died, so its NFT is now a gravestone that keeps its life story. The next egg mints a new living Totem NFT."
                  : "The living Totem NFT, owned by the tribe's DAO. Its picture changes as it lives: mood, level, belly, Reserve and tonight's moon."}
              </span>
            </div>
          </button>
        )}

        <div className="tribe-title small">Yours</div>
        {!accountId ? (
          <div className="den-door">
            <p>Connect to see the NFTs you own.</p>
            <button className="press-btn" onClick={onConnect}>🔗 Connect NEAR wallet</button>
          </div>
        ) : mine === null ? (
          <p className="tribe-empty">Reading your NFTs on chain…</p>
        ) : mine.length === 0 ? (
          <p className="tribe-empty">No NFTs yet. Here's how to earn your first:</p>
        ) : (
          <div className="nft-grid">
            {groupNfts(mine).map((n) => (
              <button key={n.token_id} className="nft-card" onClick={() => setOpen(n)} title={n.metadata?.title ?? n.token_id}>
                {n.metadata?.media ? <img src={n.metadata.media} alt="" /> : <div className="nft-blank">🏅</div>}
                <span>{n.metadata?.title ?? n.token_id}</span>
                {n.count > 1 && <span className="nft-count">×{n.count}</span>}
              </button>
            ))}
          </div>
        )}
        {accountId && isGuest && mine && mine.length > 0 && (
          <p className="tribe-foot">These belong to your guest account. Back it up (🔑 under your balance) to keep them on another device.</p>
        )}

        <ul className="nft-how">
          {HOW.map(([i, name, how]) => (
            <li key={name}>
              <b>{i} {name}</b> {how}
            </li>
          ))}
        </ul>
        <div className="tribe-foot">Badges are soulbound: they can't be sold or moved, they are your reputation, and they open 🗝 the Den.</div>

        {open && (
          <div className="nft-zoom" onClick={() => setOpen(null)}>
            <div className="nft-zoom-card" onClick={(e) => e.stopPropagation()}>
              <button className="dc-close" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
              {open.metadata?.media && <img src={open.metadata.media} alt="" />}
              <b>{open.metadata?.title}</b>
              <p>{open.metadata?.description}</p>
              <code>{open.token_id}</code>
              <a href={tokenUrl(open.token_id)} target="_blank" rel="noreferrer">See it on the explorer ↗</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
