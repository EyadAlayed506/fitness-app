// Run with: npm test   (Node's built-in test runner; no extra packages)
import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_REST, MIN_REST, formatRest, initialRestTimer, remainingMs, restTimerReducer as r, type RestTimerState } from "./restTimer.ts";

const configured = (sec = 90, id = 1, name = "Leg Press"): RestTimerState =>
  r(initialRestTimer(), { type: "configure", exerciseId: id, exerciseName: name, durationSec: sec });

test("configuring an exercise shows its rest time without starting", () => {
  const s = configured(120);
  assert.equal(s.status, "idle");
  assert.equal(s.durationSec, 120);
  assert.equal(remainingMs(s, 0), 120_000);
});

test("start counts down from the exercise's rest time and finishes at zero", () => {
  let s = r(configured(60), { type: "start", now: 1000 });
  assert.equal(s.status, "running");
  assert.equal(remainingMs(s, 31_000), 30_000);
  s = r(s, { type: "tick", now: 60_999 });
  assert.equal(s.status, "running");
  s = r(s, { type: "tick", now: 61_000 });
  assert.equal(s.status, "done");
  assert.equal(remainingMs(s, 99_000), 0);
});

test("pause keeps the remaining time; resume continues from it", () => {
  let s = r(configured(60), { type: "start", now: 0 });
  s = r(s, { type: "pause", now: 20_000 });
  assert.equal(s.status, "paused");
  assert.equal(remainingMs(s, 500_000), 40_000); // time doesn't run while paused
  s = r(s, { type: "resume", now: 100_000 });
  assert.equal(remainingMs(s, 110_000), 30_000);
});

test("starting again never creates a second countdown", () => {
  let s = r(configured(60), { type: "start", now: 0 });
  s = r(s, { type: "start", now: 10_000 }); // e.g. a second set logged quickly
  assert.equal(s.status, "running");
  assert.equal(remainingMs(s, 10_000), 60_000);
});

test("restart and skip", () => {
  let s = r(configured(60), { type: "start", now: 0 });
  s = r(s, { type: "restart", now: 45_000 });
  assert.equal(remainingMs(s, 45_000), 60_000);
  s = r(s, { type: "skip" });
  assert.equal(s.status, "idle");
  assert.equal(remainingMs(s, 0), 60_000);
});

test("adjusting changes the running countdown and the next one, within limits", () => {
  let s = r(configured(60), { type: "start", now: 0 });
  s = r(s, { type: "adjust", deltaSec: 15, now: 10_000 });
  assert.equal(s.durationSec, 75);
  assert.equal(remainingMs(s, 10_000), 65_000);
  s = r(s, { type: "adjust", deltaSec: -1000, now: 10_000 });
  assert.equal(s.durationSec, MIN_REST);
  assert.equal(remainingMs(s, 10_000), 5_000);
  s = r(s, { type: "adjust", deltaSec: 10_000, now: 10_000 });
  assert.equal(s.durationSec, MAX_REST);
});

test("the countdown keeps its own length when the next exercise has a different rest", () => {
  let s = r(configured(120), { type: "start", now: 0 });
  s = r(s, { type: "configure", exerciseId: 2, exerciseName: "Leg Curl", durationSec: 75 });
  assert.equal(s.countdownSec, 120);
  assert.equal(s.durationSec, 75);
  s = r(s, { type: "adjust", deltaSec: 15, now: 1000 });
  assert.equal(s.countdownSec, 135);
  s = r(s, { type: "skip" });
  assert.equal(s.countdownSec, 90);
  s = r(s, { type: "start", now: 2000 });
  assert.equal(s.countdownSec, 90);
});

test("moving to another exercise updates the next rest but keeps the current countdown", () => {
  let s = r(configured(120, 1, "Leg Press"), { type: "start", now: 0 });
  s = r(s, { type: "configure", exerciseId: 2, exerciseName: "Leg Curl", durationSec: 75 });
  assert.equal(s.status, "running");
  assert.equal(s.countdownFor, "Leg Press");
  assert.equal(remainingMs(s, 20_000), 100_000);
  s = r(s, { type: "tick", now: 120_000 });
  s = r(s, { type: "start", now: 130_000 });
  assert.equal(s.countdownFor, "Leg Curl");
  assert.equal(remainingMs(s, 130_000), 75_000);
  // when nothing is running, the new exercise's time shows straight away
  const idle = r(configured(120), { type: "configure", exerciseId: 3, exerciseName: "Plank", durationSec: 60 });
  assert.equal(remainingMs(idle, 0), 60_000);
});

test("pause and resume are ignored in the wrong state", () => {
  const idle = configured(60);
  assert.equal(r(idle, { type: "pause", now: 0 }), idle);
  assert.equal(r(idle, { type: "resume", now: 0 }), idle);
});

test("format", () => {
  assert.equal(formatRest(90_000), "1:30");
  assert.equal(formatRest(5_001), "0:06");
  assert.equal(formatRest(0), "0:00");
});
