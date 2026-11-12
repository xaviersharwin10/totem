// Staking into the belly, shields, unbonding, and collecting rewards
// (Blessings and Caretaker badges). Every number is a contract view:
// get_stake, get_claimable, get_caretaker, get_config.

import { friendly } from "./errors";
import { useCallback, useEffect, useState } from "react";
import { useNear } from "./chain/near";
import { toTokens, toYocto } from "./chain/config";
import { fmt, fmtTime } from "./engine";
import type { Game } from "./game";

interface StakeView {
  generation: number;
  staked: string;
  unbonding: string;
  seconds_until_unbonded: string | null;
  shielded: boolean;
  seconds_shield_left: string | null;
  released: boolean;
  staker_bonus: boolean;
  keeper_eligible: boolean;
}
interface ClaimView {
  period_id: number;
  amount: string;
  periods_left: number | null;
}
interface Caretaker {
  lifetime_points: string;
  badge_earned: string;
  badge_claimed: string;
}
interface Cfg {
  min_stake: string;
  keeper_stake: string;
  shield_min_feed: string;
  shield_window_ns: number;
  unbond_delay_ns: number;
  stake_slash_bp: number;
  /** lifetime points (whole numbers) for Bronze / Silver / Gold */
  badge_thresholds: number[];
}

const TIERS = ["none", "bronze", "silver", "gold"];
const BADGE = { bronze: "🥉 Bronze", silver: "🥈 Silver", gold: "🥇 Gold", none: "" } as Record<string, string>;
const n = (s: string | null | undefined) => (s ? Number(s) : 0);
const NS = 1e9;

export interface Belly {
  ready: boolean;
  stake: StakeView | null;
  claims: ClaimView[];
  caretaker: Caretaker | null;
  cfg: Cfg | null;
  /** Something to collect: Blessings or an unclaimed badge. */
  rewardsWaiting: number;
  badgeReady: boolean;
  refresh: () => Promise<void>;
  loadedAt: number;
}

export function useBelly(active: boolean): Belly {
  const near = useNear();
  const [stake, setStake] = useState<StakeView | null>(null);
  const [claims, setClaims] = useState<ClaimView[]>([]);
  const [caretaker, setCaretaker] = useState<Caretaker | null>(null);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);

  const refresh = useCallback(async () => {
    if (!near.accountId) return;
    try {
      const a = { account_id: near.accountId };
      const [s, c, k, conf] = await Promise.all([
        near.view<StakeView | null>("get_stake", a),
        near.view<ClaimView[]>("get_claimable", a).catch(() => []),
        near.view<Caretaker>("get_caretaker", a),
        cfg ? Promise.resolve(cfg) : near.view<Cfg>("get_config"),
      ]);
      setStake(s);
      setClaims(c);
      setCaretaker(k);
      setCfg(conf);
      setLoadedAt(Date.now());
    } catch {
      /* keep the last good read */
    }
  }, [near, cfg]);

  useEffect(() => {
    setStake(null);
    setClaims([]);
    setCaretaker(null);
    if (!active || !near.accountId) return;
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, near.accountId]);

  const badgeReady = !!caretaker && TIERS.indexOf(caretaker.badge_earned) > TIERS.indexOf(caretaker.badge_claimed);
  return {
    ready: !!cfg,
    stake,
    claims,
    caretaker,
    cfg,
    rewardsWaiting: claims.length + (badgeReady ? 1 : 0),
    badgeReady,
    refresh,
    loadedAt,
  };
}

/** One line for the wallet card. */
export function BellyLine({ b, onOpen }: { b: Belly; onOpen: () => void }) {
  const s = b.stake;
  const staked = s ? toTokens(s.staked) + toTokens(s.unbonding) : 0;
  return (
    <button className="belly-line" onClick={onOpen}>
      {!s || staked === 0 ? (
        <span>🛡 Stake in the belly</span>
      ) : s.released ? (
        <span className="warn">↩️ {fmt(staked)} released: withdraw</span>
      ) : s.shielded ? (
        <span className="ok">🛡 {fmt(toTokens(s.staked))} staked · shielded {fmtTime(n(s.seconds_shield_left))}</span>
      ) : (
        <span className="warn">⚠️ {fmt(toTokens(s.staked))} staked · unshielded</span>
      )}
      {b.rewardsWaiting > 0 && <span className="reward-dot">🎁 {b.rewardsWaiting}</span>}
    </button>
  );
}

export function StakeSheet({ game, b, onClose, toast }: { game: Game; b: Belly; onClose: () => void; toast: (m: string, kind?: string) => void }) {
  const near = useNear();
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const v = game.view!;
  const s = b.stake;
  const cfg = b.cfg;
  const bal = game.balance ?? 0;
  const staked = s && !s.released ? toTokens(s.staked) : 0;
  const unbonding = s && !s.released ? toTokens(s.unbonding) : 0;
  const released = s && s.released ? toTokens(s.staked) + toTokens(s.unbonding) : 0;
  const minStake = cfg ? toTokens(cfg.min_stake) : 0;
  const keeper = cfg ? toTokens(cfg.keeper_stake) : 1000;
  const shieldFeed = cfg ? toTokens(cfg.shield_min_feed) : 5;
  const shieldFor = cfg ? fmtTime(Number(cfg.shield_window_ns) / NS) : "";
  const unbondFor = cfg ? fmtTime(Number(cfg.unbond_delay_ns) / NS) : "";
  const slashPct = cfg ? cfg.stake_slash_bp / 100 : 15;
  const matured = s && !s.released && unbonding > 0 && !s.seconds_until_unbonded;

  const run = async (label: string, f: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try {
      await f();
      toast(ok, "level_up");
      setAmt("");
    } catch (e) {
      toast(friendly(e), "info");
    } finally {
      setBusy(null);
      b.refresh();
      game.refreshBalance();
    }
  };

  const value = Number(amt);
  const valid = value > 0 && isFinite(value);
  const doStake = () =>
    run("Staking…", () => near.call("stake", { amount: toYocto(value) }), `🛡 Staked ${fmt(value)} $TOTEM into ${v.name}'s belly`);
  const doUnstake = () =>
    run("Unstaking…", () => near.call("unstake", { amount: toYocto(value) }), `⏳ Unbonding ${fmt(value)} $TOTEM: withdraw in ${unbondFor}`);
  const doWithdraw = () => run("Withdrawing…", () => near.call("withdraw"), "↩️ Withdrawn to your balance");
  const doShield = () =>
    run(
      "Feeding…",
      async () => {
        const r = await game.feed(shieldFeed);
        if (!r || r.accepted < shieldFeed) throw new Error("The belly is too full to take a shielding snack right now. Try again when it drops.");
      },
      `🛡 Shielded for ${shieldFor}`
    );
  const claimAll = () =>
    run(
      "Claiming…",
      // at most 3 per transaction (the gasless relayer's limit); the rest stay listed
      () => near.callMany(b.claims.slice(0, 3).map((c) => ({ method: "claim_blessing", args: { period_id: c.period_id } }))),
      `🎁 Claimed ${fmt(b.claims.slice(0, 3).reduce((a, c) => a + toTokens(c.amount), 0))} $TOTEM in Blessings`
    );
  const claimBadge = () => run("Minting…", () => near.call("claim_badge"), `🏅 ${BADGE[b.caretaker?.badge_earned ?? "none"]} Caretaker badge minted to you (soulbound NFT)`);

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="tribe stake glass" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="tribe-title">🛡 Your belly stake</div>
        <div className="tribe-sub">
          Stake $TOTEM into {v.name}'s belly. Every bite slashes <b>{slashPct}%</b> of each <b>unshielded</b> stake into the Reserve. Feeding at
          least {fmt(shieldFeed)} shields yours for {shieldFor}. Unstaking takes {unbondFor} and stays slashable meanwhile, so nobody dodges a bite at
          the last second. If the Totem dies, every stake is released at once.
        </div>

        {!game.accountId ? (
          <div className="tribe-empty">Connect a wallet or play free to stake.</div>
        ) : (
          <>
            <div className="stake-grid">
              <div><b>{fmt(staked)}</b><span>staked</span></div>
              <div><b>{fmt(unbonding)}</b><span>{unbonding > 0 ? (s?.seconds_until_unbonded ? `unbonding · ${fmtTime(n(s.seconds_until_unbonded))}` : "ready to withdraw") : "unbonding"}</span></div>
              <div><b>{fmt(bal)}</b><span>in your wallet</span></div>
            </div>

            {s && !s.released && staked + unbonding > 0 && (
              s.shielded ? (
                <div className="shield ok">🛡 Shielded for {fmtTime(n(s.seconds_shield_left))}. Bites can't touch your stake until then.</div>
              ) : (
                <div className="shield warn">
                  ⚠️ Not shielded: the next bite takes {slashPct}% of it.
                  <button className="press-btn" disabled={!!busy || !v.alive} onClick={doShield}>{busy === "Feeding…" ? busy : `Feed ${fmt(shieldFeed)} to shield it`}</button>
                </div>
              )
            )}
            {s && !s.released && (
              <div className="perks">
                {s.staker_bonus ? "✨ Staker bonus on: your feeds earn extra points." : `Stake ${fmt(minStake)}+ for the staker point bonus.`}{" "}
                {s.keeper_eligible ? "🛡 You qualify as a Keeper (🏛 Tribe)." : `Stake ${fmt(keeper)}+ to qualify as a Keeper.`}
              </div>
            )}

            {released > 0 && (
              <div className="shield warn">
                ↩️ {fmt(released)} $TOTEM from {s && s.generation !== undefined ? `generation ${s.generation}` : "an earlier life"} is released.
                <button className="press-btn" disabled={!!busy} onClick={doWithdraw}>{busy === "Withdrawing…" ? busy : "Withdraw it"}</button>
              </div>
            )}

            {v.alive ? (
              <div className="stake-form">
                <input type="number" min="0" inputMode="decimal" placeholder="Amount" value={amt} onChange={(e) => setAmt(e.target.value)} />
                <div className="quick">
                  {[100, 500, 1000].map((q) => (
                    <button key={q} onClick={() => setAmt(String(q))}>{fmt(q)}</button>
                  ))}
                  <button onClick={() => setAmt(String(Math.floor(bal)))}>max</button>
                </div>
                <div className="stake-btns">
                  <button className="press-btn" disabled={!!busy || !valid || value > bal} onClick={doStake}>{busy === "Staking…" ? busy : "🛡 Stake"}</button>
                  <button className="ghost-btn" disabled={!!busy || !valid || value > staked} onClick={doUnstake}>{busy === "Unstaking…" ? busy : "Unstake"}</button>
                  {matured && <button className="ghost-btn" disabled={!!busy} onClick={doWithdraw}>{busy === "Withdrawing…" ? busy : "Withdraw"}</button>}
                </div>
              </div>
            ) : (
              <div className="tribe-empty">{v.name} is dead: no new stakes until the tribe hatches the next egg.</div>
            )}

            <div className="tribe-title small">🎁 Rewards</div>
            {b.claims.length > 0 ? (
              <div className="claims">
                {b.claims.map((c) => (
                  <div key={c.period_id} className="claim">
                    <span>Blessing #{c.period_id}: <b>{fmt(toTokens(c.amount))} $TOTEM</b></span>
                    <span className="h-meta">{c.periods_left === null ? "no deadline" : c.periods_left <= 1 ? "⚠️ last period to claim" : `${c.periods_left} periods left`}</span>
                  </div>
                ))}
                <button className="press-btn" disabled={!!busy} onClick={claimAll}>{busy === "Claiming…" ? busy : b.claims.length > 3 ? "Claim the first 3" : b.claims.length > 1 ? `Claim all ${b.claims.length}` : "Claim"}</button>
              </div>
            ) : (
              <div className="perks">
                No Blessings waiting. From Level 3, every Blessing period pays a share of the Reserve to whoever fed during it, by points.
              </div>
            )}
            {b.caretaker && (
              <div className="claims">
                <div className="claim">
                  <span>
                    {fmt(Number(b.caretaker.lifetime_points))} lifetime points
                    {b.caretaker.badge_claimed !== "none" ? ` · you hold ${BADGE[b.caretaker.badge_claimed]}` : ""}
                  </span>
                  {cfg && !b.badgeReady && (
                    <span className="h-meta">
                      {(() => {
                        const next = TIERS.indexOf(b.caretaker.badge_earned) + 1;
                        const thr = cfg.badge_thresholds[next - 1];
                        return thr ? `${BADGE[TIERS[next]]} at ${fmt(Number(thr))} points` : "top tier reached";
                      })()}
                    </span>
                  )}
                </div>
                {b.badgeReady && v.maxLevel < 2 && (
                  <div className="perks">You earned {BADGE[b.caretaker.badge_earned]}! Badges unlock once {v.name} reaches Level 2.</div>
                )}
                {b.badgeReady && v.maxLevel >= 2 && (
                  <button className="press-btn" disabled={!!busy} onClick={claimBadge}>
                    {busy === "Minting…" ? busy : `🏅 Mint your ${BADGE[b.caretaker.badge_earned]} badge`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
