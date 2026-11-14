// 🏆 Badge Leaderboard: wallets ranked by total NFT badge count.
// Data comes from /api/leaderboard which uses nft_supply_for_owner (no SVG
// generation) plus badge_minted history events for Caretaker tier breakdown.
import { useEffect, useState } from "react";

interface LeaderEntry {
  rank: number;
  account: string;
  total: number;
  gold: number;
  silver: number;
  bronze: number;
}

const short = (a: string) => (/^g[0-9a-f]{8}\./.test(a) ? `guest ${a.split(".")[0]}` : a.length > 28 ? `${a.slice(0, 12)}…${a.slice(-6)}` : a);
const medal = (rank: number) => ["🥇", "🥈", "🥉"][rank - 1] ?? `#${rank}`;

export function LeaderboardPanel({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let stop = false;
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((j) => {
        if (stop) return;
        if (j.error) setErr(j.error);
        else setEntries(j.entries ?? []);
      })
      .catch(() => !stop && setErr("Could not load leaderboard right now."));
    return () => { stop = true; };
  }, []);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="tribe den glass lb-panel" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="tribe-title">🏆 Badge Leaderboard</div>
        <div className="tribe-sub">
          Wallets ranked by how many soulbound TOTEM badge NFTs they hold. Badges are earned, never bought.
        </div>

        {err ? (
          <div className="rs-err">{err}</div>
        ) : entries === null ? (
          <div className="tribe-empty">Loading rankings…</div>
        ) : entries.length === 0 ? (
          <div className="tribe-empty">No badge holders found yet. Be the first to earn one!</div>
        ) : (
          <div className="lb-list">
            {entries.map((e) => (
              <div key={e.account} className={`lb-row${e.account === accountId ? " lb-me" : ""}${e.rank <= 3 ? ` lb-top${e.rank}` : ""}`}>
                <span className="lb-rank">{medal(e.rank)}</span>
                <span className="lb-who" title={e.account}>{short(e.account)}{e.account === accountId && <span className="lb-you"> you</span>}</span>
                <span className="lb-total">{e.total} badge{e.total !== 1 ? "s" : ""}</span>
                {(e.gold > 0 || e.silver > 0 || e.bronze > 0) && (
                  <span className="lb-tiers">
                    {e.gold > 0 && <span>🥇×{e.gold}</span>}
                    {e.silver > 0 && <span>🥈×{e.silver}</span>}
                    {e.bronze > 0 && <span>🥉×{e.bronze}</span>}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="tribe-foot">Updated every 30 s · badge count from chain · Caretaker tiers from event history</div>
      </div>
    </div>
  );
}
