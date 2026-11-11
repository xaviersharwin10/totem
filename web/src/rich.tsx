// Mochi's lines use *asterisks* for actions ("*munches bamboo*"): show them in italics.
import { Fragment } from "react";

export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*[^*]+\*$/.test(p) ? <em key={i} className="act">{p.slice(1, -1)}</em> : <Fragment key={i}>{p}</Fragment>
      )}
    </>
  );
}

/** The floating bubble keeps it short; the full line is in the chat panel. */
export function bubbleText(text: string, max = 130): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 50 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
}
