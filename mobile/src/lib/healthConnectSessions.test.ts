// Run with: npm test   (Node's built-in test runner; no extra packages)
import assert from "node:assert/strict";
import { test } from "node:test";

import { addResults, batches, syncSummary, syncWindow, toPayload } from "./healthConnectSessions.ts";

test("a sleep record becomes what the server expects", () => {
  const p = toPayload({
    startTime: "2026-10-18T20:30:00Z",
    endTime: "2026-10-19T04:15:00Z",
    startZoneOffset: { totalSeconds: 10800 },
    stages: [{ startTime: "2026-10-18T20:30:00Z", endTime: "2026-10-18T21:00:00Z", stage: 4 }],
    metadata: { id: "abc", dataOrigin: "com.sec.android.app.shealth" },
  });
  assert.deepEqual(p, {
    id: "abc",
    start_time: "2026-10-18T20:30:00Z",
    end_time: "2026-10-19T04:15:00Z",
    zone_offset_seconds: 10800,
    stages: [{ start_time: "2026-10-18T20:30:00Z", end_time: "2026-10-18T21:00:00Z", stage: 4 }],
    app: "com.sec.android.app.shealth",
  });
});

test("without a time zone or id the phone's own zone and the times are used", () => {
  const start = "2026-10-18T20:30:00Z";
  const p = toPayload({ startTime: start, endTime: "2026-10-19T04:15:00Z", startZoneOffset: null });
  assert.equal(p.zone_offset_seconds, -new Date(start).getTimezoneOffset() * 60);
  assert.equal(p.id, "2026-10-18T20:30:00Z/2026-10-19T04:15:00Z");
  assert.deepEqual(p.stages, []);
  assert.equal(p.app, "");
});

test("first sync reads 30 days, later ones the last week", () => {
  const now = new Date("2026-10-19T08:00:00Z");
  assert.deepEqual(syncWindow(null, now), { startTime: "2026-09-19T08:00:00.000Z", endTime: "2026-10-19T08:00:00.000Z" });
  assert.equal(syncWindow("2026-10-18T08:00:00Z", now).startTime, "2026-10-12T08:00:00.000Z");
});

test("sessions are sent in batches and the results added up", () => {
  assert.deepEqual(batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(batches([], 2), []);
  const r = addResults({ imported: 1, updated: 2, replaced_manual: 0, skipped: 1 }, { imported: 3, updated: 0, replaced_manual: 1, skipped: 0 });
  assert.deepEqual(r, { imported: 4, updated: 2, replaced_manual: 1, skipped: 1 });
  assert.equal(syncSummary(r), "Health Connect synced: 4 new, 2 updated, 1 typed-in night replaced");
});
