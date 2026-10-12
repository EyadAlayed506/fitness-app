import assert from "node:assert/strict";
import { test } from "node:test";

import { matchWakeWord } from "./wakeWord.ts";

test("the wake word starts the utterance; the rest is the command, as said", () => {
  assert.deepEqual(matchWakeWord("Chat, 12 reps at 25 kilos.", "Chat"), { matched: true, command: "12 reps at 25 kilos." });
  assert.deepEqual(matchWakeWord("Hey chat note: my LEFT shoulder hurts", "Chat"), { matched: true, command: "note: my LEFT shoulder hurts" });
  assert.deepEqual(matchWakeWord("Chad, next set", "Chat"), { matched: true, command: "next set" }); // a common mishearing
  assert.deepEqual(matchWakeWord("Chat.", "Chat"), { matched: true, command: "" }); // just the wake word: the app asks "Yes?"
});

test("no wake word, or not at the start: ignored", () => {
  assert.equal(matchWakeWord("That was heavy, 12 reps", "Chat").matched, false); // "that" is not "chat"
  assert.equal(matchWakeWord("12 reps at 25 kilos", "Chat").matched, false);
  assert.equal(matchWakeWord("let's chat later", "Chat").matched, false);
  assert.equal(matchWakeWord("Thank you for watching.", "Chat").matched, false);
  assert.equal(matchWakeWord("", "Chat").matched, false);
});

test("another wake word, including two words", () => {
  assert.deepEqual(matchWakeWord("Coach, rest 30 seconds", "Coach"), { matched: true, command: "rest 30 seconds" });
  assert.deepEqual(matchWakeWord("okay gym buddy, next set", "Gym buddy"), { matched: true, command: "next set" });
  assert.equal(matchWakeWord("gym, next set", "Gym buddy").matched, false);
});
