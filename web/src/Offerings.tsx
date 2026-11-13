// Tribal Offerings — rituals where players burn $TOTEM for island-wide spectacle.
// The burn is real (calls game.feed). Game-state effects are purely cosmetic here.

import { useState } from "react";
import { fmt } from "./engine";
import type { Game } from "./game";
import { friendly } from "./errors";

interface Props {
  game: Game;
  onClose: () => void;
  toast: (msg: string, kind?: string) => void;
  onEffect: (amount: number) => void;
}

interface Ritual {
  emoji: string;
  name: string;
  cost: number;
  tagline: string;
  effect: string;
  color: string;
}

const RITUALS: Ritual[] = [
  {
    emoji: "🎋",
    name: "Bamboo Rain",
    cost: 100,
    tagline: "Let bamboo fall from the sky",
    effect: "Bamboo rains down across the island",
    color: "#5bd87a",
  },
  {
    emoji: "⚔️",
    name: "War Cry",
    cost: 200,
    tagline: "Ignite the tribe's spirit",
    effect: "Fire bursts erupt across the scene",
    color: "#ff6a3d",
  },
  {
    emoji: "🌙",
    name: "Moon Offering",
    cost: 500,
    tagline: "A tribute to BaoBao's ancestors",
    effect: "A silver moonbeam cascades over the island",
    color: "#9db8ff",
  },
  {
    emoji: "👻",
    name: "Ancestor Call",
    cost: 1000,
    tagline: "Wake the gravestones",
    effect: "Spirits of smoke drift up from the graveyard",
    color: "#c69cff",
  },
];

export function OfferingsPanel({ game, onClose, toast, onEffect }: Props) {
  const [busy, setBusy] = useState(false);

  const doRitual = async (r: Ritual) => {
    if (!game.accountId) {
      toast("Connect a wallet or play as guest to perform a ritual", "info");
      return;
    }
    if (game.balance !== null && game.balance < r.cost) {
      toast(`You need ${fmt(r.cost)} $TOTEM — tap 🚰 to get test tokens first`, "info");
      return;
    }
    setBusy(true);
    try {
      await game.feed(r.cost);
      onEffect(r.cost);
      toast(`${r.emoji} ${r.name} complete — ${fmt(r.cost * (game.view?.burnShare ?? 0.5))} $TOTEM burned forever`, "level_up");
    } catch (e) {
      toast(friendly(e), "info");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="offerings-sheet glass">
        <div className="offerings-head">
          <span className="tribe-title">🔥 Tribal Offerings</span>
          <button className="dc-close" onClick={onClose}>✕</button>
        </div>

        <p className="offerings-desc">
          Burn $TOTEM in a ritual. Tokens are sacrificed to the tribe — gone forever.
          The island reacts with a visual spectacle.
        </p>

        {game.mode !== "live" && (
          <div className="pm-offline">
            <span className="pm-offline-emoji">📡</span>
            Rituals run on the live testnet. Switch to <b>Live testnet</b> to participate.
          </div>
        )}

        {game.mode === "live" && (
          <div className="ritual-list">
            {RITUALS.map((r) => {
              const tooLow = game.balance !== null && game.balance < r.cost;
              const burn = Math.round(r.cost * (game.view?.burnShare ?? 0.5));
              return (
                <div key={r.name} className="ritual-card glass">
                  <div className="ritual-top">
                    <span className="ritual-emoji">{r.emoji}</span>
                    <div className="ritual-info">
                      <span className="ritual-name">{r.name}</span>
                      <span className="ritual-tagline">{r.tagline}</span>
                    </div>
                    <div className="ritual-cost">
                      <span className="ritual-burn">🔥 {fmt(burn)}</span>
                      <span className="ritual-total">{fmt(r.cost)} $TOTEM</span>
                    </div>
                  </div>
                  <div className="ritual-effect" style={{ borderColor: r.color }}>{r.effect}</div>
                  <button
                    className="press-btn ritual-btn"
                    style={{ background: r.color }}
                    onClick={() => doRitual(r)}
                    disabled={busy || tooLow || !game.accountId}
                    title={tooLow ? `Need ${fmt(r.cost)} $TOTEM` : undefined}
                  >
                    {tooLow ? `Need ${fmt(r.cost)} $TOTEM` : `Perform — burn ${fmt(r.cost)}`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {game.mode === "live" && !game.accountId && (
          <div className="pm-connect-note">Connect a wallet or play as guest to perform rituals</div>
        )}
      </div>
    </div>
  );
}
