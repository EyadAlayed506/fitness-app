import assert from "node:assert/strict";
import { test } from "node:test";

import { SpeechDetector, type DetectorEvent } from "./speechDetector.ts";

/** Feed a level every 100 ms: [level, how many ms]... */
function run(d: SpeechDetector, parts: [number, number][], start = 0): DetectorEvent[] {
  const events: DetectorEvent[] = [];
  let t = start;
  for (const [level, ms] of parts) {
    for (let k = 0; k < ms; k += 100, t += 100) {
      const e = d.feed(level, t);
      if (e) events.push(e);
    }
  }
  return events;
}

test("speech above the background is found, and ends after a quiet stretch", () => {
  const d = new SpeechDetector();
  const events = run(d, [[-60, 2000], [-30, 1500], [-60, 1500]]);
  assert.deepEqual(events.map((e) => e.type), ["speech_start", "speech_end"]);
  const end = events[1] as Extract<DetectorEvent, { type: "speech_end" }>;
  assert.equal(end.startedAt, 2000);
  assert.equal(end.at, 3500);
});

test("a clank or cough is too short to count", () => {
  const d = new SpeechDetector();
  assert.deepEqual(run(d, [[-60, 2000], [-25, 100], [-60, 2000]]), []);
});

test("loud gym music: the background is learned, and only speech above it counts", () => {
  const d = new SpeechDetector();
  assert.deepEqual(run(d, [[-35, 10_000]]), []); // steady music is background after a moment
  assert.ok(d.noiseFloor > -40);
  const events = run(d, [[-18, 1200], [-35, 1500]], 10_000);
  assert.deepEqual(events.map((e) => e.type), ["speech_start", "speech_end"]);
});

test("quiet rooms: tiny sounds are never speech", () => {
  const d = new SpeechDetector();
  assert.deepEqual(run(d, [[-90, 3000], [-62, 2000], [-90, 1000]]), []);
});

test("too long to be a command (music turned up, someone talking on and on): dropped, then learned", () => {
  const d = new SpeechDetector({ maxSpeechMs: 3000 });
  const events = run(d, [[-60, 1500], [-25, 5000]]);
  assert.deepEqual(events.map((e) => e.type), ["speech_start", "discard"]);
  assert.ok(d.noiseFloor > -30); // the new, louder background
  // a command over the new background still counts
  const next = run(d, [[-25, 2000], [-10, 1000], [-25, 1500]], 6500);
  assert.deepEqual(next.map((e) => e.type), ["speech_start", "speech_end"]);
});

test("music already playing when listening starts is learned as background", () => {
  const d = new SpeechDetector();
  assert.deepEqual(run(d, [[-35, 5000]]), []);
  assert.ok(Math.abs(d.noiseFloor + 35) < 1);
});
