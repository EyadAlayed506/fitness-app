/**
 * The coach's replies: plain text with a little structure (see the reply rules in app/services/assistant.py).
 * Pure, so it's easy to test; CoachText draws the result.
 *
 * - "**1,314 kcal**" is bold
 * - a line starting with "• " (or "- ") is a list item
 * - a short line starting with an emoji ("🍗 Food") is a block title
 * - an empty line separates blocks
 */

export interface Span {
  text: string;
  bold: boolean;
}

export type CoachLine =
  | { kind: "gap" }
  | { kind: "title"; spans: Span[] }
  | { kind: "bullet"; spans: Span[] }
  | { kind: "text"; spans: Span[] };

const EMOJI_START = /^\p{Extended_Pictographic}/u;

/** "a **b** c" -> a, b (bold), c. An unmatched "**" stays as typed. */
export function spans(line: string): Span[] {
  const out: Span[] = [];
  const parts = line.split("**");
  const closed = parts.length % 2 === 1; // every "**" has a partner
  parts.forEach((text, i) => {
    if (!text) return;
    const bold = closed && i % 2 === 1;
    if (!closed && i > 0) text = `**${text}`;
    out.push({ text, bold });
  });
  return out;
}

export function parseCoachText(text: string): CoachLine[] {
  const lines: CoachLine[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (lines.length && lines[lines.length - 1].kind !== "gap") lines.push({ kind: "gap" });
      continue;
    }
    const bullet = /^[•\-*]\s+/.exec(line);
    if (bullet) lines.push({ kind: "bullet", spans: spans(line.slice(bullet[0].length)) });
    else if (EMOJI_START.test(line) && line.length <= 32 && !/[.!?:]$/.test(line)) lines.push({ kind: "title", spans: spans(line) });
    else lines.push({ kind: "text", spans: spans(line) });
  }
  while (lines.length && lines[lines.length - 1].kind === "gap") lines.pop();
  return lines;
}
