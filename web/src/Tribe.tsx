// The tribe decides: open votes with live tallies, the Keepers, and your path to
// becoming one. Everything is the tribe's Sputnik DAO on-chain (chain/dao.ts).

import { useEffect, useState } from "react";
import { Proposal, Tribe } from "./chain/dao";
import { DAO_ID, EXPLORER, toTokens } from "./chain/config";
import { shortGuest } from "./chain/guest";
import { rescueUrl } from "./Sos";
import { fmt } from "./engine";
import type { HistoryEvent } from "./History";

const nice = (a: string) => shortGuest(a.length > 30 && /^[0-9a-f]{40,}|^0x/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const tokens = (y: string) => Math.floor(Number(BigInt(y || "0") / 10n ** 18n)).toLocaleString("en-US");
const near = (y: string) => (Number(BigInt(y || "0") / 10n ** 21n) / 1000).toString();

function title(p: Proposal, nextName: string): string {
  switch (p.type) {
    case "hatch":
      return `🥚 Hatch ${nextName}`;
    case "rename":
      return `✏️ Name the Totem “${p.subject}”`;
    case "evolve":
      return `🐉 Evolve into a ${p.subject}`;
    case "add_keeper":
      return `🛡 Make ${nice(p.subject ?? "")} a Keeper`;
    case "remove_keeper":
      return `🚪 Remove Keeper ${nice(p.subject ?? "")}`;
    case "policy":
      return "📜 Change the tribe constitution";
    default:
      return p.description.slice(0, 60);
  }
}

function Tally({ p, t }: { p: Proposal; t: Tribe }) {
  const yes = t.keepers.filter((k) => p.votes[k] === "Approve").length;
  const no = t.keepers.filter((k) => p.votes[k] === "Reject").length;
  return (
    <div className="tally">
      <div className="tally-bar">
        {Array.from({ length: t.keepers.length }).map((_, i) => (
          <span key={i} className={i < yes ? "y" : i >= t.keepers.length - no ? "n" : ""} />
        ))}
      </div>
      <span>
        <b>{yes}</b> of {t.neededFor(p)} Keeper votes{no ? ` · ${no} against` : ""}
      </span>
    </div>
  );
}

function VoteButtons({ p, t, accountId, onError }: { p: Proposal; t: Tribe; accountId: string; onError: (m: string) => void }) {
  if (!t.amKeeper) return null;
  const mine = p.votes[accountId];
  if (mine) return <div className="voted">You voted {mine === "Approve" ? "yes ✅" : "no ❌"}</div>;
  const go = (a: "VoteApprove" | "VoteReject") => t.vote(p, a).catch((e) => onError(e instanceof Error ? e.message : String(e)));
  return (
    <div className="vote-row">
      <button className="press-btn" disabled={!!t.busy} onClick={() => go("VoteApprove")}>Vote yes</button>
      <button className="ghost-btn" disabled={!!t.busy} onClick={() => go("VoteReject")}>Vote no</button>
    </div>
  );
}

/** Compact hatch vote for the death card. */
export function HatchVote({
  t,
  nextName,
  accountId,
  onOpenTribe,
  onError,
}: {
  t: Tribe;
  nextName: string;
  accountId: string;
  onOpenTribe: () => void;
  onError: (m: string) => void;
}) {
  if (!t.ready) return <div className="dc-dao">Reading the tribe's DAO…</div>;
  const p = t.openHatch;
  const rally = `🪦 Our Totem starved. Keepers of the tribe: vote to hatch ${nextName}! 👉 ${rescueUrl().replace("rescue=1", "tribe=1")}`;
  return (
    <div className="hatch-vote">
      {p ? (
        <>
          <div className="hv-title">🗳 Hatch vote is open</div>
          <Tally p={p} t={t} />
          <VoteButtons p={p} t={t} accountId={accountId} onError={onError} />
          {!t.amKeeper && <div className="hv-note">Only Keepers vote. Nudge them:</div>}
        </>
      ) : (
        <>
          <div className="hv-title">Only the tribe can bring it back</div>
          <div className="hv-note">Anyone can ask; {t.keepers.length} Keepers decide ({t.needed} votes needed).</div>
          <button className="press-btn" disabled={!!t.busy} onClick={() => t.proposeHatch().catch((e) => onError(e instanceof Error ? e.message : String(e)))}>
            {t.busy ?? `🥚 Propose hatching ${nextName}`}
          </button>
        </>
      )}
      <div className="hv-links">
        <a href={`https://x.com/intent/post?text=${encodeURIComponent(rally)}`} target="_blank" rel="noreferrer">📣 Rally the Keepers</a>
        <button className="link-btn" onClick={onOpenTribe}>🏛 Tribe</button>
      </div>
    </div>
  );
}

/** The full Tribe panel. */
export function TribePanel({
  t,
  accountId,
  isGuest,
  nextName,
  totemAlive,
  onClose,
  onConnect,
  onError,
}: {
  t: Tribe;
  accountId: string;
  isGuest: boolean;
  nextName: string;
  totemAlive: boolean;
  onClose: () => void;
  onConnect: () => void;
  onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<"votes" | "keepers" | "leaderboard" | "history">("votes");
  const err = (e: unknown) => onError(e instanceof Error ? e.message : String(e));

  // leaderboard: aggregate feed events for the current generation from /api/history
  const [lb, setLb] = useState<{ account: string; fed: number; rescues: number }[]>([]);
  const [lbGen, setLbGen] = useState<number | null>(null);
  useEffect(() => {
    if (tab !== "leaderboard") return;
    let stop = false;
    const load = async () => {
      try {
        const h = await fetch("/api/history").then((r) => r.json() as Promise<{ events?: HistoryEvent[]; generation?: number }>);
        if (stop || !h.events) return;
        const gen = h.generation ?? 0;
        setLbGen(gen);
        const map = new Map<string, { fed: number; rescues: number }>();
        for (const e of h.events) {
          if (e.kind !== "feed" || e.generation !== gen) continue;
          const acct = String(e.data.account ?? "");
          const amt = toTokens(String(e.data.amount ?? "0"));
          const prev = map.get(acct) ?? { fed: 0, rescues: 0 };
          map.set(acct, { fed: prev.fed + amt, rescues: prev.rescues + (e.data.rescue ? 1 : 0) });
        }
        const rows = [...map.entries()]
          .map(([account, v]) => ({ account, ...v }))
          .sort((a, b) => b.fed - a.fed);
        setLb(rows);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { stop = true; clearInterval(t); };
  }, [tab]);
  const decided = t.proposals.filter((p) => p.status !== "InProgress").slice(0, 12);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="tribe glass" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="tribe-title">🏛 The Tribe</div>
        <div className="tribe-sub">
          The Totem belongs to the tribe's DAO. <b>Keepers</b> (1,000 $TOTEM staked, or a Silver badge) decide by majority:
          hatching, its name, its evolution, and who joins them. Anyone may propose. No founder or council can overrule them.
        </div>

        <div className="tabs">
          {(["votes", "keepers", "leaderboard", "history"] as const).map((x) => (
            <button key={x} className={tab === x ? "on" : ""} onClick={() => setTab(x)}>
              {x === "votes" ? `Open votes${t.open.length ? ` (${t.open.length})` : ""}` : x === "keepers" ? `Keepers (${t.keepers.length})` : x === "leaderboard" ? "🏆 Feeders" : "Decided"}
            </button>
          ))}
        </div>

        {!t.ready && <div className="tribe-empty">Reading the DAO…</div>}

        {t.ready && tab === "votes" && (
          <div className="plist">
            {!totemAlive && !t.openHatch && (
              <div className="pcard cta">
                <div className="p-title">🪦 The Totem is dead</div>
                <div className="p-desc">Ask the Keepers to hatch {nextName}. Its traits will come from the last life's top 3 feeders.</div>
                <button className="press-btn" disabled={!!t.busy} onClick={() => t.proposeHatch().catch(err)}>{t.busy ?? "🥚 Propose the hatch"}</button>
              </div>
            )}
            {t.open.length === 0 && totemAlive && <div className="tribe-empty">No open votes. The Totem is alive. 🐼</div>}
            {t.open.map((p) => (
              <div key={p.id} className="pcard">
                <div className="p-title">{title(p, nextName)}</div>
                <div className="p-desc">#{p.id} · proposed by {nice(p.proposer)}</div>
                <Tally p={p} t={t} />
                <VoteButtons p={p} t={t} accountId={accountId} onError={onError} />
              </div>
            ))}
          </div>
        )}

        {t.ready && tab === "keepers" && (
          <div className="plist">
            {t.keepers.map((k) => {
              const i = t.keeperInfo[k];
              return (
                <div key={k} className="krow">
                  <span className="k-id">🛡 {nice(k)}{k === accountId ? " (you)" : ""}</span>
                  <span className={`k-why ${i?.eligible ? "ok" : "warn"}`}>
                    {!i
                      ? "…"
                      : i.by_stake
                        ? `${tokens(i.staked)} staked`
                        : i.by_badge
                          ? `${i.badge_earned} badge`
                          : BigInt(i.releasedStake) > 0n
                            ? "⏳ needs to re-stake"
                            : "⚠ not eligible"}
                  </span>
                </div>
              );
            })}
            <div className="me-card">
              {!accountId ? (
                <>
                  <div className="p-title">Become a Keeper</div>
                  <div className="p-desc">Connect a wallet (or play free) and stake 1,000 $TOTEM in the living Totem, or earn the Silver Caretaker badge by feeding.</div>
                  <button className="press-btn" onClick={onConnect}>Connect</button>
                </>
              ) : t.me && !t.me.eligible && BigInt(t.me.releasedStake) > 0n && totemAlive ? (
                <>
                  <div className="p-title">{t.amKeeper ? "⏳ Re-stake to stay a Keeper" : "Your stake is from an earlier life"}</div>
                  <div className="p-desc">
                    A new Totem hatched, so your {tokens(t.me.releasedStake)} $TOTEM stake was released. Keepers need a stake in the
                    living Totem: move it in with one tap{isGuest ? " (free: the game pays the gas)" : ""}.
                  </div>
                  <button className="press-btn" disabled={!!t.busy} onClick={() => t.restake().catch(err)}>
                    {t.busy ?? `🔁 Re-stake into ${nextName.replace(/\s+[IVXLCDM]+$/, "")}`}
                  </button>
                </>
              ) : t.amKeeper ? (
                <div className="p-title">🛡 You are a Keeper. Your vote counts.</div>
              ) : t.myNomination ? (
                <>
                  <div className="p-title">Your nomination is open (#{t.myNomination.id})</div>
                  <Tally p={t.myNomination} t={t} />
                </>
              ) : t.me?.eligible ? (
                <>
                  <div className="p-title">You qualify as a Keeper ✨</div>
                  <div className="p-desc">
                    {t.me.by_stake ? `${tokens(t.me.staked)} $TOTEM staked` : `${t.me.badge_earned} badge`}, verified on-chain. The Keepers vote on your nomination.
                    {isGuest ? " (The game pays the proposal bond for you.)" : ` Your wallet pays a ${near(t.bond)} NEAR bond, refunded if they accept.`}
                  </div>
                  <button className="press-btn" disabled={!!t.busy} onClick={() => t.nominateMe().catch(err)}>{t.busy ?? "🛡 Nominate me"}</button>
                </>
              ) : (
                <>
                  <div className="p-title">Not a Keeper yet</div>
                  <div className="p-desc">
                    You have {tokens(t.me?.staked ?? "0")} of 1,000 $TOTEM staked{t.me?.badge_earned && t.me.badge_earned !== "none" ? ` and the ${t.me.badge_earned} badge` : ""}.
                    Stake more in the living Totem, or keep feeding to reach Silver.
                  </div>
                </>
              )}
            </div>
            <div className="council-note">
              No council, no admin: the founders hold no vote. Changing these rules takes two thirds of the Keepers.
            </div>
          </div>
        )}

        {t.ready && tab === "leaderboard" && (
          <div className="plist">
            <div className="lb-header">
              <span>Top feeders this life{lbGen !== null ? ` (Gen ${lbGen})` : ""}</span>
              <span className="lb-hint">Every point is a token fed — traceable on-chain</span>
            </div>
            {lb.length === 0 && <div className="tribe-empty">Loading feed history…</div>}
            {lb.slice(0, 15).map((row, i) => (
              <div key={row.account} className="lb-row">
                <span className="lb-rank">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}</span>
                <span className="lb-acct">{shortGuest(row.account.length > 28 ? `${row.account.slice(0, 10)}…${row.account.slice(-6)}` : row.account)}</span>
                <span className="lb-fed">{fmt(row.fed)} $TOTEM</span>
                {row.rescues > 0 && <span className="lb-rescue" title="rescue feeds">🦸 ×{row.rescues}</span>}
              </div>
            ))}
            {lb.length > 15 && <div className="tribe-empty">+{lb.length - 15} more feeders this life</div>}
          </div>
        )}

        {t.ready && tab === "history" && (
          <div className="plist">
            {decided.length === 0 && <div className="tribe-empty">Nothing decided yet.</div>}
            {decided.map((p) => (
              <div key={p.id} className="hrow">
                <span>#{p.id} {title(p, "the next egg")}</span>
                <span className={`st st-${p.status}`} title={p.status === "Approved" ? "The vote passed; the contract still checks its own rules when it runs" : undefined}>
                  {p.status === "Approved" ? "vote passed" : p.status.toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="tribe-foot">
          DAO <a href={`${EXPLORER}/address/${DAO_ID}`} target="_blank" rel="noreferrer">{DAO_ID}</a> · votes are on-chain; any Sputnik DAO client shows the same proposals
          {DAO_ID.endsWith(".sputnik-dao.near") ? (
            <>
              {" "}· <a href={`https://trezu.app/${DAO_ID}`} target="_blank" rel="noreferrer">open in Trezu</a>
            </>
          ) : (
            <> · this is a plain <a href="https://github.com/near-daos/sputnik-dao-contract" target="_blank" rel="noreferrer">Sputnik DAO</a> — the same contract <a href="https://trezu.org" target="_blank" rel="noreferrer">Trezu</a> is built on. On mainnet (<code>totem-tribe.sputnik-dao.near</code>) this panel links directly to Trezu.</>
          )}
        </div>
      </div>
    </div>
  );
}
