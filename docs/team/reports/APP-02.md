# APP-02 — First bilingual journey (in progress)

| Field | Value |
|---|---|
| Owner | Samer |
| Branch | `samer/app-bilingual-foundation` (same branch as APP-01; committed locally, not pushed) |
| Base | `origin/merged_branch` @ `de689db` |
| Date | 2026-11-18 |
| Platform | Web app for the pilot (WEB-01) |
| Status | **Every app screen is bilingual, and the server answers in the app's language.** Exercises (names, muscles, how-to) are now Arabic too; only server error details stay English (on purpose). Hands-free voice removed. Arabic text not yet human-reviewed. |

## Update 2026-11-18 (part 7): exercises in Arabic, decisions, cleanups

**Decisions recorded:** Arabic exercise content is stored and served here (decided by us instead of waiting for
Alzoman). Western digits (0–9) and the Gregorian calendar in Arabic are **confirmed**. Web-only pilot is a group call.

**Exercises in Arabic** — storage: four optional columns on `exercises` (`name_ar`, `aliases_ar`,
`primary_muscles_ar`, `instructions_ar`), added automatically to existing databases and filled from
`app/seed/exercises.json` (matched by QR code, so ids and history don't change). The English `name` stays the
identity (QR codes, workout history, AI prompts, the coach's tools). With `Accept-Language: ar` the server returns
the Arabic name/muscles/steps (`ExercisePublic`) and uses `exercise_label()` wherever a name is shown: logged sets,
plan days, Progress lifts, weekly summary, machine settings and photos, coach action cards.
Search matches Arabic names and aliases, ignoring diacritics and alef/taa-marbuta/yaa spelling variants
("بنش", "سحب امامي", "السكوات بالبار"). All 48 exercises translated — **wording needs Nawaf/Eyad review**.

**Cleanups:** removed `expo-speech` and `expo-keep-awake` (unused); fixed the 6 date-dependent `test_assistant`
cases (they used the local date, the server uses UTC); screen readers now hear the option chips' group name and
each chip's hint, segmented tabs and the tab bar by their translated label. The food search's "… is not reachable
right now" note (USDA / Open Food Facts down) now comes in Arabic too. Bottom sheets: the scroll bar sits at the
sheet's edge instead of over the first pixels of text.

**Charts in Arabic:** the week strip, cards, legends and tables are right-to-left; the chart drawing area (time axis,
y-axis numbers) and number lines like the BMI scale stay left-to-right, as written in `mobile/DESIGN.md`.
**Decided:** chart time axes stay left-to-right in Arabic (not mirrored).

**Checks:** backend all pass (incl. 4 new exercise-language tests); app 50/50, typecheck, lint. Browser
(Arabic, demo account): Workouts shows Arabic exercise names; the how-to sheet shows Arabic muscles, steps and
alternatives; Progress lifts in Arabic.

## Update 2026-11-18 (part 6): remaining screens, hands-free removed, server text in Arabic

**Hands-free voice removed** (team decision): wake word, spoken commands, "hold to say your set" and spoken rest
announcements in the app; `POST /voice/interpret` and its service/tests on the server; README rows and
`docs/HANDS_FREE.md`. The coach's voice message (`/assistant/transcribe`) stays. **Open:** `expo-speech` and
`expo-keep-awake` are now unused but still in `package.json` (lockfile change to coordinate).

**Remaining screens translated:** Sleep (incl. WHOOP / Health Connect cards and setup steps), wellness points,
gyms, QR stickers, machine photo recognition, weight from a photo, rest-timer phone notification.
Sleep wording → Badr; machine/gym wording → Eyad.

**Server text in the app's language** — mechanism: the app sends `Accept-Language: ar|en` with every request
(and refetches when the language changes); `app/i18n.py` keeps it per request and gives `tr()`/`tr_count()`
with Arabic plurals. English is the default, so other clients see no change. Translated:

| Area | What |
|---|---|
| Coach | reply-language rule in the system prompt + app note; action cards; disclaimer; fallback replies; setup/connection problems |
| Today | suggestion titles, messages, reasons, sources, disclaimer |
| Plan | day titles / focus labels ("الجسم كامل"), split names and reasons, warnings, notes, plan disclaimer, capped-diet warning, projection note |
| Progress | insight titles, texts, cautions, "needs more data", group labels; weekly note |
| Points | rule names/descriptions, achievements; stored award reasons translated on read by rule |
| Other | alternative-exercise reasons, menu verdicts and note, gym session title/note; AI photo prompts ask for Arabic free text |

Kept English on purpose: error `detail` texts (the app recognises them and shows its own translation), IDs and
enum values, names stored in the database, tool errors/descriptions (only the model reads them).

**Still English (needs a decision): exercise names and how-to steps** (48 exercises in `app/seed/exercises.json`).
Names are stored in workout history and used by QR codes and search, so Arabic names need to be agreed
(Nawaf/Eyad) and a storage choice made (Alzoman: e.g. optional `name_ar`/`instructions_ar` columns served by
`Accept-Language`).

**Checks:** app 50/50 tests, typecheck, lint. Backend 288 passed; 6 fail, and the same 6 fail on the unchanged
code (date-dependent `test_assistant` cases: just after midnight the local day differs from UTC). New tests:
`tests/test_i18n.py` (language reaches threaded endpoints, plurals, Arabic menu/alternatives/AI prompt),
Arabic tests in test_assistant, test_recommendations, test_points. Browser (Arabic, demo account): Today
suggestion and its reasons, Workouts plan names, Progress patterns — all from the server in Arabic.
Not tested with a real AI model (no Ollama/Claude key here).

Screenshots: [Today](APP-02/server-today-ar.jpg) · [Why?](APP-02/server-why-ar.png) ·
[Workouts plan](APP-02/server-workouts-plan-ar.jpg) · [Patterns](APP-02/server-insights-ar.jpg)

## Update 2026-11-18 (part 5): Coach

- Translated the Coach tab: header (provider line), empty state with Arabic starter questions, "not ready" card,
  composer (placeholder, voice recording/transcribing states, send/record labels), questions-left line with Arabic
  plurals, clear-conversation dialog, action cards (Added/Removed/Undone, Open, Undo), the "looked at" sources line
  (tool IDs → translated labels), send/undo/voice errors.
- Chat bubbles mirror in Arabic: the user's bubble sits on the end side and its "tail" corner follows it
  (`borderBottomStart/EndRadius`); replies and bullets align right.
- **Reply language:** the server has no language setting, and its system prompt doesn't name one. Starter questions are
  sent in the app's language, and models usually answer in the language they are asked in, but this is **not
  guaranteed**. **Request to Nawaf:** add a rule to the prompt ("answer in the language of the user's message") or an
  optional `language` field on `POST /assistant/messages`. Action summaries ("Added Banana (118 g) to breakfast"),
  the disclaimer and the "not ready" explanation are server text, still English.
- **Not tested with a real model:** no Ollama running and no Claude key on this machine. The "not ready" card was
  checked live. The chat layout was checked with a **clearly labelled sample conversation** injected in the browser
  only (a patched `fetch` for one request, removed afterwards; no code or data changed), in Arabic and English.
- Checks: **96/96** unit tests, typecheck, lint, web export.

Screenshots: [not ready (live)](APP-02/coach-not-ready-ar.jpg) · [chat layout, sample data](APP-02/coach-sample-ar.png) ·
[English, sample data](APP-02/coach-sample-en.jpg)

## Update 2026-11-18 (part 4): Progress

- Translated: Progress tab (Week, Body, Food, Strength views), the weekly summary (training days, sessions,
  lifts, sleep, weight goal, points, planned vs done), patterns (insights: headings, strength badges, empty
  states), plan cards (BMI, daily calories, diet options), body weight / projection / calories / macros / lift /
  volume charts, measurement comparison and form, chart readout and table.
- Server names translated in the app with a fallback (`trOr`): chart series (macros, body regions, diet options),
  measurement fields, weekly record badges ("Heaviest weight yet").
- **Fixed for Arabic:** the BMI scale (bars mirrored but marker and numbers didn't — the marker would have
  pointed at the wrong zone) is now a left-to-right number line; chart drawing area kept left-to-right (outer
  date labels were cut off); x-axis label count now depends on label length (Arabic month names overlapped);
  table numbers sit on the end side.
- Browser check (demo account, 10 weeks of data, 375×812): Week, Body (BMI scale, diet options), Strength
  (chart, tap readout) in Arabic; Strength in English unchanged. Signed numbers ("−250") measured in the
  rendered page: correct order.
- Checks: **96/96** unit tests, typecheck, lint, web export.
- **Still English in Progress:** the Sleep view (`SleepChart`, Badr's area), and server text — insight titles,
  explanations and cautions, the projection note, plan disclaimer and diet warnings, weekly notes.

Screenshots: [week](APP-02/progress-week-ar.jpg) · [body](APP-02/progress-body-ar.jpg) ·
[chart](APP-02/progress-chart-ar.png) · [English](APP-02/progress-strength-en.jpg)

## Update 2026-11-18 (part 2): Workouts

- Translated: Workouts screen (today's session, week strip and plan, history, empty state, all sheets),
  logging a set (targets, last time, suggestion, steppers, kg/lb, effort, notes, "same again", next), editing and
  deleting sets, finished-workout detail, the session checklist, rest timer, the "workout in progress" bar,
  plan editor, exercise how-to and alternatives, QR scanner, exercise search. Undo toasts and confirm dialogs too.
- Muscle groups and exercise categories from the server are shown translated (`idLabel`, falls back to the ID for new ones).
- Rest timer panel and the open day's exercise list use start/end spacing, so they mirror in Arabic.
- Browser check (Arabic, 375×812, local backend, throwaway account): start today's session → log a set
  (toast, counter, rest timer, sets list) → close → active card → discard with confirm dialog → empty history.
  Ranges like `10-15` and the `−15` timer button display in the right order. English re-checked: unchanged.
- Checks: **95/95** unit tests, typecheck, lint, web export.
- **Still English in Workouts:** hands-free voice (the speech recogniser and spoken replies are English-only;
  needs a decision before translating its labels), weight-from-a-photo helper, machine-settings card (`GymParts`,
  Eyad), and server text (exercise names and instructions, plan explanation and notes, focus labels).
- Arabic users can't search exercises in Arabic yet (names are English in the library); the empty-search hint says so.

## Update 2026-11-18 (part 3): Food

- Translated: Food tab (day summary, meals, copy yesterday's meal, previous/next day), food search (recent,
  frequent, in-app and online results), food detail (amount, unit, meal, per-100 table and sub-nutrients),
  editing/removing entries, custom food form, and the restaurant-menu scanner. Undo toasts too.
- Food units (`g`, `tbsp`, `fl_oz`, …) are shown translated via `unitLabel`; the unit IDs sent to the API are unchanged.
- **Arabic food search works**: "موز" finds Saudi products in Open Food Facts, so the Arabic search hint uses
  Arabic examples. Product names stay as the database has them.
- **Mixed-script fix (both languages):** `Txt` now aligns with the page direction. Before, an Arabic product name
  in the English app sat on the right while its details sat on the left (and the reverse for English exercise
  names in Arabic).
- Browser check (Arabic, 375×812, local backend): empty day → search "موز" → product detail → add to breakfast
  (toast with undo, ring, meal total, entry row). English re-checked.
- Checks: **96/96** unit tests, typecheck, lint, web export.
- **Still English in Food:** server/AI text — online-database warnings ("USDA … not reachable"), the menu
  scanner's estimate note, dish descriptions and verdicts.
- Minor, existing in both languages: in bottom sheets, the scroll indicator overlaps the first few pixels of
  text on the outer edge (right in English, left in Arabic). Not fixed.

Screenshots: [food](APP-02/food-ar.jpg) · [Arabic search](APP-02/food-search-arabic-ar.jpg) ·
[detail](APP-02/food-detail-ar.jpg) · [logged](APP-02/food-logged-ar.jpg) ·
[English with an Arabic product](APP-02/food-en-mixed-script.jpg)

Workouts screenshots: [workouts](APP-02/workouts-ar.jpg) · [log a set](APP-02/log-set-ar.jpg) ·
[active workout](APP-02/active-workout-ar.jpg) · [discard dialog](APP-02/discard-dialog-ar.jpg) ·
[English](APP-02/workouts-en.jpg)

## What changed for users

- **Navigation:** tab bar and screen titles translated. Tab labels were cut off at the bottom on the web
  (both languages, existing bug): fixed.
- **Sign-up:** translated, with the language switch. A rejected email (server 422) now says
  "That email address doesn't look right" instead of a raw validation message / "error (422)".
- **Onboarding (4 steps) and the profile form:** all labels, options, hints, validation messages and the live plan
  preview. Weekday buttons show one Arabic letter each (full name read by screen readers); day lists use Arabic
  names and the Arabic comma; "3 أيام / 11 يوماً" use correct Arabic plural forms.
- **Today:** greeting, date, calorie ring, macros, sleep summary, weigh-in, first-week checklist, today's-plan card.
- **Profile/settings:** translated, with a **Language** section (switch available after login).
- **Everywhere:** numbers, dates, durations ("7 س 05 د"), "x days ago", units (كغ/سم) and weekday names follow
  the chosen language through `format.ts`; dialogs (Cancel/OK/Close) and API error messages on every screen
  (`errorMessage`) are translated; back/forward arrows and chevrons mirror in Arabic.
- **IDs unchanged:** the unit sent with a weigh-in is still `kg`/`lb`; option values (`moderate`, `lose`, …) are unchanged.

## Code (on top of APP-01)

| File | Change |
|---|---|
| `lib/i18n/current.ts` (new) | Current language for non-component code: `tr`, `trCount`, `errorTextFor`, `onLanguageChange`. |
| `lib/i18n/core.ts` | `translateCount` (plural forms via `Intl.PluralRules`), invalid-email error mapping. |
| `lib/i18n/en.ts`, `ar.ts` | ~230 keys. |
| `lib/format.ts` | Language-aware `fmt`, dates, durations, `timeAgo`, weekday arrays (refilled in place), `units().wLabel/lLabel`. |
| `lib/query.ts` | `errorMessage` translated (used by ~36 call sites). |
| `lib/confirm.ts` | Default OK label translated. |
| `components/ui.tsx` | `Icon` (mirrors directional icons), `Screen` header without letter spacing in Arabic, translated Back/Close/Cancel/Loading/stepper labels. |
| `components/ProfileForm.tsx`, `DayPicker.tsx`, `TodayCard.tsx`, `FirstWeek.tsx`, `MacroBars.tsx` | Translated; problems kept as keys. |
| `app/_layout.tsx`, `(tabs)/_layout.tsx`, `signup.tsx`, `onboarding.tsx`, `(tabs)/home.tsx`, `(tabs)/profile.tsx` | Translated. |
| `lib/format.test.ts` (new), `lib/i18n.test.ts` | +9 tests. |

Still no new dependencies; `package.json`, `app.json`, `eas.json`, `api.ts` untouched.

## Checks

| Check | Result |
|---|---|
| Unit tests (`src/lib/*.test.ts`, compiled with the project's `tsc`, Node 20) | **94/94** pass (72 original + 22 new). `npm test` itself needs Node ≥22.6 — not run here. |
| `npx tsc --noEmit` | Pass |
| `npx expo lint` | Pass |
| `npx expo export -p web` | Pass |
| Browser 375×812, **real local backend** (`uv run fastapi dev`, demo account from `app.demo`) | Arabic: wrong password (live 401) → Arabic message; login → Today; Profile; switch to English and back. New account: sign-up (invalid email → Arabic message), 4 onboarding steps incl. validation, Today with first-week checklist. English Today/Profile checked for regressions. Screenshots in [APP-02/](APP-02/). |
| Real phones, Safari, Firefox | **Not run** |

## What's left

Every screen and all server text a user sees is bilingual. Left:

| What | Who |
|---|---|
| Review the Arabic wording | Nawaf (overall, coach), Eyad (exercises, machines, gyms), Badr (sleep, points) |
| Try the coach and photo features with a real AI model (Arabic replies and notes not seen live) | whoever has Ollama or a Claude key |
| Real phones, Safari, Firefox | Samer + testers |
| Web-only pilot | group call |
| Push the branch and open the PR (mention the `package.json`/lockfile change) | Samer |

Kept English on purpose: server error `detail` texts. The app shows its own translation for the ones it knows;
an unknown error would show in English.

## Found along the way

- Choice chips (`Chips`) exposed `role=radio` with **no accessible name** in the web build — fixed in part 7.
- Tab labels were clipped on the web in both languages — fixed (`flexShrink: 0`, `lineHeight`).
- Bottom sheets: the scroll bar covered a few pixels of text at the edge (both languages) — fixed in part 7.

## Contracts / requests

Same as APP-01 (optional error `code` — now also `invalid_email`; Arabic exercise content location and digits
now decided — see part 7), plus: **how server-generated text gets a language** — done: the app sends
`Accept-Language: ar|en` on every request; the server picks text by it and keeps IDs unchanged (part 6).
