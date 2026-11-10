import { Form, Mood } from "../engine";

// Original pixel-blob creature drawn in SVG. Art changes with mood and form.
// No third-party or copied characters.

const FORM_COLORS: Record<Form, { body: string; belly: string; dark: string }> = {
  egg: { body: "#f4e4bc", belly: "#fff7e0", dark: "#c9a86a" },
  dragon: { body: "#e8513a", belly: "#ffb59e", dark: "#9e2d1c" },
  golem: { body: "#8c9aa6", belly: "#c7d2da", dark: "#53606b" },
};

export function Creature({ mood, form }: { mood: Mood; form: Form }) {
  const c = FORM_COLORS[form];
  const rampage = mood === "rampage";
  const dead = mood === "dead";
  const bodyColor = dead ? "#6b7079" : rampage ? "#e8333a" : c.body;
  const bellyColor = dead ? "#8a8f98" : c.belly;

  return (
    <div className={`creature-wrap mood-${mood}`}>
      {mood === "happy" && (
        <>
          <span className="spark spark-1">✦</span>
          <span className="spark spark-2">✦</span>
          <span className="spark spark-3">✦</span>
        </>
      )}
      {mood === "starving" && <span className="sweat">💧</span>}
      {rampage && (
        <>
          <span className="fire fire-1">🔥</span>
          <span className="fire fire-2">🔥</span>
          <span className="fire fire-3">🔥</span>
        </>
      )}

      <svg className="creature" viewBox="0 0 64 64" shapeRendering="crispEdges" width="280" height="280">
        {/* shadow */}
        <ellipse cx="32" cy="58" rx="18" ry="3.5" fill="rgba(0,0,0,0.35)" />

        {/* feet */}
        <rect x="20" y="50" width="8" height="6" fill={c.dark} />
        <rect x="36" y="50" width="8" height="6" fill={c.dark} />

        {/* body */}
        <g className="body-group">
          <rect x="14" y="16" width="36" height="38" rx="14" fill={bodyColor} />
          <rect x="20" y="30" width="24" height="22" rx="10" fill={bellyColor} />

          {form === "dragon" && !dead && (
            <>
              {/* wings */}
              <path className="wing wing-l" d="M14 24 L2 18 L8 32 Z" fill={c.dark} />
              <path className="wing wing-r" d="M50 24 L62 18 L56 32 Z" fill={c.dark} />
              {/* horns */}
              <rect x="18" y="10" width="4" height="8" fill={c.dark} />
              <rect x="42" y="10" width="4" height="8" fill={c.dark} />
            </>
          )}
          {form === "golem" && !dead && (
            <>
              {/* rocky shoulders */}
              <rect x="10" y="22" width="8" height="10" rx="2" fill={c.dark} />
              <rect x="46" y="22" width="8" height="10" rx="2" fill={c.dark} />
              <rect x="28" y="12" width="8" height="4" fill="#6fae5a" />
            </>
          )}
          {form === "egg" && !dead && (
            <rect x="29" y="12" width="6" height="6" rx="3" fill={c.dark} />
          )}

          {/* eyes */}
          {dead ? (
            <g stroke="#2a2d34" strokeWidth="2.4">
              <line x1="22" y1="30" x2="28" y2="36" />
              <line x1="28" y1="30" x2="22" y2="36" />
              <line x1="36" y1="30" x2="42" y2="36" />
              <line x1="42" y1="30" x2="36" y2="36" />
            </g>
          ) : rampage ? (
            <g>
              {/* angry slanted eyes */}
              <polygon points="20,28 30,32 20,34" fill="#2a0000" />
              <polygon points="44,28 34,32 44,34" fill="#2a0000" />
            </g>
          ) : (
            <g>
              <circle cx="25" cy="32" r={mood === "starving" ? 5.5 : 4} fill="#fff" />
              <circle cx="39" cy="32" r={mood === "starving" ? 5.5 : 4} fill="#fff" />
              <circle cx={mood === "hungry" ? 26 : 25} cy="33" r="2.1" fill="#1c1e24" />
              <circle cx={mood === "hungry" ? 40 : 39} cy="33" r="2.1" fill="#1c1e24" />
            </g>
          )}

          {/* mouth */}
          {!dead &&
            (mood === "happy" ? (
              <path d="M27 42 Q32 47 37 42" stroke="#1c1e24" strokeWidth="2" fill="none" />
            ) : mood === "hungry" ? (
              <rect x="29" y="43" width="6" height="2" fill="#1c1e24" />
            ) : mood === "starving" ? (
              <ellipse cx="32" cy="44" rx="3" ry="2.4" fill="#1c1e24" />
            ) : (
              /* rampage: jagged open mouth */
              <polygon points="26,42 29,47 32,42 35,47 38,42 38,46 26,46" fill="#2a0000" />
            ))}
        </g>
      </svg>
    </div>
  );
}
