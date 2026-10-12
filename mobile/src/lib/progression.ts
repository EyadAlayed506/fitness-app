/**
 * Progressive overload helpers (pure functions, tested in progression.test.ts).
 *
 * Double progression: work within a rep range. When every set reached the top of the range last time,
 * add a little weight (and start again at the bottom of the range); otherwise aim for one more rep.
 */

export interface SimpleSet {
  reps: number;
  /** in the unit shown to the user (kg or lb) */
  weight: number;
}

export interface Suggestion {
  weight: number;
  reps: number;
  /** "weight": add weight; "reps": one more rep at the same weight */
  kind: "weight" | "reps";
  /** short reason shown under the suggestion */
  reason: string;
}

/** "10-15" → [10, 15]; "12" → [12, 12]; anything else → null. */
export function parseRepRange(text: string | null | undefined): [number, number] | null {
  const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(text ?? "");
  if (!m) return null;
  const low = Number(m[1]);
  const high = m[2] ? Number(m[2]) : low;
  return low <= high ? [low, high] : [high, low];
}

/** How much weight to add: 2.5 kg, or 5 lb. */
export const weightStep = (imperial: boolean) => (imperial ? 5 : 2.5);

const round = (n: number, digits = 1) => Number(n.toFixed(digits));

/**
 * Today's target from last session's sets for the same exercise.
 * Returns null when there's nothing to go on.
 */
export function suggestNext(last: SimpleSet[], repRange: [number, number] | null, imperial: boolean): Suggestion | null {
  const sets = last.filter((s) => s.reps > 0);
  if (!sets.length) return null;
  const top = sets.reduce((best, s) => (s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps) ? s : best));
  if (top.weight <= 0) {
    return { weight: 0, reps: top.reps + 1, kind: "reps", reason: "One more rep than last time" };
  }
  const allAtTop = repRange != null && sets.every((s) => s.reps >= repRange[1]);
  if (allAtTop) {
    const step = weightStep(imperial);
    return {
      weight: round(top.weight + step),
      reps: repRange[0],
      kind: "weight",
      reason: `Every set reached ${repRange[1]} reps last time, so add ${step} ${imperial ? "lb" : "kg"}`,
    };
  }
  return { weight: round(top.weight), reps: top.reps + 1, kind: "reps", reason: "Same weight, one more rep than last time" };
}

/** Estimated one-rep max (Epley), the same formula as the server. */
export function estimatedMax(weightKg: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export interface Best {
  weight_kg: number;
  reps: number;
  e1rm_kg: number;
}

/**
 * Does this set beat the best one so far? With weight: a higher estimated 1RM.
 * Without weight (bodyweight): more reps than the best bodyweight set.
 * The very first set of an exercise isn't a record (there's nothing to beat).
 */
export function isNewBest(set: { weight_kg: number; reps: number }, best: Best | null): boolean {
  if (!best || set.reps <= 0) return false;
  if (set.weight_kg > 0) return estimatedMax(set.weight_kg, set.reps) > best.e1rm_kg + 0.01;
  return best.weight_kg <= 0 && set.reps > best.reps;
}

/** The better of two bests (for combining the server's best with sets logged in this workout). */
export function betterBest(a: Best | null, b: Best | null): Best | null {
  if (!a) return b;
  if (!b) return a;
  if (a.e1rm_kg !== b.e1rm_kg) return a.e1rm_kg > b.e1rm_kg ? a : b;
  return a.reps >= b.reps ? a : b;
}

export const bestOf = (weight_kg: number, reps: number): Best => ({ weight_kg, reps, e1rm_kg: estimatedMax(weight_kg, reps) });
