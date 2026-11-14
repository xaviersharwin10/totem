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
interface BadgeGroup {
  prefix: string;
  icon: string;
  label: string;
  nfts: Nft[];
}

const HOW: [string, string, string][] = [
  ["🦸", "Hero", "Feed BaoBao while it's on a Rampage and end it."],
  ["🥚", "Founder", "Be one of the top 3 feeders of a life: you get it when the next egg hatches."],
  ["🤗", "Welcome Back", "Come back and feed after 3+ days away."],
  ["🌕", "Moonlit", "Feed when the real moon is 90%+ lit (once a lunar month)."],
  ["🥉", "Caretaker", "Earn 100 / 1,000 / 10,000 points, then claim Bronze / Silver / Gold in 🎋 the stake panel."],
];

const PREFIX_INFO: [string, string, string][] = [
  ["hero-",         "🦸", "Hero of the Rampage"],
  ["founder-",      "🏛", "Founder"],
  ["moonlit-",      "🌕", "Moonlit"],
  ["returned-",     "🤗", "Welcome Back"],
  ["badge-gold-",   "🥇", "Gold Caretaker"],
  ["badge-silver-", "🥈", "Silver Caretaker"],
  ["badge-bronze-", "🥉", "Bronze Caretaker"],
];

const badgeInfo = (id: string) =>
  PREFIX_INFO.find(([p]) => id.startsWith(p))?.slice(1) as [string, string] | undefined
    ?? ["🏅", id];

function groupByType(nfts: Nft[]): BadgeGroup[] {
  const map = new Map<string, BadgeGroup>();
  for (const n of nfts) {
    const entry = PREFIX_INFO.find(([p]) => n.token_id.startsWith(p));
    const prefix = entry?.[0] ?? "other-";
    const [icon, label] = entry ? [entry[1], entry[2]] : badgeInfo(n.token_id);
    const g = map.get(prefix);
    if (g) g.nfts.push(n);
    else map.set(prefix, { prefix, icon, label, nfts: [n] });
  }
  return Array.from(map.values());
}

const tokenUrl = (id: string) => `${EXPLORER}/nft-token/${CONTRACT_ID}/${id}`;

// Shorten a token's display title: strip the type prefix to show just the gen/variant
const shortTitle = (n: Nft) => {
  const t = n.metadata?.title ?? n.token_id;
  // "Founder of BaoBao XIX" → "XIX", "Hero of the Rampage" → skip (all same)
  const m = t.match(/\b([IVXLCDM]{2,})\s*$/);
  return m ? m[1] : t;
};

export function CollectionPanel({ accountId, isGuest, onClose, onConnect }: { accountId: string | null; isGuest: boolean; onClose: () => void; onConnect: () => void }) {
  const near = useNear();
  const [totem, setTotem] = useState<Nft | null>(null);
  const [mine, setMine] = useState<Nft[] | null>(null);
  const [open, setOpen] = useState<BadgeGroup | null>(null);

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
    return () => { stop = true; };
  }, [accountId, near]);

  const groups = mine ? groupByType(mine) : [];

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
          <button className="nft-live" onClick={() => setOpen({ prefix: "totem-", icon: "🐼", label: totem.metadata?.title ?? "Totem", nfts: [totem] })}>
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
            {groups.map((g) => (
              <button key={g.prefix} className="nft-card" onClick={() => setOpen(g)}>
                {g.nfts[0].metadata?.media
                  ? <img src={g.nfts[0].metadata.media} alt="" />
                  : <div className="nft-blank">{g.icon}</div>}
                <span>{g.icon} {g.label}</span>
                {g.nfts.length > 1 && <span className="nft-count">×{g.nfts.length}</span>}
                {g.prefix === "founder-" && g.nfts.length > 1 && (
                  <div className="nft-gens">
                    {g.nfts.slice(0, 5).map((n) => (
                      <span key={n.token_id}>{shortTitle(n)}</span>
                    ))}
                    {g.nfts.length > 5 && <span>+{g.nfts.length - 5}</span>}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        {accountId && isGuest && mine && mine.length > 0 && (
          <p className="tribe-foot">These belong to your guest account. Back it up (🔑 under your balance) to keep them on another device.</p>
        )}

        <ul className="nft-how">
          {HOW.map(([i, name, how]) => (
            <li key={name}><b>{i} {name}</b> {how}</li>
          ))}
        </ul>
        <div className="tribe-foot">Badges are soulbound: they can't be sold or moved, they are your reputation, and they open 🗝 the Den.</div>

        {open && (
          <div className="nft-zoom" onClick={() => setOpen(null)}>
            <div className="nft-zoom-card" onClick={(e) => e.stopPropagation()}>
              <button className="dc-close" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
              {open.nfts[0].metadata?.media && <img src={open.nfts[0].metadata.media} alt="" />}
              <b>{open.icon} {open.label}{open.nfts.length > 1 ? ` ×${open.nfts.length}` : ""}</b>
              <p>{open.nfts[0].metadata?.description}</p>
              <div className="nft-zoom-links">
                {open.nfts.map((n) => (
                  <a key={n.token_id} href={tokenUrl(n.token_id)} target="_blank" rel="noreferrer" className="nft-zoom-link">
                    {shortTitle(n)} ↗
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
