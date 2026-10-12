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
  | { intent: "log_set"; exercise: string | null; setNumber: number | null; count: number; reps: number | null; weight: number | null; unit: Unit | null; bodyweight: boolean }
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
const ORDINAL_RE = new RegExp(`\\b(?:(${Object.keys(ORDINALS).join("|")}) set|set (?:number )?(\\d+))\\b`);

/** Words that can come before a set without being an exercise name ("log 12 reps", "I did 10"). */
const FILLER = new Set([
  "log", "add", "record", "save", "put", "i", "did", "do", "just", "done", "finished", "got", "and", "then", "for", "of",
  "a", "the", "my", "set", "sets", "on", "with", "at", "okay", "ok", "so", "now", "that", "was", "it", "please", "um", "uh",
]);

function exerciseWords(text: string): string | null {
  const words = text.split(" ").filter((w) => w && !FILLER.has(w));
  const name = words.join(" ").trim();
  return name.length >= 3 ? name : null;
}

/** Reps, weight and unit from a normalised phrase; any of them can be missing. */
function setValues(t: string): { reps: number | null; weight: number | null; unit: Unit | null; bodyweight: boolean } {
  const bodyweight = /\b(bodyweight|body weight|no weight|no weights)\b/.test(t);
  const spoken = parseSpokenSet(t);
  if (spoken?.kind === "set") return { reps: spoken.reps, weight: spoken.weight, unit: spoken.unit, bodyweight: bodyweight || spoken.weight === 0 };
  // a weight without reps: "at 25 kg", "with 60", "25 kg"
  const w = /\b(?:at|with)\s*(\d+(?:\.\d+)?)\s*(kg|lb)?\b/.exec(t) ?? /\b(\d+(?:\.\d+)?)\s*(kg|lb)\b/.exec(t);
  if (w) return { reps: null, weight: Number(w[1]), unit: (w[2] as Unit) ?? null, bodyweight };
  return { reps: null, weight: null, unit: null, bodyweight };
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
    return { intent: "log_set", exercise: name, setNumber, count: Math.min(10, Math.max(1, count)), ...values };
  }

  // "switch to lat pulldown", "now leg press", "next is leg press", "doing lat pulldown"
  const sw = /^(?:switch(?:ing)? to|change to|go to|now|next is|next up is|let'?s do|doing|start(?:ing)?|move to|on to|onto)\s+(.+)$/.exec(t);
  if (sw) {
    const exercise = exerciseWords(sw[1]);
    if (exercise) return { intent: "switch_exercise", exercise };
  }
  return { intent: "unknown", text: original };
}
