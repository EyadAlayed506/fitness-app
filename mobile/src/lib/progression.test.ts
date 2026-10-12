import assert from "node:assert/strict";
import { test } from "node:test";

import { bestOf, betterBest, estimatedMax, isNewBest, parseRepRange, suggestNext, weightStep } from "./progression.ts";

test("rep ranges", () => {
  assert.deepEqual(parseRepRange("10-15"), [10, 15]);
  assert.deepEqual(parseRepRange("8–12"), [8, 12]);
  assert.deepEqual(parseRepRange(" 12 "), [12, 12]);
  assert.equal(parseRepRange("AMRAP"), null);
  assert.equal(parseRepRange(undefined), null);
});

test("every set at the top of the range: add weight, back to the bottom of the range", () => {
  const s = suggestNext(
    [
      { reps: 15, weight: 100 },
      { reps: 15, weight: 100 },
      { reps: 16, weight: 100 },
    ],
    [10, 15],
    false,
  );
  assert.deepEqual({ weight: s?.weight, reps: s?.reps, kind: s?.kind }, { weight: 102.5, reps: 10, kind: "weight" });
  // pounds go up by 5
  assert.equal(suggestNext([{ reps: 12, weight: 135 }], [8, 12], true)?.weight, 140);
  assert.equal(weightStep(true), 5);
});

test("not every set reached the top: same weight, one more rep", () => {
  const s = suggestNext(
    [
      { reps: 15, weight: 100 },
      { reps: 13, weight: 100 },
    ],
    [10, 15],
    false,
  );
  assert.deepEqual({ weight: s?.weight, reps: s?.reps, kind: s?.kind }, { weight: 100, reps: 16, kind: "reps" });
  // the heaviest set is the reference
  assert.deepEqual(
    suggestNext(
      [
        { reps: 10, weight: 60 },
        { reps: 8, weight: 70 },
      ],
      [8, 12],
      false,
    ),
    { weight: 70, reps: 9, kind: "reps", reason: "Same weight, one more rep than last time" },
  );
  // no known range: never assume the top was reached
  assert.equal(suggestNext([{ reps: 30, weight: 20 }], null, false)?.kind, "reps");
});

test("bodyweight: one more rep; nothing to go on: no suggestion", () => {
  assert.deepEqual(
    { reps: suggestNext([{ reps: 12, weight: 0 }], [10, 15], false)?.reps, kind: suggestNext([{ reps: 12, weight: 0 }], [10, 15], false)?.kind },
    { reps: 13, kind: "reps" },
  );
  assert.equal(suggestNext([], [10, 15], false), null);
  assert.equal(suggestNext([{ reps: 0, weight: 50 }], [10, 15], false), null);
});

test("new best: higher estimated 1RM, or more bodyweight reps", () => {
  assert.equal(estimatedMax(100, 1), 100);
  assert.equal(Math.round(estimatedMax(100, 10)), 133);
  const best = { weight_kg: 100, reps: 8, e1rm_kg: estimatedMax(100, 8) };
  assert.equal(isNewBest({ weight_kg: 105, reps: 8 }, best), true);
  assert.equal(isNewBest({ weight_kg: 100, reps: 9 }, best), true);
  assert.equal(isNewBest({ weight_kg: 100, reps: 8 }, best), false); // equal isn't a record
  assert.equal(isNewBest({ weight_kg: 110, reps: 3 }, best), false); // heavier but fewer reps: lower 1RM
  assert.equal(isNewBest({ weight_kg: 105, reps: 8 }, null), false); // first time: nothing to beat
  const bw = { weight_kg: 0, reps: 20, e1rm_kg: 0 };
  assert.equal(isNewBest({ weight_kg: 0, reps: 21 }, bw), true);
  assert.equal(isNewBest({ weight_kg: 0, reps: 20 }, bw), false);
  assert.equal(isNewBest({ weight_kg: 0, reps: 30 }, best), false); // bodyweight never beats a weighted best
});

test("combining bests", () => {
  const a = bestOf(100, 5);
  const b = bestOf(90, 10);
  assert.equal(betterBest(a, b), b); // 90 x 10 has the higher estimated 1RM
  assert.equal(betterBest(null, a), a);
  assert.equal(betterBest(a, null), a);
});
