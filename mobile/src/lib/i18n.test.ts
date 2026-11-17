// Run with: npm test   (Node's built-in test runner; no extra packages)
import assert from "node:assert/strict";
import { test } from "node:test";

import { ar } from "./i18n/ar.ts";
import { directionOf, errorKey, intlLocale, isLanguage, pickLanguage, translate, translateCount, urlIn } from "./i18n/core.ts";
import { en } from "./i18n/en.ts";

test("a saved choice wins over the device language", () => {
  assert.equal(pickLanguage("en", ["ar-SA"]), "en");
  assert.equal(pickLanguage("ar", ["en-US"]), "ar");
});

test("without a saved choice, an Arabic device starts in Arabic, anything else in English", () => {
  assert.equal(pickLanguage(null, ["ar-SA", "en-US"]), "ar");
  assert.equal(pickLanguage(null, ["AR"]), "ar");
  assert.equal(pickLanguage(null, ["fr-FR", "ar-EG"]), "en", "only the first (preferred) language counts");
  assert.equal(pickLanguage(null, []), "en");
});

test("a corrupted saved value is ignored instead of breaking the app", () => {
  assert.equal(pickLanguage("arabic", ["en-US"]), "en");
  assert.equal(isLanguage("ar"), true);
  assert.equal(isLanguage("العربية"), false);
});

test("Arabic is right-to-left, English left-to-right", () => {
  assert.equal(directionOf("ar"), "rtl");
  assert.equal(directionOf("en"), "ltr");
});

test("numbers and dates use Western digits and the Gregorian calendar in Arabic", () => {
  const n = new Intl.NumberFormat(intlLocale("ar")).format(1234.5);
  assert.match(n, /^[0-9.,٬٫\s]+$/, `expected Western digits, got ${n}`);
  const d = new Intl.DateTimeFormat(intlLocale("ar"), { year: "numeric" }).format(new Date(2026, 10, 18));
  assert.match(d, /2026/);
});

test("placeholders are filled in; unknown placeholders stay visible", () => {
  assert.equal(translate(en, "en", "server.current", { url: "http://x" }), "Server: http://x");
  assert.equal(translate(en, "en", "errors.generic", {}), "Something went wrong ({status}). Please try again.");
});

test("in Arabic, inserted values are isolated so a URL or number doesn't scramble the sentence", () => {
  const s = translate(ar, "ar", "server.current", { url: "http://10.0.0.2:8000" });
  assert.equal(s, "الخادم: ⁨http://10.0.0.2:8000⁩");
});

test("a missing Arabic text falls back to English rather than showing the key", () => {
  const partial = { ...ar } as Record<string, string>;
  delete partial["login.title"];
  assert.equal(translate(partial as typeof ar, "ar", "login.title"), "Welcome back");
});

test("both dictionaries have exactly the same keys", () => {
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
});

test("known API errors map to translated messages; identifiers are matched, never shown", () => {
  assert.equal(errorKey({ status: 0, message: "Can't reach the server at x" }), "errors.network");
  assert.equal(errorKey({ status: 401, message: "Wrong email or password" }), "errors.wrongCredentials");
  assert.equal(errorKey({ status: 401, message: "Your session expired. Please log in again." }), "errors.sessionExpired");
  assert.equal(errorKey({ status: 403, message: "This account no longer has access to the pilot" }), "errors.accessRevoked");
  assert.equal(errorKey({ status: 403, message: "Sign-up is closed for this pilot" }), "errors.signupClosed");
  assert.equal(errorKey({ status: 409, message: "An account with this email already exists" }), "errors.emailTaken");
});

test("the server's invalid-email answer (422) gets its own message", () => {
  const message = "email: value is not a valid email address: An email address must have an @-sign.";
  assert.equal(errorKey({ status: 422, message }), "errors.invalidEmail");
});

test("an optional error code from the server is preferred over matching the English text", () => {
  assert.equal(errorKey({ status: 401, message: "anything", code: "wrong_credentials" }), "errors.wrongCredentials");
});

test("the server address is taken whole from a connection error, without the sentence's full stop", () => {
  assert.equal(urlIn("Can't reach the server at http://192.168.1.10:8000. Is the backend running?"), "http://192.168.1.10:8000");
  assert.equal(urlIn("Can't reach the server at https://fit.example.com/x."), "https://fit.example.com/x");
  assert.equal(urlIn("no address here"), "");
});

test("counts pick the right plural form in each language", () => {
  const strip = (s: string) => s.replace(/[⁨⁩]/g, "");
  assert.equal(translateCount(en, "en", "plan.daysPerWeek", 1), "1 day a week");
  assert.equal(translateCount(en, "en", "plan.daysPerWeek", 4), "4 days a week");
  assert.equal(strip(translateCount(ar, "ar", "plan.daysPerWeek", 1)), "يوم واحد في الأسبوع");
  assert.equal(strip(translateCount(ar, "ar", "plan.daysPerWeek", 2)), "يومان في الأسبوع");
  assert.equal(strip(translateCount(ar, "ar", "plan.daysPerWeek", 5)), "5 أيام في الأسبوع");
  assert.equal(strip(translateCount(ar, "ar", "plan.daysPerWeek", 11)), "11 يوماً في الأسبوع");
});

test("every Arabic count text has all six plural forms", () => {
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    if (en[key].includes("|")) assert.equal(ar[key].split("|").length, 6, key);
  }
});

test("unknown errors have no specific message", () => {
  assert.equal(errorKey({ status: 500, message: "boom" }), null);
  assert.equal(errorKey({ status: 404, message: "Workout not found" }), null);
});
