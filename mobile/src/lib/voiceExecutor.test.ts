import assert from "node:assert/strict";
import { test } from "node:test";

import type { Command } from "./voiceCommands.ts";
import { VoiceAssistant, type ExerciseRef, type SetValues, type VoiceDeps, type VoiceSet, type VoiceState } from "./voiceExecutor.ts";

/**
 * The executor with fake app actions (these tests don't use a microphone, speech-to-text or the server:
 * they check what is saved, asked and said for given words).
 */
const LEG_PRESS: ExerciseRef = { id: 1, name: "Leg Press" };
const CHEST_PRESS: ExerciseRef = { id: 2, name: "Machine Chest Press" };
const PLANK: ExerciseRef = { id: 3, name: "Plank", bodyweight: true };
const CATALOGUE = [LEG_PRESS, CHEST_PRESS, PLANK, { id: 4, name: "Lat Pulldown" }, { id: 5, name: "Seated Cable Row" }];

function setup(overrides: Partial<VoiceState> = {}) {
  let nextId = 100;
  const log: string[] = [];
  const state: VoiceState = {
    workoutId: 7,
    sets: [],
    current: LEG_PRESS,
    plan: [
      { ...LEG_PRESS, sets: 3, reps: "10-12" },
      { ...CHEST_PRESS, sets: 3, reps: "8-10" },
      { id: 4, name: "Lat Pulldown", sets: 3, reps: "10-12" },
    ],
    unit: "kg",
    rest: { status: "idle", remainingSec: 0, usualSec: 90 },
    ...overrides,
  };
  const fail = { addSet: false, updateSet: false, note: false };
  const notes: string[] = [];
  let announced: string | null = null;
  let listening = true;
  const deps: VoiceDeps = {
    state: () => state,
    async addSet(_w, ex, v: SetValues) {
      log.push(`add ${ex.name} ${v.reps}x${v.weight}${v.unit}`);
      if (fail.addSet) throw new Error("network");
      const s: VoiceSet = { id: nextId++, exercise_id: ex.id, exercise_name: ex.name, reps: v.reps, weight_kg: v.unit === "lb" ? v.weight * 0.45359237 : v.weight };
      state.sets = [...state.sets, s];
      return s;
    },
    async updateSet(_w, set, v) {
      log.push(`update ${set.id} ${v.reps}x${v.weight}${v.unit}`);
      if (fail.updateSet) throw new Error("network");
      const s = { ...set, reps: v.reps, weight_kg: v.weight };
      state.sets = state.sets.map((x) => (x.id === set.id ? s : x));
      return s;
    },
    async deleteSet(_w, set) {
      log.push(`delete ${set.id}`);
      state.sets = state.sets.filter((x) => x.id !== set.id);
    },
    async findExercise(spoken) {
      log.push(`search ${spoken}`);
      // like the server's search: the name with the most of the spoken words
      const words = spoken.toLowerCase().split(" ").filter((w) => w !== "machine");
      const score = (e: ExerciseRef) => words.filter((w) => e.name.toLowerCase().split(" ").includes(w)).length;
      const hit = [...CATALOGUE].sort((a, b) => score(b) - score(a))[0];
      return score(hit) ? { exercise: hit, sure: score(hit) === words.length } : null;
    },
    setCurrent(ex) {
      log.push(`current ${ex.name}`);
      state.current = ex;
    },
    timer: {
      startUsual: () => {
        log.push("timer usual");
        state.rest = { ...state.rest, status: "running", remainingSec: state.rest.usualSec };
      },
      startFor: (s) => {
        log.push(`timer ${s}`);
        state.rest = { ...state.rest, status: "running", remainingSec: s };
      },
      extend: (s) => {
        log.push(`extend ${s}`);
        state.rest = { ...state.rest, remainingSec: state.rest.remainingSec + s };
      },
      setTotal: (s) => log.push(`total ${s}`),
      cancel: () => {
        log.push("cancel");
        state.rest = { ...state.rest, status: "idle", remainingSec: 0 };
      },
      setUsual: async (s) => {
        log.push(`usual ${s}`);
        state.rest = { ...state.rest, usualSec: s };
      },
    },
    async saveNote(text) {
      if (fail.note) throw new Error("network");
      notes.push(text);
    },
    async finishWorkout() {
      log.push("finish");
    },
    stopListening: () => {
      listening = false;
    },
    announceAfterRest: (t) => {
      announced = t;
    },
  };
  let clock = 0;
  const assistant = new VoiceAssistant(deps, () => clock);
  return {
    state, log, fail, notes, assistant, deps,
    announced: () => announced,
    listening: () => listening,
    /** say something after the wake word, a few seconds after the last thing */
    say: async (text: string, woke = true) => {
      clock += 5000;
      return assistant.handle(text, woke);
    },
  };
}

test("a set with the exercise name: saved, rest started, next set announced after the rest", async () => {
  const t = setup({ current: null });
  const r = await t.say("chest press, first set, 15 reps at 20 kilograms");
  assert.deepEqual(r, { say: "Set 1 of Machine Chest Press, 15 reps at 20 kilos. Resting 1 minute 30.", ok: true });
  assert.deepEqual(t.log, ["current Machine Chest Press", "add Machine Chest Press 15x20kg", "timer usual"]);
  assert.equal(t.announced(), "Next: set 2 of 3, 15 reps at 20 kilos.");
});

test("a short set uses the current exercise", async () => {
  const t = setup();
  const r = await t.say("12 reps at 25 kilos");
  assert.equal(r?.say, "Set 1 of Leg Press, 12 reps at 25 kilos. Resting 1 minute 30.");
  assert.deepEqual(t.log, ["add Leg Press 12x25kg", "timer usual"]);
});

test("weight units: said, or the user's own when not said", async () => {
  const t = setup({ unit: "lb" });
  await t.say("10 reps at 135 pounds");
  await t.say("8 reps at 60 kilos");
  await t.say("8 reps at 140");
  assert.deepEqual(t.log.filter((l) => l.startsWith("add")), ["add Leg Press 10x135lb", "add Leg Press 8x60kg", "add Leg Press 8x140lb"]);
});

test("missing reps or weight: asked, then saved from the answer (no wake word needed)", async () => {
  const t = setup();
  assert.equal((await t.say("12 reps"))?.say, "At what weight?");
  assert.deepEqual(t.log, []); // nothing saved yet
  const r = await t.say("25 kilos", false);
  assert.equal(r?.ok, true);
  assert.deepEqual(t.log, ["add Leg Press 12x25kg", "timer usual"]);

  assert.equal((await t.say("at 30 kilos"))?.say, "How many reps?");
  await t.say("ten", false);
  assert.equal(t.log.at(-2), "add Leg Press 10x30kg");

  // "same" uses the last weight; "never mind" cancels
  await t.say("8 reps");
  await t.say("same weight", false);
  assert.equal(t.log.at(-2), "add Leg Press 8x30kg");
  await t.say("8 reps");
  assert.equal((await t.say("never mind", false))?.say, "Okay, not saved.");
  assert.equal(t.log.filter((l) => l.startsWith("add")).length, 3);
});

test("bodyweight exercises don't need a weight", async () => {
  const t = setup({ current: PLANK });
  await t.say("12 reps");
  assert.deepEqual(t.log, ["add Plank 12x0kg", "timer usual"]);
});

test("invalid values are refused, nothing saved", async () => {
  const t = setup();
  assert.equal((await t.say("500 reps at 20 kilos"))?.ok, false);
  assert.equal((await t.say("10 reps at 900 kilos"))?.ok, false);
  assert.deepEqual(t.log, []);
});

test("the same words twice in a moment (a duplicate from speech-to-text) are saved once", async () => {
  const t = setup();
  await t.assistant.handle("12 reps at 25 kilos", true);
  assert.equal(await t.assistant.handle("12 reps at 25 kilos", true), null);
  assert.equal(t.log.filter((l) => l.startsWith("add")).length, 1);
  // two commands at the same time: the second waits its turn
  const [a, b] = await Promise.all([t.say("10 reps at 30 kilos"), t.say("note: felt easy")]);
  assert.equal(a?.ok, true);
  assert.equal(b?.say, "One moment, still on the last one.");
});

test("a failed save: said so, no timer, nothing announced", async () => {
  const t = setup();
  t.fail.addSet = true;
  const r = await t.say("12 reps at 25 kilos");
  assert.deepEqual(r, { say: "Your connection failed. The set wasn't saved.", ok: false });
  assert.ok(!t.log.includes("timer usual"));
  assert.equal(t.announced(), null);
});

test("rest timer: set, extend, cancel, ask, default", async () => {
  const t = setup();
  assert.equal((await t.say("rest 30 seconds"))?.say, "Resting 30 seconds.");
  assert.equal((await t.say("add 20 seconds"))?.say, "Added 20 seconds. 50 seconds left.");
  assert.equal((await t.say("make the rest two minutes"))?.say, "Rest set to 2 minutes.");
  assert.equal((await t.say("how much rest is left"))?.say, "50 seconds left.");
  assert.equal((await t.say("cancel the timer"))?.say, "Timer cancelled.");
  assert.equal((await t.say("extend my rest by 20 seconds"))?.say, "No rest is running.");
  assert.equal((await t.say("set my default rest to 2 minutes"))?.say, "Leg Press: rest 2 minutes from now on.");
  assert.deepEqual(t.log, ["timer 30", "extend 20", "total 120", "cancel", "usual 120"]);
});

test("notes: the user's words, with the exercise; failure is said", async () => {
  const t = setup();
  assert.equal((await t.say("note: my left shoulder feels uncomfortable"))?.say, "Note saved.");
  assert.deepEqual(t.notes, ["Leg Press: my left shoulder feels uncomfortable"]);
  t.fail.note = true;
  assert.deepEqual(await t.say("remember that this weight felt easy"), { say: "The note wasn't saved. Check the connection.", ok: false });
});

test("corrections and deleting (asked first)", async () => {
  const t = setup();
  await t.say("12 reps at 25 kilos");
  assert.equal((await t.say("correct my last set to 10 reps"))?.say, "Last set changed to 10 reps at 25 kilos.");
  assert.equal(t.log.at(-1), "update 100 10x25kg");
  assert.equal((await t.say("delete my last set"))?.say, "Delete Leg Press, 10 reps at 25 kilos?");
  assert.equal(t.state.sets.length, 1); // not yet
  assert.equal((await t.say("yes", false))?.say, "Deleted.");
  assert.equal(t.state.sets.length, 0);
  assert.equal((await t.say("correct my last set to 8 reps"))?.say, "There's no set to correct.");
});

test("'first set' when there's already one: asked before changing it", async () => {
  const t = setup();
  await t.say("12 reps at 25 kilos");
  const r = await t.say("leg press, first set, 10 reps at 25 kilos");
  assert.equal(r?.say, "Set 1 of Leg Press is already 12 reps at 25 kilos. Change it to 10 reps at 25 kilos?");
  await t.say("yes", false);
  assert.equal(t.log.at(-1), "update 100 10x25kg");
  assert.equal(t.state.sets.length, 1);
});

test("exercise context: unknown or loose names are never guessed", async () => {
  const t = setup();
  assert.equal((await t.say("bulgarian split squat 10 reps at 20 kilos"))?.say, "I couldn't find bulgarian split squat. Say the name again.");
  // "cable rows" only loosely matches: confirmed first
  const r = await t.say("switch to cable rowing machine");
  assert.equal(r?.say, "Did you mean Seated Cable Row?");
  assert.equal(t.state.current?.name, "Leg Press");
  await t.say("yes", false);
  assert.equal(t.state.current?.name, "Seated Cable Row");
  // no exercise at all: asked
  const t2 = setup({ current: null });
  assert.equal((await t2.say("12 reps at 20 kilos"))?.say, "Which exercise?");
  await t2.say("lat pulldown", false);
  assert.ok(t2.log.includes("add Lat Pulldown 12x20kg"));
});

test("plan: sets left, next exercise, next set", async () => {
  const t = setup();
  await t.say("12 reps at 100 kilos");
  assert.equal((await t.say("how many sets are left"))?.say, "2 sets left of Leg Press, then 2 more exercises.");
  assert.equal((await t.say("next set"))?.say, "Set 2 of 3 of Leg Press, last was 12 reps at 100 kilos.");
  assert.ok(t.log.includes("cancel")); // "next set" ends the rest
  assert.equal((await t.say("next exercise"))?.say, "Next: Machine Chest Press, 3 sets of 8-10.");
  assert.equal(t.state.current?.name, "Machine Chest Press");
});

test("finishing the workout is confirmed; stop listening works", async () => {
  const t = setup();
  assert.equal((await t.say("finish the workout"))?.say, "Finish the workout?");
  assert.equal((await t.say("no", false))?.say, "Okay, cancelled.");
  assert.ok(!t.log.includes("finish"));
  await t.say("end my workout");
  await t.say("yes", false);
  assert.ok(t.log.includes("finish"));
  assert.equal(t.listening(), false);
});

test("without the wake word (and no question asked), nothing happens", async () => {
  const t = setup();
  assert.equal(await t.assistant.handle("12 reps at 25 kilos", false), null);
  assert.deepEqual(t.log, []);
});

test("just the wake word: the next words are the command", async () => {
  const t = setup();
  assert.equal((await t.say(""))?.say, "Yes?");
  await t.say("12 reps at 25 kilos", false);
  assert.ok(t.log.includes("add Leg Press 12x25kg"));
});

test("AI fallback: only for words the parser didn't get, and a set from it is confirmed before saving", async () => {
  const t = setup();
  let asked = 0;
  t.deps.interpret = async (): Promise<Command> => {
    asked++;
    return { intent: "log_set", exercise: null, setNumber: null, count: 1, reps: 11, weight: 40, unit: "kg", bodyweight: false };
  };
  await t.say("12 reps at 25 kilos");
  assert.equal(asked, 0); // the parser understood: no AI call
  const r = await t.say("put me down for what I did, minus one rep, heavier plate");
  assert.equal(r?.say, "11 reps at 40 kilos. Save it?");
  assert.equal(t.log.filter((l) => l.startsWith("add")).length, 1);
  await t.say("yes", false);
  assert.ok(t.log.includes("add Leg Press 11x40kg"));
  t.deps.interpret = async () => null;
  assert.equal((await t.say("blah blah"))?.ok, false);
});

test("no workout: sets and notes need one", async () => {
  const t = setup({ workoutId: null });
  assert.equal((await t.say("12 reps at 25 kilos"))?.say, "Start a workout first.");
  assert.equal((await t.say("rest 30 seconds"))?.say, "Resting 30 seconds."); // the timer works anyway
});
