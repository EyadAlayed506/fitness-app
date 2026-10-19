/**
 * Hands-free workout commands: the words after the wake word ("Chat, 12 reps at 25 kilos") as a structured
 * command. Deterministic and offline (no AI): the same words always give the same command, and anything this
 * can't read is "unknown" (the app then asks, or tries the AI fallback). Tested in voiceCommands.test.ts.
 *
 * This only recognises a command. Checking it against the workout and doing it is voiceExecutor.ts.
 */
import { normaliseSpeech, parseSpokenSet } from "./voiceSet.ts";

export type Unit = "kg" | "lb";

export type Command =
  /** a set; any part can be missing (the executor asks for what's needed) */
  | { intent: "log_set"; exercise: string | null; setNumber: number | null; count: number; reps: number | null; weight: number | null; unit: Unit | null; bodyweight: boolean; extra?: boolean }
  | { intent: "same_again" }
  /** ready for the next set: ends the rest and says the target */
  | { intent: "next_set" }
  /** start a rest now: `seconds` for this rest only, or null for the exercise's usual rest */
  | { intent: "rest_start"; seconds: number | null }
  /** the rest running now lasts this long in total ("make the rest two minutes") */
  | { intent: "rest_set_total"; seconds: number }
  /** add to (or, if negative, take off) the rest running now */
  | { intent: "rest_extend"; seconds: number }
  | { intent: "rest_cancel" }
  | { intent: "rest_query" }
  /** the usual rest for this exercise from now on */
  | { intent: "rest_default"; seconds: number }
  /** the user's own words, exactly */
  | { intent: "note"; text: string }
  | { intent: "correct_last"; reps: number | null; weight: number | null; unit: Unit | null }
  | { intent: "delete_last" }
  | { intent: "sets_left" }
  | { intent: "next_exercise" }
  | { intent: "switch_exercise"; exercise: string }
  | { intent: "stop_listening" }
  | { intent: "finish_workout" }
  | { intent: "yes" }
  | { intent: "no" }
  | { intent: "unknown"; text: string };

// ---------- durations ----------

/** "30 seconds", "2 minutes", "1.5 minutes", "a minute and a half", "1 minute 30 seconds", "1:30", "90 s" -> seconds. */
export function parseDuration(normalised: string): number | null {
  let t = ` ${normalised} `
    .replace(/½/g, "half")
    .replace(/\bhalf an? (minute|min)\b/g, "30 seconds")
    .replace(/\b(another|1 more|extra) (minute|min)\b/g, "$1 1 minute")
    .replace(/\ban? (minute|min)\b/g, "1 minute")
    .replace(/\b(\d+(?:\.\d+)?) (minutes?|mins?) and an? half\b/g, (_, n) => `${Number(n) + 0.5} minutes`)
    .replace(/\b(\d+(?:\.\d+)?) and an? half (minutes?|mins?)\b/g, (_, n) => `${Number(n) + 0.5} minutes`);
  const clock = /\b(\d{1,2}):(\d{2})\b/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  let total = 0;
  let found = false;
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(minutes?|mins?|m)\b/g, (_, n) => {
    total += Number(n) * 60;
    found = true;
    return " ";
  });
  t.replace(/\b(\d+(?:\.\d+)?)\s*(seconds?|secs?|s)\b/g, (_, n) => {
    total += Number(n);
    found = true;
    return " ";
  });
  return found ? Math.round(total) : null;
}

// ---------- sets ----------

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "6th": 6, "7th": 7, "8th": 8, "9th": 9, "10th": 10,
};
// "first set", "set 3", "set number 3" (but not "set 12 reps": that 12 is the reps)
const ORDINAL_RE = new RegExp(`\\b(?:(${Object.keys(ORDINALS).join("|")}) set|set (?:number )?(\\d+)(?! ?(?:reps|kg|lb|x|times|at|with)\\b))\\b`);
/** "another set", "one more set of", "an extra set": add a set even when the plan's sets are done */
const EXTRA_RE = /\b(?:another|1 more|one more|an extra|extra|additional|bonus) sets?(?: of)?\b/;

/** Words that can come before a set without being an exercise name ("log 12 reps", "I did 10"). */
const FILLER = new Set([
  "log", "add", "record", "save", "put", "i", "i'm", "im", "did", "do", "just", "done", "finished", "got", "and", "then",
  "for", "of", "a", "an", "the", "my", "set", "sets", "on", "with", "at", "okay", "ok", "so", "now", "that", "was", "it",
  "please", "um", "uh", "make", "give", "me", "weight", "reps", "kg", "lb", "times", "x", "using", "this", "time", "went",
  "managed", "hit", "completed", "another", "more", "extra", "new", "yeah", "right", "alright", "let's", "lets", "go",
]);

function exerciseWords(text: string): string | null {
  const words = text.split(" ").filter((w) => w && !FILLER.has(w));
  const name = words.join(" ").trim();
  return name.length >= 3 ? name : null;
}

/**
 * Reps, weight and unit from a normalised phrase, in any order people say them: "12 reps at 25 kg",
 * "25 kg 12 reps", "add 12 reps 25 kilos", "12 times 25", "25 kg x 12", "60 for 8", "weight 25 reps 12",
 * "twelve twenty five". Each number is labelled from the words around it; what's left is filled in by
 * elimination, then by order (reps first). Any of them can be missing.
 */
export function setValues(t: string): { reps: number | null; weight: number | null; unit: Unit | null; bodyweight: boolean } {
  const bodyweight = /\b(bodyweight|body weight|no weight|no weights)\b/.test(t);
  const words = t.split(" ").filter(Boolean);
  type Num = { i: number; v: number; role: "reps" | "weight" | null; unit: Unit | null };
  const nums: Num[] = [];
  words.forEach((w, i) => {
    if (!/^\d+(\.\d+)?$/.test(w)) return;
    if (/^(seconds?|secs?|s|minutes?|mins?)$/.test(words[i + 1] ?? "")) return; // a time, not a set
    nums.push({ i, v: Number(w), role: null, unit: null });
  });
  const at = (i: number) => nums.find((n) => n.i === i);
  for (const n of nums) {
    const next = words[n.i + 1] ?? "";
    const prev = words[n.i - 1] ?? "";
    if (next === "kg" || next === "lb") [n.role, n.unit] = ["weight", next];
    else if (/^(reps?|times|repetitions?)$/.test(next)) n.role = "reps";
    else if (/^reps?$/.test(prev) && !/^\d/.test(words[n.i - 2] ?? "")) n.role = "reps"; // "reps 12" (not "12 reps 25")
    else if (prev === "weight" || prev === "weighing") n.role = "weight";
  }
  // "A x B": weight x reps (unless a unit says the other way round)
  words.forEach((w, i) => {
    const [a, b] = [at(i - 1), at(i + 1)];
    if (w !== "x" || !a || !b) return;
    if (a.role === "reps" || b.role === "weight") [a.role, b.role] = ["reps", "weight"];
    else [a.role, b.role] = ["weight", "reps"];
  });
  // "A for B": weight for reps ("60 kg for 8")
  words.forEach((w, i) => {
    const [a, b] = [at(i - 1), at(i + 1)];
    if (w !== "for" || !a || !b) return;
    a.role ??= b.role === "weight" ? "reps" : "weight";
    b.role ??= a.role === "weight" ? "reps" : "weight";
  });
  // "at / with / on / using 25": a weight
  for (const n of nums) if (!n.role && /^(at|with|on|using|plus)$/.test(words[n.i - 1] ?? "")) n.role = "weight";
  let reps = nums.find((n) => n.role === "reps") ?? null;
  let weight = nums.find((n) => n.role === "weight") ?? null;
  const free = nums.filter((n) => !n.role);
  if (!reps && weight && free.length) reps = free.shift()!;
  if (!weight && reps && free.length) weight = free.shift()!;
  if (!reps && !weight && free.length) {
    reps = free.shift()!; // "12" alone is reps; "twelve twenty five" is reps then weight
    weight = free.shift() ?? null;
  }
  if (bodyweight && !weight) return { reps: reps?.v ?? null, weight: 0, unit: null, bodyweight };
  return { reps: reps?.v ?? null, weight: weight?.v ?? null, unit: weight?.unit ?? null, bodyweight: bodyweight || weight?.v === 0 };
}

// ---------- the parser ----------

export function parseCommand(raw: string): Command {
  const original = raw.trim().replace(/^[\s,.:;!-]+/, "");
  if (!original) return { intent: "unknown", text: raw };

  // a note: keep the user's own words exactly (only the "note:" part is taken off)
  const note =
    /^(?:please\s+)?(?:add|make|take|write)?\s*(?:a\s+)?note\b(?:\s+that)?\s*[:,\-–]?\s*(.+)$/i.exec(original) ??
    /^(?:please\s+)?remember(?:\s+that)?\s*[:,\-–]?\s*(.+)$/i.exec(original) ??
    /^(?:please\s+)?write(?:\s+down)?(?:\s+that)?\s*[:,\-–]\s*(.+)$/i.exec(original);
  if (note && note[1].trim().length >= 2) return { intent: "note", text: note[1].trim() };

  const t = normaliseSpeech(original);
  const words = t.split(" ").filter(Boolean);
  const has = (re: RegExp) => re.test(t);

  // short answers to a question the app asked
  if (words.length <= 4) {
    if (/^(yes|yeah|yep|yup|correct|confirm|confirmed|do it|sure|ok|okay|right|that's right)\b/.test(t)) return { intent: "yes" };
    if (/^(no|nope|nah|cancel|never ?mind|don't|do not|forget it|stop)\b/.test(t) && !has(/\b(timer|rest|listening)\b/)) return { intent: "no" };
  }

  if (has(/\b(stop listening|hands ?-?free off|turn off hands ?-?free|stop hands ?-?free|go to sleep|stop voice|voice off)\b/)) return { intent: "stop_listening" };
  if (has(/\b(finish|end|complete|stop) (the |my |this )?(workout|session|training)\b/)) return { intent: "finish_workout" };

  // ----- the rest timer -----
  const restWord = has(/\b(rest|timer|break)\b/);
  const seconds = parseDuration(t);
  if (has(/\b(cancel|stop|skip|end|kill|clear|reset)\b/) && restWord) return { intent: "rest_cancel" };
  if (has(/^skip\b/) && !has(/\bexercise\b/)) return { intent: "rest_cancel" };
  if (has(/\bhow (much|long)\b/) && !has(/\bsets?\b/) && (restWord || has(/\b(left|remaining|to go)\b/))) return { intent: "rest_query" };
  if (has(/\b(time|rest) (left|remaining)\b/) && !has(/\bsets?\b/)) return { intent: "rest_query" };
  if (seconds != null) {
    if (has(/\b(default|always|every time|from now on|usual|normally)\b/) && restWord) return { intent: "rest_default", seconds };
    if (has(/\b(take off|remove|shorten|shorter|reduce|minus|less|cut|subtract)\b/)) return { intent: "rest_extend", seconds: -seconds };
    if (has(/\b(add|extend|plus|another|more|longer|extra|give me)\b/)) return { intent: "rest_extend", seconds };
    if (has(/\b(make|set|change|put)\b/) && restWord) return { intent: "rest_set_total", seconds };
    if (restWord && !has(/\breps?\b/)) return { intent: "rest_start", seconds };
  }
  if (has(/^(start )?(the |my |a )?(rest|timer|rest timer)( now| please)?$/) || has(/^start (the |my )?(rest|timer)\b/)) return { intent: "rest_start", seconds: null };

  // ----- sets and exercises -----
  if (has(/\b(delete|remove|undo|scratch|erase|drop)\b/) && (has(/\b(last|previous|that) set\b/) || has(/^(undo|undo that|delete that|scratch that)$/))) {
    return { intent: "delete_last" };
  }
  if (has(/\b(correct|change|fix|update|edit|make)\b.*\b(last|previous) set\b/) || has(/^(the )?(last|previous) set (was|should be|is)\b/)) {
    const after = t.replace(/^.*?\b(last|previous) set\b/, "").replace(/\b(to|was|should be|is|it|actually)\b/g, " ");
    const v = setValues(` ${after} `);
    const repsOnly = /^\s*(\d+)\s*$/.exec(after);
    return { intent: "correct_last", reps: v.reps ?? (repsOnly ? Number(repsOnly[1]) : null), weight: v.weight, unit: v.unit };
  }
  if (has(/\bhow many (sets|more sets)\b/) || has(/\bsets? (are )?(left|remaining|to go)\b/) || has(/^what'?s left\b/)) return { intent: "sets_left" };
  if (has(/\b(next exercise|following exercise|move on|skip (this|the) exercise|switch to the next|go to the next|onto the next|on to the next)\b/)) {
    return { intent: "next_exercise" };
  }
  if (has(/^(next set|ready|i'?m ready|start (the |my )?next set|let'?s go|go)$/) || has(/^(start|starting|ready for) (the |my )?next set\b/)) return { intent: "next_set" };

  const spoken = parseSpokenSet(t);
  if (spoken?.kind === "same") return { intent: "same_again" };

  // "chest press, first set, 15 reps at 20 kg" / "3 sets of 10 at 60" / "12 reps at 25"
  let rest = ` ${t} `;
  const extraMatch = EXTRA_RE.exec(rest);
  const extra = !!extraMatch;
  if (extraMatch) rest = rest.replace(extraMatch[0], " ");
  rest = rest.replace(/\ba set of\b/, " ");
  let setNumber: number | null = null;
  const ord = ORDINAL_RE.exec(rest);
  if (ord) {
    setNumber = ord[1] ? ORDINALS[ord[1]] : Number(ord[2]);
    rest = rest.replace(ord[0], " ");
  }
  let count = 1;
  const many = /\b(\d+) sets? (?:of )?(?=\d)/.exec(rest);
  if (many) {
    count = Number(many[1]);
    rest = rest.replace(many[0], " ");
  }
  const values = setValues(rest);
  const firstNumber = rest.search(/\d|\b(bodyweight|body weight)\b/);
  const before = firstNumber >= 0 ? rest.slice(0, firstNumber) : rest;
  const name = exerciseWords(before.replace(/\b(reps?|kg|lb)\b/g, " ").replace(/\s+/g, " ").trim());
  const hasValues = values.reps != null || values.weight != null || values.bodyweight;
  if (hasValues || (setNumber != null && name)) {
    return { intent: "log_set", exercise: name, setNumber, count: Math.min(10, Math.max(1, count)), ...values, ...(extra ? { extra } : {}) };
  }

  // "switch to lat pulldown", "now leg press", "next is leg press", "doing lat pulldown"
  const sw = /^(?:switch(?:ing)? to|change to|go to|now|next is|next up is|let'?s do|doing|start(?:ing)?|move to|on to|onto)\s+(.+)$/.exec(t);
  if (sw) {
    const exercise = exerciseWords(sw[1]);
    if (exercise) return { intent: "switch_exercise", exercise };
  }
  return { intent: "unknown", text: original };
}
