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

function survPct(survive: number, die: number): number {
  const t = survive + die;
  return t === 0 ? 50 : (survive / t) * 100;
}

function estimatePayout(myWin: number, winPool: number, losePool: number): number {
  if (winPool === 0) return myWin;
  return myWin + (losePool * 0.97 * myWin) / winPool;
}

function PoolBar({ survive, die }: { survive: number; die: number }) {
  const sp = survPct(survive, die);
  const total = survive + die;
  return (
    <div className="pm-bar-row">
      <div className="pm-ratio">
        <div className="pm-ratio-s" style={{ width: `${Math.max(4, sp)}%` }} />
        <div className="pm-ratio-d" />
      </div>
      <div className="pm-ratio-labels">
        <span className="surv">🛡 {fmt(survive)} · {sp.toFixed(0)}%</span>
        <span className="died">💀 {fmt(die)} · {(100 - sp).toFixed(0)}%</span>
      </div>
      {total > 0 && (
        <div className="pm-pot-line">pot: <b>{fmt(total)} $TOTEM</b></div>
      )}
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

  const rowClass = m.resolved
    ? m.outcome
      ? "pm-survived"
      : "pm-died"
    : "pm-open";

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
          {estimated !== null && (
            <span className="pm-payout-hint">~{fmt(estimated)}</span>
          )}
          {lostBet && <span className="pm-lost-tag">lost</span>}
        </div>
      )}

      {hasWinning && accountId && (
        <button
          className="press-btn pm-claim-btn"
          onClick={onClaim}
          disabled={busy}
        >
          🏆 Claim{estimated ? ` ~${fmt(estimated)} $TOTEM` : " winnings"}
        </button>
      )}
    </div>
  );
}

export function PredictPanel({ game, onClose, toast }: Props) {
  const [side, setSide] = useState<"survive" | "die">("survive");
  const [amount, setAmount] = useState(50);
  // cache the last active-market bet so it's visible after resolution
  const [cachedBet, setCachedBet] = useState<{ marketId: number; bet: PredictBet } | null>(null);

  useEffect(() => {
    if (game.activeMarket && game.myBet) {
      setCachedBet({ marketId: game.activeMarket.market_id, bet: game.myBet });
    }
  }, [game.myBet, game.activeMarket]);

  const m = game.activeMarket;
  const inRampage = !!m && !m.resolved;

  const survive = m ? toTokens(m.total_survive) : 0;
  const die = m ? toTokens(m.total_die) : 0;
  const sp = survPct(survive, die);

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
    if (cachedBet?.marketId === marketId) return cachedBet.bet;
    return null;
  };

  return (
    <div
      className="sheet-bg"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="predict-sheet glass">
        {/* ── Header ── */}
        <div className="pm-head">
          <span className="predict-title">🔮 Prediction Market</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <p className="pm-desc">
          Bet $TOTEM on whether the Totem survives the Rampage. Winners split
          the losers' pool — 3% burned. A new market opens with every Rampage.
        </p>

        {/* ── Not live ── */}
        {game.mode !== "live" && (
          <div className="pm-offline">
            Prediction markets are live only. Switch to Live testnet.
          </div>
        )}

        {/* ── Empty state ── */}
        {game.mode === "live" && allMarkets.length === 0 && (
          <div className="pm-empty">
            <span className="pm-empty-emoji">🧊</span>
            <span className="pm-empty-text">
              No market open yet.<br />
              Markets appear when the Totem enters Rampage.
            </span>
          </div>
        )}

        {/* ── Live betting box ── */}
        {game.mode === "live" && inRampage && (
          <div className="pm-live-box">
            <div className="pm-live-label">🔥 Rampage · Market #{m.market_id}</div>

            <PoolBar survive={survive} die={die} />

            {/* Side picker */}
            <div className="pm-sides">
              <button
                className={`side-card ${side === "survive" ? "active survive" : ""}`}
                onClick={() => setSide("survive")}
              >
                <span className="sc-emoji">🛡️</span>
                <span className="sc-label">Survive</span>
                <span className="sc-odds">{sp.toFixed(0)}% of pool</span>
              </button>
              <button
                className={`side-card ${side === "die" ? "active die" : ""}`}
                onClick={() => setSide("die")}
              >
                <span className="sc-emoji">💀</span>
                <span className="sc-label">Die</span>
                <span className="sc-odds">{(100 - sp).toFixed(0)}% of pool</span>
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

            {/* Current bet status */}
            {game.myBet && (toTokens(game.myBet.survive) > 0 || toTokens(game.myBet.die) > 0) && (
              <div className="pm-mybet">
                <span>placed:</span>
                {toTokens(game.myBet.survive) > 0 && (
                  <span className="s-tag">🛡 {fmt(toTokens(game.myBet.survive))} survive</span>
                )}
                {toTokens(game.myBet.die) > 0 && (
                  <span className="d-tag">💀 {fmt(toTokens(game.myBet.die))} die</span>
                )}
              </div>
            )}

            {/* Bet button */}
            <button
              className={`press-btn ${side === "survive" ? "survive-btn" : "danger-btn"}`}
              onClick={doBet}
              disabled={game.busy || !game.accountId}
            >
              Bet {amount} on "{side}"
            </button>

            {!game.accountId && (
              <div className="pm-connect-note">Connect wallet or play as guest to bet</div>
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
                  busy={game.busy}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
