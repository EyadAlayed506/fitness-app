import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCommand, parseDuration } from "./voiceCommands.ts";

const p = parseCommand;

test("sets with an exercise name, set number and units", () => {
  assert.deepEqual(p("chest press, first set, 15 reps at 20 kilograms."), {
    intent: "log_set", exercise: "chest press", setNumber: 1, count: 1, reps: 15, weight: 20, unit: "kg", bodyweight: false,
  });
  assert.deepEqual(p("Lat pulldown, set 3, 10 reps at 120 pounds"), {
    intent: "log_set", exercise: "lat pulldown", setNumber: 3, count: 1, reps: 10, weight: 120, unit: "lb", bodyweight: false,
  });
  const leg = p("leg press 12 reps at 100 kilos");
  assert.equal(leg.intent === "log_set" && leg.exercise, "leg press");
});

test("sets using the current exercise", () => {
  assert.deepEqual(p("12 reps at 25 kilos."), {
    intent: "log_set", exercise: null, setNumber: null, count: 1, reps: 12, weight: 25, unit: "kg", bodyweight: false,
  });
  const c = p("Twelve at sixty");
  assert.ok(c.intent === "log_set" && c.reps === 12 && c.weight === 60 && c.unit === null);
  const lb = p("10 reps with 45 lbs");
  assert.ok(lb.intent === "log_set" && lb.unit === "lb" && lb.weight === 45);
  const dec = p("8 reps at 22.5 kg");
  assert.ok(dec.intent === "log_set" && dec.weight === 22.5);
  const x = p("60 kg for 8");
  assert.ok(x.intent === "log_set" && x.reps === 8 && x.weight === 60);
  const three = p("3 sets of 10 at 60 kilos");
  assert.ok(three.intent === "log_set" && three.count === 3 && three.reps === 10 && three.weight === 60);
  assert.deepEqual(p("same again"), { intent: "same_again" });
});

test("missing reps or weight are left empty, not guessed", () => {
  const noWeight = p("12 reps");
  assert.ok(noWeight.intent === "log_set" && noWeight.reps === 12 && noWeight.weight === null && !noWeight.bodyweight);
  const noReps = p("at 25 kilos");
  assert.ok(noReps.intent === "log_set" && noReps.reps === null && noReps.weight === 25 && noReps.unit === "kg");
  const bw = p("15 reps bodyweight");
  assert.ok(bw.intent === "log_set" && bw.reps === 15 && bw.bodyweight && bw.weight === 0);
});

test("rest timer: start, set the total, extend, cancel, ask, default", () => {
  assert.deepEqual(p("rest 30 seconds"), { intent: "rest_start", seconds: 30 });
  assert.deepEqual(p("Rest for one minute."), { intent: "rest_start", seconds: 60 });
  assert.deepEqual(p("start the timer"), { intent: "rest_start", seconds: null });
  assert.deepEqual(p("make the rest two minutes"), { intent: "rest_set_total", seconds: 120 });
  assert.deepEqual(p("set the timer to 90 seconds"), { intent: "rest_set_total", seconds: 90 });
  assert.deepEqual(p("extend my rest by 20 seconds"), { intent: "rest_extend", seconds: 20 });
  assert.deepEqual(p("add 20 seconds"), { intent: "rest_extend", seconds: 20 });
  assert.deepEqual(p("give me another minute"), { intent: "rest_extend", seconds: 60 });
  assert.deepEqual(p("take off 15 seconds"), { intent: "rest_extend", seconds: -15 });
  assert.deepEqual(p("cancel the timer"), { intent: "rest_cancel" });
  assert.deepEqual(p("skip rest"), { intent: "rest_cancel" });
  assert.deepEqual(p("how much rest is left?"), { intent: "rest_query" });
  assert.deepEqual(p("how long left"), { intent: "rest_query" });
  assert.deepEqual(p("set my default rest to 90 seconds"), { intent: "rest_default", seconds: 90 });
  assert.deepEqual(p("always rest a minute and a half"), { intent: "rest_default", seconds: 90 });
});

test("durations", () => {
  assert.equal(parseDuration("2 minutes"), 120);
  assert.equal(parseDuration("1.5 minutes"), 90);
  assert.equal(parseDuration("1 minute 30 seconds"), 90);
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("half a minute"), 30);
  assert.equal(parseDuration("90 s"), 90);
  assert.equal(parseDuration("12 sets"), null);
});

test("notes keep the user's own words", () => {
  assert.deepEqual(p("note: my left shoulder feels uncomfortable."), { intent: "note", text: "my left shoulder feels uncomfortable." });
  assert.deepEqual(p("Remember that this weight felt easy"), { intent: "note", text: "this weight felt easy" });
  assert.deepEqual(p("note that I should try 25 kilos next time"), { intent: "note", text: "I should try 25 kilos next time" });
  assert.equal(p("notebook").intent, "unknown");
});

test("corrections, deleting, questions, moving on", () => {
  assert.deepEqual(p("correct my last set to 10 reps"), { intent: "correct_last", reps: 10, weight: null, unit: null });
  assert.deepEqual(p("the last set was 12 reps at 25 kilos"), { intent: "correct_last", reps: 12, weight: 25, unit: "kg" });
  assert.deepEqual(p("change the last set to 30 kg"), { intent: "correct_last", reps: null, weight: 30, unit: "kg" });
  assert.deepEqual(p("delete my last set"), { intent: "delete_last" });
  assert.deepEqual(p("undo that"), { intent: "delete_last" });
  assert.deepEqual(p("how many sets are left?"), { intent: "sets_left" });
  assert.deepEqual(p("switch to the next exercise"), { intent: "next_exercise" });
  assert.deepEqual(p("next exercise"), { intent: "next_exercise" });
  assert.deepEqual(p("next set"), { intent: "next_set" });
  assert.deepEqual(p("switch to lat pulldown"), { intent: "switch_exercise", exercise: "lat pulldown" });
  assert.deepEqual(p("stop listening"), { intent: "stop_listening" });
  assert.deepEqual(p("finish the workout"), { intent: "finish_workout" });
  assert.deepEqual(p("yes"), { intent: "yes" });
  assert.deepEqual(p("No."), { intent: "no" });
});

test("anything else is unknown, never a guessed set", () => {
  assert.equal(p("what's the weather like").intent, "unknown");
  assert.equal(p("").intent, "unknown");
  assert.equal(p("thank you for watching").intent, "unknown"); // a classic Whisper mishearing of silence
});
