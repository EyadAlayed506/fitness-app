import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSpokenSet, wordsToNumbers } from "./voiceSet.ts";

test("number words become digits", () => {
  assert.equal(wordsToNumbers("eight at sixty"), "8 at 60");
  assert.equal(wordsToNumbers("sixty five"), "65");
  assert.equal(wordsToNumbers("one hundred and twenty"), "120");
  assert.equal(wordsToNumbers("a hundred and two point five"), "102.5");
  assert.equal(wordsToNumbers("twelve reps"), "12 reps");
});

test("reps at weight", () => {
  assert.deepEqual(parseSpokenSet("8 reps at 60"), { kind: "set", reps: 8, weight: 60, unit: null });
  assert.deepEqual(parseSpokenSet("8 reps at 60 kilos"), { kind: "set", reps: 8, weight: 60, unit: "kg" });
  assert.deepEqual(parseSpokenSet("Eight at sixty."), { kind: "set", reps: 8, weight: 60, unit: null });
  assert.deepEqual(parseSpokenSet("10 reps with 22.5 kg"), { kind: "set", reps: 10, weight: 22.5, unit: "kg" });
  assert.deepEqual(parseSpokenSet("twelve reps at one hundred and thirty five pounds"), { kind: "set", reps: 12, weight: 135, unit: "lb" });
  assert.deepEqual(parseSpokenSet("8 at 60 and a half"), { kind: "set", reps: 8, weight: 60.5, unit: null });
});

test("weight for reps", () => {
  assert.deepEqual(parseSpokenSet("60 kg for 8"), { kind: "set", reps: 8, weight: 60, unit: "kg" });
  assert.deepEqual(parseSpokenSet("100 pounds for ten reps"), { kind: "set", reps: 10, weight: 100, unit: "lb" });
  assert.deepEqual(parseSpokenSet("60kg x 8"), { kind: "set", reps: 8, weight: 60, unit: "kg" });
  assert.deepEqual(parseSpokenSet("60 kilos 8 reps"), { kind: "set", reps: 8, weight: 60, unit: "kg" });
});

test("reps only, bodyweight, and same again", () => {
  assert.deepEqual(parseSpokenSet("12 reps"), { kind: "set", reps: 12, weight: null, unit: null });
  assert.deepEqual(parseSpokenSet("fifteen bodyweight"), { kind: "set", reps: 15, weight: 0, unit: null });
  assert.deepEqual(parseSpokenSet("same again"), { kind: "same" });
  assert.deepEqual(parseSpokenSet("Same as last time"), { kind: "same" });
  assert.deepEqual(parseSpokenSet("repeat that"), { kind: "same" });
});

test("anything else isn't a set", () => {
  assert.equal(parseSpokenSet("add a banana to breakfast"), null);
  assert.equal(parseSpokenSet(""), null);
  assert.equal(parseSpokenSet("how many sets left"), null);
});
