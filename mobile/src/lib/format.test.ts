// Run with: npm test   (Node's built-in test runner; no extra packages)
// Display helpers follow the app's language; values meant for the server don't.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { WEEKDAYS, WEEKDAYS_MIN, WEEKDAYS_SHORT, dayList, duration, fmt, hoursMinutes, shortDate, timeAgo, units } from "./format.ts";
import { setCurrentLanguage } from "./i18n/current.ts";

// strip the invisible direction marks Arabic placeholders are wrapped in
const plain = (s: string) => s.replace(/[⁨⁩]/g, "");

afterEach(() => setCurrentLanguage("en"));

test("English output is unchanged", () => {
  assert.equal(hoursMinutes(425), "7 h 05 min");
  assert.equal(hoursMinutes(45), "45 min");
  assert.equal(duration("2026-11-18T10:00:00Z", "2026-11-18T11:15:00Z"), "1 h 15 min");
  assert.equal(dayList([2, 0]), "Mon, Wed");
  assert.equal(units("metric").weight(72.5), "72.5 kg");
  assert.equal(fmt(1234), "1,234");
});

test("Arabic durations, weekdays and units", () => {
  setCurrentLanguage("ar");
  assert.equal(plain(hoursMinutes(425)), "7 س 05 د");
  assert.equal(plain(hoursMinutes(45)), "45 د");
  assert.equal(dayList([2, 0]), "الاثنين، الأربعاء");
  assert.equal(units("metric").weight(72.5), "72.5 كغ");
  assert.equal(units("imperial").length(2.54), "1 إنش");
});

test("weekday names switch with the language, and back", () => {
  setCurrentLanguage("ar");
  assert.equal(WEEKDAYS[4], "الجمعة");
  assert.equal(WEEKDAYS_MIN[6], "ح");
  setCurrentLanguage("en");
  assert.equal(WEEKDAYS[4], "Friday");
  assert.equal(WEEKDAYS_SHORT[0], "Mon");
});

test("unit IDs sent to the API stay the same in Arabic", () => {
  setCurrentLanguage("ar");
  assert.equal(units("metric").w, "kg");
  assert.equal(units("imperial").l, "in");
  assert.equal(units("imperial").wLabel, "رطل");
});

test("Arabic numbers and dates use Western digits", () => {
  setCurrentLanguage("ar");
  assert.match(fmt(1234), /^1.?234$/);
  assert.match(shortDate("2026-11-18"), /18/);
  assert.doesNotMatch(shortDate("2026-11-18"), /[٠-٩]/);
});

test("'days ago' uses Arabic plural forms", () => {
  setCurrentLanguage("ar");
  const daysAgo = (n: number) => plain(timeAgo(new Date(Date.now() - n * 86_400_000).toISOString()));
  assert.equal(daysAgo(2), "قبل يومين");
  assert.equal(daysAgo(5), "قبل 5 أيام");
  assert.equal(daysAgo(14), "قبل 14 يوماً");
  setCurrentLanguage("en");
  assert.equal(timeAgo(new Date(Date.now() - 5 * 86_400_000).toISOString()), "5 days ago");
});
