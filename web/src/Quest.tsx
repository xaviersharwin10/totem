// Onboarding quest card — one guided step at a time, Meridian-style.
// Purely presentational: App.tsx owns the step state and completion signals.

interface QuestStep {
  emoji: string;
  title: string;
  body: string;
  cta: string | null;
}

export const QUEST_STEPS: QuestStep[] = [
  {
    emoji: "🐼",
    title: "Meet BaoBao",
    body: "Tap the panda to say hello. It's one living NFT the whole tribe keeps alive.",
    cta: null,
  },
  {
    emoji: "🎋",
    title: "Feed BaoBao",
    body: "Pick 🎋 from the dock and tap the grass — or hit FEED. A real $TOTEM meal.",
    cta: "🎋 Pick bamboo",
  },
  {
    emoji: "🔥",
    title: "Watch $TOTEM burn",
    body: "Feed again. Half of every meal is burned forever — that's the memecoin's heartbeat.",
    cta: "🎋 Feed again",
  },
  {
    emoji: "🛡️",
    title: "Keep it alive",
    body: "When the sky turns red it's a Rampage. Feed to rescue BaoBao and earn a Hero badge.",
    cta: "🎋 Feed",
  },
  {
    emoji: "🏛️",
    title: "Meet the tribe",
    body: "The tribe's DAO owns BaoBao. Open it to see the votes and the Keepers who govern.",
    cta: "🏛 Open the tribe",
  },
];

export function QuestCard({
  step,
  onCta,
  onDismiss,
}: {
  step: number;
  onCta: () => void;
  onDismiss: () => void;
}) {
  if (step < 0 || step >= QUEST_STEPS.length) return null;
  const s = QUEST_STEPS[step];
  return (
    <div className="quest-card glass">
      <div className="quest-head">
        <span className="quest-kicker">🧭 Quest · {step + 1}/{QUEST_STEPS.length}</span>
        <button className="quest-x" onClick={onDismiss} aria-label="Dismiss quest">✕</button>
      </div>
      <div className="quest-title">{s.emoji} {s.title}</div>
      <div className="quest-body">{s.body}</div>
      <div className="quest-foot">
        <div className="quest-dots">
          {QUEST_STEPS.map((_, k) => (
            <span key={k} className={k < step ? "done" : k === step ? "on" : ""} />
          ))}
        </div>
        {s.cta && (
          <button className="press-btn quest-cta" onClick={onCta}>{s.cta}</button>
        )}
      </div>
    </div>
  );
}
