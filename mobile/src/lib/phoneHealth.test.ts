// Run with: npm test   (Node's built-in test runner; no extra packages)
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appleSleepSessions,
  appleStepsDays,
  hcStepsDays,
  localDate,
  stepsRange,
  type AppleSleepSample,
} from "./phoneHealth.ts";

test("Health Connect day buckets: a day with no data is left out, a real 0 is kept", () => {
  const days = hcStepsDays([
    { startTime: "2026-11-21T00:00", result: { COUNT_TOTAL: 0, dataOrigins: [] } }, // no data (the library says 0)
    { startTime: "2026-11-22T00:00", result: { COUNT_TOTAL: 0, dataOrigins: ["android"] } }, // a real zero
    { startTime: "2026-11-23T00:00", result: { COUNT_TOTAL: 8412.0, dataOrigins: ["android", "com.sec.android.app.shealth"] } },
  ]);
  assert.deepEqual(days, [
    { date: "2026-11-22", steps: 0 },
    { date: "2026-11-23", steps: 8412 },
  ]);
});

test("Apple daily statistics: no sum or no sources means no data", () => {
  const day = (d: number) => new Date(2026, 10, d); // local midnight, 2026-11-d
  const days = appleStepsDays([
    { startDate: day(21), sources: [] },
    { startDate: day(22), sumQuantity: { quantity: 0 }, sources: [] },
    { startDate: day(23), sumQuantity: { quantity: 5004.4 }, sources: [{ name: "iPhone", bundleIdentifier: "com.apple.health" }] },
  ]);
  assert.deepEqual(days, [{ date: "2026-11-23", steps: 5004 }]);
});

test("steps range starts at local midnight: 30 days the first time, then 7", () => {
  const now = new Date(2026, 10, 23, 15, 30);
  const first = stepsRange(null, now);
  assert.equal(first.start.getHours(), 0);
  assert.equal(localDate(first.start), "2026-10-25"); // today + 29 days before it
  assert.equal(first.end, now);
  assert.equal(localDate(stepsRange("2026-11-23T08:00:00Z", now).start), "2026-11-17");
});

const watch = { name: "Apple Watch", bundleIdentifier: "com.apple.health.ABC" };
const phone = { name: "iPhone", bundleIdentifier: "com.apple.health.XYZ" };
const s = (uuid: string, value: number, start: string, end: string, source = watch): AppleSleepSample => ({
  uuid,
  value,
  startDate: new Date(start),
  endDate: new Date(end),
  sourceRevision: { source },
});

test("Apple sleep samples become one session per night per source, with Health Connect stage numbers", () => {
  const sessions = appleSleepSessions([
    s("w1", 2, "2026-11-22T20:30:00Z", "2026-11-22T20:50:00Z"), // awake -> 1
    s("w2", 3, "2026-11-22T20:50:00Z", "2026-11-22T23:20:00Z"), // core -> light 4
    s("w3", 4, "2026-11-22T23:20:00Z", "2026-11-23T01:00:00Z"), // deep -> 5
    s("w4", 5, "2026-11-23T01:00:00Z", "2026-11-23T04:15:00Z"), // REM -> 6
    s("p1", 0, "2026-11-22T20:00:00Z", "2026-11-23T04:30:00Z", phone), // the phone's "in bed" only
  ]);
  assert.equal(sessions.length, 2);
  const w = sessions.find((x) => x.app === watch.bundleIdentifier)!;
  assert.equal(w.id, "w1");
  assert.equal(w.start_time, "2026-11-22T20:30:00.000Z");
  assert.equal(w.end_time, "2026-11-23T04:15:00.000Z");
  assert.deepEqual(w.stages.map((x) => x.stage), [1, 4, 5, 6]);
  const p = sessions.find((x) => x.app === phone.bundleIdentifier)!;
  assert.deepEqual(p.stages, []); // in bed is not sleep: no stages, the server uses bedtime to wake-up
  assert.equal(p.id, "p1");
});

test("a gap of more than an hour starts a new session (a nap later in the day)", () => {
  const sessions = appleSleepSessions([
    s("n1", 1, "2026-11-22T21:00:00Z", "2026-11-23T04:00:00Z"),
    s("nap", 1, "2026-11-23T11:00:00Z", "2026-11-23T11:40:00Z"),
  ]);
  assert.deepEqual(sessions.map((x) => x.id), ["n1", "nap"]);
  assert.deepEqual(sessions[0].stages.map((x) => x.stage), [2]); // asleep, no stage detail
});

test("unknown sleep values are ignored rather than guessed", () => {
  const sessions = appleSleepSessions([s("x", 99, "2026-11-22T21:00:00Z", "2026-11-23T04:00:00Z")]);
  assert.deepEqual(sessions, []);
});
