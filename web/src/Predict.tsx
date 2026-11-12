// Prediction market panel — bet $TOTEM on whether the Totem survives a Rampage.

import { useState } from "react";
import { fmt, PredictMarket, PredictBet } from "./engine";
import { toTokens } from "./chain/config";
import type { Game } from "./game";

interface Props {
  game: Game;
  onClose: () => void;
  toast: (msg: string, kind?: string) => void;
}

function pct(a: number, b: number): string {
  const total = a + b;
  if (total === 0) return "50";
  return ((a / total) * 100).toFixed(0);
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
  const total = survive + die;
  const survPct = pct(survive, die);
  const diePct = pct(die, survive);

  const myS = myBet ? toTokens(myBet.survive) : 0;
  const myD = myBet ? toTokens(myBet.die) : 0;
  const hasWinning =
    m.resolved &&
    ((m.outcome === true && myS > 0) || (m.outcome === false && myD > 0));

  return (
    <div className={`pm-row glass ${m.resolved ? "pm-resolved" : "pm-open"}`}>
      <div className="pm-header">
        <span className="pm-id">Market #{m.market_id}</span>
        {m.resolved ? (
          <span className={`pm-badge ${m.outcome ? "survived" : "died"}`}>
            {m.outcome ? "✅ survived" : "💀 died"}
          </span>
        ) : (
          <span className="pm-badge open">🔥 live</span>
        )}
      </div>
      <div className="pm-pools">
        <div className="pm-side survive">
          <span className="pm-emoji">🛡️</span>
          <span className="pm-label">survive</span>
          <span className="pm-amount">{fmt(survive)}</span>
          <span className="pm-pct">{survPct}%</span>
        </div>
        <div className="pm-bar-wrap">
          <div
            className="pm-bar-fill survive"
            style={{ width: `${survPct}%` }}
          />
        </div>
        <div className="pm-side die">
          <span className="pm-emoji">💀</span>
          <span className="pm-label">die</span>
          <span className="pm-amount">{fmt(die)}</span>
          <span className="pm-pct">{diePct}%</span>
        </div>
      </div>
      {total > 0 && (
        <div className="pm-pot">pot: {fmt(total)} $TOTEM</div>
      )}
      {(myS > 0 || myD > 0) && (
        <div className="pm-mybet">
          your bet:{" "}
          {myS > 0 && (
            <span className="survive">
              {fmt(myS)} on survive
            </span>
          )}
          {myS > 0 && myD > 0 && " · "}
          {myD > 0 && (
            <span className="die">
              {fmt(myD)} on die
            </span>
          )}
        </div>
      )}
      {hasWinning && accountId && (
        <button
          className="press-btn pm-claim-btn"
          onClick={onClaim}
          disabled={busy}
        >
          🏆 Claim winnings
        </button>
      )}
    </div>
  );
}

export function PredictPanel({ game, onClose, toast }: Props) {
  const [side, setSide] = useState<"survive" | "die">("survive");
  const [amount, setAmount] = useState(50);

  const m = game.activeMarket;
  const inRampage = !!m && !m.resolved;

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

  // collect all markets to show (active first, then recent resolved ones)
  const allMarkets: PredictMarket[] = [];
  if (m) allMarkets.push(m);
  for (const rm of game.recentMarkets) {
    if (!allMarkets.find((x) => x.market_id === rm.market_id)) {
      allMarkets.push(rm);
    }
  }

  return (
    <div className="sheet glass predict-sheet">
      <div className="sheet-head">
        <span>🔮 Prediction Market</span>
        <button className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <p className="predict-desc">
        Bet $TOTEM on whether the Totem survives the current Rampage. Winners
        split the losers' pool (3% fee burned). Markets open each Rampage.
      </p>

      {game.mode !== "live" && (
        <div className="pm-offline">Prediction markets are live-only. Switch to Live testnet.</div>
      )}

      {game.mode === "live" && inRampage && (
        <div className="pm-bet-box glass">
          <div className="pm-bet-title">🔥 Rampage in progress — place your bet</div>
          <div className="pm-side-pick">
            <button
              className={`side-btn ${side === "survive" ? "active survive" : ""}`}
              onClick={() => setSide("survive")}
            >
              🛡️ Survive
            </button>
            <button
              className={`side-btn ${side === "die" ? "active die" : ""}`}
              onClick={() => setSide("die")}
            >
              💀 Die
            </button>
          </div>
          <div className="pm-amount-row">
            {[10, 50, 100, 500].map((a) => (
              <button
                key={a}
                className={`mini-btn ${amount === a ? "on" : ""}`}
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
          </div>
          <button
            className={`press-btn ${side === "survive" ? "survive-btn" : "danger-btn"}`}
            onClick={doBet}
            disabled={game.busy || !game.accountId}
          >
            Bet {amount} $TOTEM on "{side}"
          </button>
          {!game.accountId && (
            <div className="pm-note">Connect wallet or play as guest to bet</div>
          )}
        </div>
      )}

      {game.mode === "live" && !inRampage && allMarkets.length === 0 && (
        <div className="pm-empty">
          No active market. Markets open when the Totem enters Rampage.
        </div>
      )}

      <div className="pm-list">
        {allMarkets.map((market) => (
          <MarketRow
            key={market.market_id}
            m={market}
            myBet={
              game.myBet && m && market.market_id === m.market_id
                ? game.myBet
                : null
            }
            accountId={game.accountId}
            onClaim={() => doClaim(market.market_id)}
            busy={game.busy}
          />
        ))}
      </div>
    </div>
  );
}
