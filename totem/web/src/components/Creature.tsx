import { Form, Mood } from "../engine";

const FORM_COLORS: Record<Form, { body: string; belly: string; dark: string; glow: string }> = {
  egg: { body: "#f6e6bd", belly: "#fff8e6", dark: "#c9a559", glow: "#ffe9a8" },
  dragon: { body: "#ec5338", belly: "#ffc0ac", dark: "#9e2a18", glow: "#ff7a4a" },
  golem: { body: "#8b98a5", belly: "#ccd6de", dark: "#4e5a65", glow: "#a7d08c" },
};

export function Creature({ mood, form, reacting }: { mood: Mood; form: Form; reacting: boolean }) {
  const c = FORM_COLORS[form];
  const rampage = mood === "rampage";
  const dead = mood === "dead";
  const body = dead ? "#6b7079" : rampage ? "#e8333a" : c.body;
  const belly = dead ? "#8a8f98" : c.belly;
  const outline = dead ? "#3a3d44" : rampage ? "#7a1414" : c.dark;

  return (
    <div className={`creature-wrap mood-${mood} ${reacting ? "react" : ""}`}>
      <div className="creature-aura" style={{ background: `radial-gradient(circle, ${c.glow}55, transparent 70%)` }} />
      <svg className="creature" viewBox="0 0 80 80" shapeRendering="geometricPrecision" width="320" height="320">
        <ellipse cx="40" cy="72" rx="22" ry="4" fill="rgba(0,0,0,0.4)" className="shadow" />

        {/* feet */}
        <g className="feet">
          <rect x="26" y="60" width="10" height="9" rx="3" fill={outline} />
          <rect x="44" y="60" width="10" height="9" rx="3" fill={outline} />
        </g>

        <g className="body-group">
          {/* arms */}
          <g className="arms">
            <rect className="arm arm-l" x="12" y="38" width="9" height="16" rx="4" fill={body} stroke={outline} strokeWidth="1.5" />
            <rect className="arm arm-r" x="59" y="38" width="9" height="16" rx="4" fill={body} stroke={outline} strokeWidth="1.5" />
          </g>

          {/* body */}
          <rect x="16" y="18" width="48" height="46" rx="20" fill={body} stroke={outline} strokeWidth="2.5" />
          <ellipse cx="40" cy="44" rx="16" ry="15" fill={belly} />

          {/* form accessories */}
          {form === "dragon" && !dead && (
            <>
              <path className="wing wing-l" d="M18 28 L2 20 L10 40 Z" fill={c.dark} stroke={outline} strokeWidth="1.5" />
              <path className="wing wing-r" d="M62 28 L78 20 L70 40 Z" fill={c.dark} stroke={outline} strokeWidth="1.5" />
              <polygon points="26,18 30,8 34,18" fill={c.dark} />
              <polygon points="46,18 50,8 54,18" fill={c.dark} />
            </>
          )}
          {form === "golem" && !dead && (
            <>
              <rect x="10" y="26" width="9" height="12" rx="3" fill={c.dark} />
              <rect x="61" y="26" width="9" height="12" rx="3" fill={c.dark} />
              <circle cx="40" cy="14" r="4" fill="#79bd60" className="orb" />
            </>
          )}
          {form === "egg" && !dead && (
            <g className="antenna">
              <line x1="40" y1="18" x2="40" y2="9" stroke={outline} strokeWidth="2" />
              <circle cx="40" cy="7" r="3.5" fill={c.glow} className="orb" />
            </g>
          )}

          {/* cheeks */}
          {!dead && !rampage && (
            <>
              <circle cx="24" cy="44" r="3" fill="#ff9db0" opacity="0.6" />
              <circle cx="56" cy="44" r="3" fill="#ff9db0" opacity="0.6" />
            </>
          )}

          {/* eyes */}
          {dead ? (
            <g stroke="#2a2d34" strokeWidth="3" strokeLinecap="round">
              <line x1="27" y1="36" x2="34" y2="43" />
              <line x1="34" y1="36" x2="27" y2="43" />
              <line x1="46" y1="36" x2="53" y2="43" />
              <line x1="53" y1="36" x2="46" y2="43" />
            </g>
          ) : rampage ? (
            <g>
              <polygon points="24,34 36,39 24,42" fill="#2a0000" />
              <polygon points="56,34 44,39 56,42" fill="#2a0000" />
              <circle cx="30" cy="38" r="1.6" fill="#ff3b3b" className="rage-eye" />
              <circle cx="50" cy="38" r="1.6" fill="#ff3b3b" className="rage-eye" />
            </g>
          ) : (
            <g className="eyes">
              <circle cx="31" cy="39" r={mood === "starving" ? 7 : 5.5} fill="#fff" stroke={outline} strokeWidth="1" />
              <circle cx="49" cy="39" r={mood === "starving" ? 7 : 5.5} fill="#fff" stroke={outline} strokeWidth="1" />
              <circle className="pupil" cx={mood === "hungry" ? 33 : 31} cy="40" r="2.6" fill="#15171c" />
              <circle className="pupil" cx={mood === "hungry" ? 51 : 49} cy="40" r="2.6" fill="#15171c" />
              <circle cx="32" cy="38" r="1" fill="#fff" />
              <circle cx="50" cy="38" r="1" fill="#fff" />
            </g>
          )}

          {/* mouth */}
          {!dead &&
            (mood === "happy" ? (
              <path d="M33 50 Q40 57 47 50" stroke="#15171c" strokeWidth="2.5" fill="none" strokeLinecap="round" />
            ) : mood === "hungry" ? (
              <rect x="36" y="51" width="8" height="2.5" rx="1" fill="#15171c" />
            ) : mood === "starving" ? (
              <ellipse cx="40" cy="52" rx="4" ry="3.2" fill="#15171c" />
            ) : (
              <polygon points="32,50 36,56 40,50 44,56 48,50 48,55 32,55" fill="#2a0000" />
            ))}
        </g>
      </svg>
    </div>
  );
}
