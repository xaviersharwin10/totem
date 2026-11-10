import { Form, Mood } from "../engine";

// A round blob cat with the Popcat gag: closed mouth at rest, mouth POPS wide
// open every time it's fed (`reacting`). Original art — no copied characters.

const FORM_COLORS: Record<
  Form,
  { body: string; face: string; dark: string; ear: string; glow: string }
> = {
  egg: { body: "#f0a85a", face: "#ffdca8", dark: "#c57a2e", ear: "#ff9db0", glow: "#ffd98a" },
  dragon: { body: "#e8513a", face: "#ffc0ac", dark: "#9e2d1c", ear: "#ff8f70", glow: "#ff7a4a" },
  golem: { body: "#9aa6b0", face: "#d2dce4", dark: "#5a6670", ear: "#8fd06f", glow: "#a7d08c" },
};

export function Creature({ mood, form, reacting }: { mood: Mood; form: Form; reacting: boolean }) {
  const c = FORM_COLORS[form];
  const rampage = mood === "rampage";
  const dead = mood === "dead";
  const body = dead ? "#767b84" : rampage ? "#e8333a" : c.body;
  const face = dead ? "#9aa0a8" : c.face;
  const outline = dead ? "#3a3d44" : rampage ? "#7a1414" : c.dark;
  const popOpen = reacting || rampage; // mouth is wide open when fed or feral

  return (
    <div className={`creature-wrap mood-${mood} ${reacting ? "react" : ""}`}>
      <div
        className="creature-aura"
        style={{ background: `radial-gradient(circle, ${c.glow}55, transparent 70%)` }}
      />
      <svg className="creature" viewBox="0 0 80 80" width="320" height="320">
        <ellipse cx="40" cy="74" rx="24" ry="4" fill="rgba(0,0,0,0.4)" className="shadow" />

        {/* tail */}
        {!dead && (
          <path
            className="tail"
            d="M60 60 q14 -2 10 -16"
            fill="none"
            stroke={body}
            strokeWidth="6"
            strokeLinecap="round"
          />
        )}

        <g className="body-group">
          {/* chubby body */}
          <rect x="22" y="48" width="36" height="24" rx="14" fill={body} stroke={outline} strokeWidth="2.5" />
          {/* front paws */}
          <ellipse cx="31" cy="70" rx="6" ry="4" fill={face} stroke={outline} strokeWidth="1.5" />
          <ellipse cx="49" cy="70" rx="6" ry="4" fill={face} stroke={outline} strokeWidth="1.5" />

          {/* ears */}
          <g className="ears">
            <polygon points="20,30 24,10 36,24" fill={body} stroke={outline} strokeWidth="2" strokeLinejoin="round" />
            <polygon points="60,30 56,10 44,24" fill={body} stroke={outline} strokeWidth="2" strokeLinejoin="round" />
            <polygon points="24,26 26,15 32,24" fill={c.ear} />
            <polygon points="56,26 54,15 48,24" fill={c.ear} />
          </g>

          {/* dragon wings / golem rocks / egg sparkle */}
          {form === "dragon" && !dead && (
            <>
              <path className="wing wing-l" d="M22 44 L5 36 L13 54 Z" fill={c.dark} stroke={outline} strokeWidth="1.5" />
              <path className="wing wing-r" d="M58 44 L75 36 L67 54 Z" fill={c.dark} stroke={outline} strokeWidth="1.5" />
            </>
          )}
          {form === "golem" && !dead && (
            <>
              <rect x="14" y="52" width="8" height="11" rx="3" fill={c.dark} />
              <rect x="58" y="52" width="8" height="11" rx="3" fill={c.dark} />
              <circle cx="40" cy="12" r="3.5" fill="#79bd60" className="orb" />
            </>
          )}

          {/* head */}
          <rect x="16" y="22" width="48" height="36" rx="18" fill={body} stroke={outline} strokeWidth="2.5" />
          {/* face patch */}
          <ellipse cx="40" cy="42" rx="18" ry="14" fill={face} />

          {/* cheeks */}
          {!dead && !rampage && (
            <>
              <circle cx="24" cy="44" r="3.2" fill="#ff8fb0" opacity="0.65" />
              <circle cx="56" cy="44" r="3.2" fill="#ff8fb0" opacity="0.65" />
            </>
          )}

          {/* eyes */}
          {dead ? (
            <g stroke="#2a2d34" strokeWidth="3" strokeLinecap="round">
              <line x1="28" y1="33" x2="35" y2="40" />
              <line x1="35" y1="33" x2="28" y2="40" />
              <line x1="45" y1="33" x2="52" y2="40" />
              <line x1="52" y1="33" x2="45" y2="40" />
            </g>
          ) : rampage ? (
            <g>
              <polygon points="26,32 36,37 26,40" fill="#2a0000" />
              <polygon points="54,32 44,37 54,40" fill="#2a0000" />
              <circle cx="31" cy="36" r="1.7" fill="#ff3b3b" className="rage-eye" />
              <circle cx="49" cy="36" r="1.7" fill="#ff3b3b" className="rage-eye" />
            </g>
          ) : mood === "happy" ? (
            // content closed cat eyes ^ ^
            <g stroke="#1b1d22" strokeWidth="3" fill="none" strokeLinecap="round">
              <path d="M26 38 Q31 33 36 38" />
              <path d="M44 38 Q49 33 54 38" />
            </g>
          ) : (
            <g className="eyes">
              <circle cx="31" cy="36" r={mood === "starving" ? 7 : 5.5} fill="#fff" stroke={outline} strokeWidth="1" />
              <circle cx="49" cy="36" r={mood === "starving" ? 7 : 5.5} fill="#fff" stroke={outline} strokeWidth="1" />
              <circle className="pupil" cx="31" cy="37" r="3" fill="#15171c" />
              <circle className="pupil" cx="49" cy="37" r="3" fill="#15171c" />
              <circle cx="32.5" cy="35" r="1.1" fill="#fff" />
              <circle cx="50.5" cy="35" r="1.1" fill="#fff" />
            </g>
          )}

          {/* nose */}
          {!dead && <polygon points="38,43 42,43 40,46" fill="#d8617f" />}

          {/* whiskers */}
          {!dead && (
            <g stroke={outline} strokeWidth="1.2" strokeLinecap="round" opacity="0.7">
              <line x1="14" y1="44" x2="24" y2="45" />
              <line x1="14" y1="48" x2="24" y2="48" />
              <line x1="66" y1="44" x2="56" y2="45" />
              <line x1="66" y1="48" x2="56" y2="48" />
            </g>
          )}

          {/* mouth — the Popcat gag */}
          {!dead &&
            (popOpen ? (
              <g className="pop-mouth">
                <ellipse cx="40" cy="50" rx="7" ry="8" fill={rampage ? "#2a0000" : "#7a2230"} stroke={outline} strokeWidth="1.5" />
                <ellipse cx="40" cy="53" rx="4" ry="3.5" fill="#ff6b8a" />
                {rampage && (
                  <>
                    <polygon points="34,45 36,49 38,45" fill="#fff" />
                    <polygon points="42,45 44,49 46,45" fill="#fff" />
                  </>
                )}
              </g>
            ) : mood === "happy" ? (
              // ω cat mouth
              <path d="M34 48 Q37 51 40 48 Q43 51 46 48" stroke="#1b1d22" strokeWidth="2" fill="none" strokeLinecap="round" />
            ) : mood === "hungry" ? (
              <path d="M36 49 Q40 47 44 49" stroke="#1b1d22" strokeWidth="2" fill="none" strokeLinecap="round" />
            ) : (
              // starving: small worried open
              <ellipse cx="40" cy="49" rx="3" ry="2.4" fill="#1b1d22" />
            ))}
        </g>
      </svg>
    </div>
  );
}
