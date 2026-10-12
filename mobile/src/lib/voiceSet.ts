/**
 * Understand a spoken set: "8 reps at 60", "60 kilos for 8", "eight at sixty", "12 reps bodyweight",
 * "same again". Whisper turns the voice into text; this turns the text into a set (tested in voiceSet.test.ts).
 */

export type SpokenSet =
  | { kind: "same" }
  | { kind: "set"; reps: number; weight: number | null; unit: "kg" | "lb" | null };

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** "one hundred and twenty two point five" -> "122.5"; other words stay as they are. */
export function wordsToNumbers(text: string): string {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let value: number | null = null;
  let decimal: string | null = null;
  const flush = () => {
    if (value != null) out.push(decimal != null ? `${value}.${decimal}` : String(value));
    value = null;
    decimal = null;
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in SMALL) {
      if (decimal != null && decimal === "") decimal = String(SMALL[w]);
      else if (value != null && decimal == null && value % 10 === 0 && value >= 20 && SMALL[w] < 10) value += SMALL[w];
      else if (value != null && value >= 100 && value % 100 === 0) value += SMALL[w];
      else {
        flush();
        value = SMALL[w];
      }
    } else if (w === "hundred" && value != null) {
      value *= 100;
    } else if ((w === "and" || w === "a") && value != null && value >= 100 && i + 1 < words.length && words[i + 1] in SMALL) {
      // "a hundred and twenty": keep going
    } else if (w === "a" && words[i + 1] === "hundred") {
      flush();
      value = 1;
    } else if (w === "point" && value != null) {
      decimal = "";
    } else if (w === "half" && words[i - 1] === "a" && words[i - 2] === "and" && out.length) {
      // "60 and a half": handled below on the digits
      out.push("½");
    } else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out.join(" ").replace(/(\d+) and a ½/g, (_, n) => `${n}.5`).replace(/(\d+)\s*½/g, (_, n) => `${n}.5`);
}

function normalise(text: string): string {
  let t = ` ${text.toLowerCase().replace(/[,!?;:]/g, " ").replace(/\.(?!\d)/g, " ").replace(/(\d)\s*(kg|lb)s?\b/g, "$1 $2")} `;
  t = t.replace(/\b(kilograms?|kilos?|kgs)\b/g, "kg").replace(/\b(pounds?|lbs)\b/g, "lb");
  t = t.replace(/\b(repetitions?|reps|rep)\b/g, "reps").replace(/(\d)\s*x\s*(\d)/g, "$1 x $2");
  return wordsToNumbers(t.replace(/\s+/g, " ").trim());
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

export function parseSpokenSet(text: string): SpokenSet | null {
  const t = normalise(text);
  if (!t) return null;
  if (/\b(same( again| as (last|before)( time| set)?)?|again|repeat( that)?)\b/.test(t) && !/\d/.test(t)) return { kind: "same" };
  const unitOf = (u: string | undefined) => (u === "kg" ? "kg" : u === "lb" ? "lb" : null);
  const bodyweight = /\b(bodyweight|body weight|no weight)\b/.test(t);
  let m: RegExpExecArray | null;
  // "8 reps at 60 kg", "8 at 60", "8 reps with 60", "8 reps of 60"
  if ((m = new RegExp(String.raw`${NUM}\s*(?:reps)?\s*(?:at|with|of|@)\s*${NUM}\s*(kg|lb)?`).exec(t))) {
    return { kind: "set", reps: Math.round(Number(m[1])), weight: Number(m[2]), unit: unitOf(m[3]) };
  }
  // "60 kg for 8", "60 for 8 reps", "60 kg x 8", "60 kg 8 reps"
  if ((m = new RegExp(String.raw`${NUM}\s*(kg|lb)?\s*(?:for|x|times)\s*${NUM}`).exec(t))) {
    return { kind: "set", reps: Math.round(Number(m[3])), weight: Number(m[1]), unit: unitOf(m[2]) };
  }
  if ((m = new RegExp(String.raw`${NUM}\s*(kg|lb)\s*${NUM}\s*reps`).exec(t))) {
    return { kind: "set", reps: Math.round(Number(m[3])), weight: Number(m[1]), unit: unitOf(m[2]) };
  }
  // "12 reps" (bodyweight, or keep the weight in the form)
  if ((m = new RegExp(String.raw`${NUM}\s*reps`).exec(t)) || (bodyweight && (m = new RegExp(NUM).exec(t)))) {
    return { kind: "set", reps: Math.round(Number(m[1])), weight: bodyweight ? 0 : null, unit: null };
  }
  return null;
}
