// Run with: npm test   (Node's built-in test runner; no extra packages)
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCoachText, spans } from "./coachText.ts";

test("double asterisks make bold parts", () => {
  assert.deepEqual(spans("**1,314 kcal** left"), [
    { text: "1,314 kcal", bold: true },
    { text: " left", bold: false },
  ]);
  assert.deepEqual(spans("5 ** 2"), [
    { text: "5 ", bold: false },
    { text: "** 2", bold: false },
  ]);
});

test("a reply becomes titles, list items, text and gaps", () => {
  const lines = parseCoachText("You're on track 👍\n\n🍗 Food\n• **1,122 kcal** eaten\n- dinner next\n\n\n");
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["text", "gap", "title", "bullet", "bullet"],
  );
  assert.deepEqual(lines[3], { kind: "bullet", spans: [{ text: "1,122 kcal", bold: true }, { text: " eaten", bold: false }] });
});

test("a sentence that starts with an emoji is not a title", () => {
  assert.equal(parseCoachText("🎉 You reached your sleep goal five nights this week.")[0].kind, "text");
});
