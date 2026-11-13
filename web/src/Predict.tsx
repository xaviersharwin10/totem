// Prediction market panel — bet $TOTEM on whether the Totem survives a Rampage.

import { useEffect, useState } from "react";
import { fmt, PredictMarket, PredictBet } from "./engine";
import { toTokens } from "./chain/config";
import type { Game } from "./game";

interface Props {
  game: Game;
  onClose: () => void;
  toast: (msg: string, kind?: string) => void;
}

const FEE = 0.97; // 3% of the losing pool is burned

function survPct(survive: number, die: number): number {
  const t = survive + die;
  return t === 0 ? 50 : (survive / t) * 100;
}

/// Payout if `side` wins after adding `stake` to it: your stake back plus a
/// proportional cut of 97% of the opposing pool.
function projectedPayout(stake: number, sidePool: number, otherPool: number): number {
  const win = sidePool + stake;
  if (win === 0) return stake;
  return stake + (otherPool * FEE * stake) / win;
}

function estimatePayout(myWin: number, winPool: number, losePool: number): number {
  if (winPool === 0) return myWin;
  return myWin + (losePool * FEE * myWin) / winPool;
}

function PoolBar({ survive, die }: { survive: number; die: number }) {
  const sp = survPct(survive, die);
  return (
    <div className="pm-bar-row">
      <div className="pm-ratio">
        <div className="pm-ratio-s" style={{ width: `${Math.max(4, sp)}%` }} />
        <div className="pm-ratio-d" />
      </div>
      <div className="pm-ratio-labels">
        <span className="surv">🛡 {fmt(survive)} · {sp.toFixed(0)}%</span>
        <span className="died">{(100 - sp).toFixed(0)}% · {fmt(die)} 💀</span>
      </div>
    </div>
  );
}

function MarketRow({
  m,
  myBet,
  accountId,
  onClaim,
  busy,
}: {
  m: PredictMarket;
  myBet: PredictBet | null;
  accountId: string;
  onClaim: () => void;
  busy: boolean;
}) {
  const survive = toTokens(m.total_survive);
  const die = toTokens(m.total_die);
  const myS = myBet ? toTokens(myBet.survive) : 0;
  const myD = myBet ? toTokens(myBet.die) : 0;

  const wonSurvive = m.resolved && m.outcome === true && myS > 0;
  const wonDie = m.resolved && m.outcome === false && myD > 0;
  const hasWinning = wonSurvive || wonDie;
  const lostBet =
    m.resolved &&
    ((m.outcome === true && myD > 0 && myS === 0) ||
      (m.outcome === false && myS > 0 && myD === 0));

  const estimated = hasWinning
    ? wonSurvive
      ? estimatePayout(myS, survive, die)
      : estimatePayout(myD, die, survive)
    : null;

  const rowClass = m.resolved ? (m.outcome ? "pm-survived" : "pm-died") : "pm-open";

  return (
    <div className={`pm-row ${rowClass}`}>
      <div className="pm-row-head">
        <span className="pm-row-id">Market #{m.market_id}</span>
        {m.resolved ? (
          <span className={`pm-badge ${m.outcome ? "survived" : "died"}`}>
            {m.outcome ? "✅ survived" : "💀 died"}
          </span>
        ) : (
          <span className="pm-badge open">🔥 live</span>
        )}
      </div>

      <PoolBar survive={survive} die={die} />

      {(myS > 0 || myD > 0) && (
        <div className="pm-mybet">
          <span>you bet</span>
          {myS > 0 && <span className="s-tag">🛡 {fmt(myS)} survive</span>}
          {myD > 0 && <span className="d-tag">💀 {fmt(myD)} die</span>}
          {estimated !== null && <span className="pm-payout-hint">~{fmt(estimated)}</span>}
          {lostBet && <span className="pm-lost-tag">lost</span>}
        </div>
      )}

      {hasWinning && accountId && (
        <button className="press-btn pm-claim-btn" onClick={onClaim} disabled={busy}>
          🏆 Claim{estimated ? ` ~${fmt(estimated)} $TOTEM` : " winnings"}
        </button>
      )}
    </div>
  );
}

export function PredictPanel({ game, onClose, toast }: Props) {
  const [side, setSide] = useState<"survive" | "die">("survive");
  const [amount, setAmount] = useState(50);
  // accumulate bets for all markets we've seen, so claim buttons persist after resolution
  const [betCache, setBetCache] = useState<Map<number, PredictBet>>(new Map());

  useEffect(() => {
    if (game.activeMarket && game.myBet) {
      setBetCache((prev) => {
        const next = new Map(prev);
        next.set(game.activeMarket!.market_id, game.myBet!);
        return next;
      });
    }
  }, [game.myBet, game.activeMarket]);

  const m = game.activeMarket;
  const inRampage = !!m && !m.resolved;

  const survive = m ? toTokens(m.total_survive) : 0;
  const die = m ? toTokens(m.total_die) : 0;
  const pot = survive + die;

  // projected payout + multiplier for the current selection
  const sidePool = side === "survive" ? survive : die;
  const otherPool = side === "survive" ? die : survive;
  const payout = projectedPayout(amount, sidePool, otherPool);
  const mult = amount > 0 ? payout / amount : 1;

  const doBet = async () => {
    try {
      await game.predict(side, amount);
      toast(`🔮 Bet ${amount} $TOTEM on "${side}"`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "info");
    }
  };

  const doClaim = async (marketId: number) => {
    try {
      await game.claimPrediction(marketId);
      toast("🏆 Winnings claimed!", "level_up");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "info");
    }
  };

  const allMarkets: PredictMarket[] = [];
  if (m) allMarkets.push(m);
  for (const rm of game.recentMarkets) {
    if (!allMarkets.find((x) => x.market_id === rm.market_id)) allMarkets.push(rm);
  }
  const resolvedMarkets = allMarkets.filter((mk) => mk.resolved);

  const betForMarket = (marketId: number): PredictBet | null => {
    if (game.myBet && game.activeMarket?.market_id === marketId) return game.myBet;
    return betCache.get(marketId) ?? null;
  };

  const placed =
    game.myBet && (toTokens(game.myBet.survive) > 0 || toTokens(game.myBet.die) > 0);

  return (
    <div className="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="predict-sheet glass">
        {/* ── Header ── */}
        <div className="pm-head">
          <span className="tribe-title pm-title">🔮 Prediction Market</span>
          <button className="dc-close" onClick={onClose}>✕</button>
        </div>

        <p className="pm-desc">
          Will the Totem survive the Rampage? Back a side — winners split the
          losers' pool (3% burned). A fresh market opens with every Rampage.
        </p>

        {/* ── Not live ── */}
        {game.mode !== "live" && (
          <div className="pm-offline">
            <span className="pm-offline-emoji">📡</span>
            Prediction markets run on the live testnet. Flip the top-right switch
            to <b>Live testnet</b> to play.
          </div>
        )}

        {/* ── Empty state ── */}
        {game.mode === "live" && allMarkets.length === 0 && (
          <div className="pm-empty">
            <span className="pm-empty-orb">🔮</span>
            <span className="pm-empty-title">The orb is quiet</span>
            <span className="pm-empty-text">
              A market opens the moment the Totem enters a Rampage. Keep it
              hungry… or wait for the next one.
            </span>
          </div>
        )}

        {/* ── Live betting box ── */}
        {game.mode === "live" && inRampage && (
          <div className="pm-live-box">
            <div className="pm-live-head">
              <span className="pm-live-label">🔥 Rampage · Market #{m.market_id}</span>
              <span className="pm-live-dot">● live</span>
            </div>

            {/* hero pot */}
            <div className="pm-pot-hero">
              <span className="pm-pot-label">prize pool</span>
              <span className="pm-pot-val">{fmt(pot)}</span>
              <span className="pm-pot-unit">$TOTEM</span>
            </div>

            <PoolBar survive={survive} die={die} />

            {/* Side picker with live payout odds */}
            <div className="pm-sides">
              <button
                className={`side-card ${side === "survive" ? "active survive" : ""}`}
                onClick={() => setSide("survive")}
              >
                <span className="sc-emoji">🛡️</span>
                <span className="sc-label">Survive</span>
                <span className="sc-mult">
                  ×{projectedPayout(amount, survive, die) / Math.max(1, amount) >= 1
                    ? (projectedPayout(amount, survive, die) / Math.max(1, amount)).toFixed(2)
                    : "1.00"}
                </span>
              </button>
              <button
                className={`side-card ${side === "die" ? "active die" : ""}`}
                onClick={() => setSide("die")}
              >
                <span className="sc-emoji">💀</span>
                <span className="sc-label">Die</span>
                <span className="sc-mult">
                  ×{(projectedPayout(amount, die, survive) / Math.max(1, amount)).toFixed(2)}
                </span>
              </button>
            </div>

            {/* Amount row */}
            <div className="pm-amounts">
              {[10, 50, 100, 500].map((a) => (
                <button
                  key={a}
                  className={`pm-chip ${amount === a ? "on" : ""}`}
                  onClick={() => setAmount(a)}
                >
                  {a}
                </button>
              ))}
              <input
                className="pm-input"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
              />
              <span className="pm-unit">$TOTEM</span>
            </div>

            {/* projected return for the current pick */}
            <div className={`pm-projected ${side}`}>
              <span>
                If <b>{side === "survive" ? "🛡 survive" : "💀 die"}</b> wins
              </span>
              <span className="pm-projected-val">
                ~{fmt(payout)} <small>($TOTEM · ×{mult.toFixed(2)})</small>
              </span>
            </div>

            {/* Current bet status */}
            {placed && (
              <div className="pm-mybet">
                <span>placed:</span>
                {toTokens(game.myBet!.survive) > 0 && (
                  <span className="s-tag">🛡 {fmt(toTokens(game.myBet!.survive))} survive</span>
                )}
                {toTokens(game.myBet!.die) > 0 && (
                  <span className="d-tag">💀 {fmt(toTokens(game.myBet!.die))} die</span>
                )}
              </div>
            )}

            {/* Bet button */}
            <button
              className={`press-btn ${side === "survive" ? "survive-btn" : "danger-btn"}`}
              onClick={doBet}
              disabled={game.predictBusy || !game.accountId}
            >
              Bet {amount} on {side === "survive" ? "🛡 Survive" : "💀 Die"}
            </button>

            {!game.accountId && (
              <div className="pm-connect-note">Connect a wallet or play as guest to bet</div>
            )}
          </div>
        )}

        {/* ── Past markets ── */}
        {resolvedMarkets.length > 0 && (
          <>
            <div className="pm-section-title">Past markets</div>
            <div className="pm-list">
              {resolvedMarkets.map((market) => (
                <MarketRow
                  key={market.market_id}
                  m={market}
                  myBet={betForMarket(market.market_id)}
                  accountId={game.accountId}
                  onClaim={() => doClaim(market.market_id)}
                  busy={game.predictBusy}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
