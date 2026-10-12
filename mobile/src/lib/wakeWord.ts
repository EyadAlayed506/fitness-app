/**
 * Wake word: an utterance counts only if it starts with it ("Chat, 12 reps at 25 kilos"), optionally after
 * "hey" / "ok". Tested in wakeWord.test.ts.
 *
 * Speech-to-text can spell a short word a few ways, so a wake word has a few accepted spellings. They're
 * listed, not fuzzy-matched: "that" is one letter from "chat" and starts many sentences.
 */

export const DEFAULT_WAKE_WORD = "Chat";

const SPELLINGS: Record<string, string[]> = {
  chat: ["chat", "chats", "chad", "chatt", "chet"],
  coach: ["coach", "coaches", "couch"],
};

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Did the utterance start with the wake word? `command` is the rest, in the user's own words. */
export function matchWakeWord(transcript: string, wakeWord: string): { matched: boolean; command: string } {
  const wake = words(wakeWord);
  if (!wake.length) return { matched: false, command: "" };
  const accepted = (i: number, w: string) => (wake.length === 1 && SPELLINGS[wake[0]] ? SPELLINGS[wake[0]] : [wake[i], `${wake[i]}s`]).includes(w);

  // walk the original text word by word, so the command keeps its punctuation and capitals
  const tokens = [...transcript.matchAll(/[\p{L}\p{N}']+/gu)];
  let i = 0;
  if (tokens[i] && ["hey", "hi", "ok", "okay", "yo"].includes(tokens[i][0].toLowerCase())) i++;
  for (let k = 0; k < wake.length; k++, i++) {
    if (!tokens[i] || !accepted(k, tokens[i][0].toLowerCase())) return { matched: false, command: "" };
  }
  const last = tokens[i - 1];
  const after = transcript.slice((last.index ?? 0) + last[0].length).replace(/^[\s,.:;!?-]+/, "").trim();
  return { matched: true, command: after };
}
