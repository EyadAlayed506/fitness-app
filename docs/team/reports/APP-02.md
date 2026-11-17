# APP-02 — First bilingual journey (in progress)

| Field | Value |
|---|---|
| Owner | Samer |
| Branch | `samer/app-bilingual-foundation` (same branch as APP-01; local, not committed or pushed) |
| Base | `origin/merged_branch` @ `de689db` |
| Date | 2026-11-18 |
| Platform | Web app for the pilot (WEB-01) |
| Status | **Partly done.** Sign-up → onboarding → Today → Profile → **Workouts** work in Arabic and English against the real local backend. Food, progress, coach, sleep screens still English. Arabic text not yet human-reviewed. |

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

Screenshots: [workouts](APP-02/workouts-ar.jpg) · [log a set](APP-02/log-set-ar.jpg) ·
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

## Still English (next)

| Area | Where | Owner of meaning |
|---|---|---|
| Server-generated text | today's suggestion titles/messages/reasons, plan disclaimer, routine split and day titles ("Full body"), exercise names | **Alzoman / Nawaf** — needs a decision: server returns text per `lang`, or stable IDs the app translates |
| Workouts (rest of) | `HandsFree`, `SetHelpers` (voice + weight from photo) — **done otherwise** | Samer; Nawaf for voice language |
| Food | `food.tsx`, `FoodParts`, `MacroText` | Samer |
| Progress | `progress.tsx`, `WeeklySummary`, `Insights`, `charts` | Samer |
| Sleep / points | `SleepParts` (quality, "In range", goal "7 h"), `SleepDashboard`, `WhoopCard`, `HealthConnectCard`, `PointsParts` | Badr (meanings) |
| Coach | `coach.tsx` + reply language | Nawaf |
| Machine photos / gyms | `ExercisePhoto`, `SnapParts`, `GymParts`, `gyms.tsx` | Eyad (names) |

## Found along the way

- Choice chips (`Chips`) expose `role=radio` with **no accessible name** in the web build (screen readers can't
  read the options). Existing issue, not fixed here.
- Tab labels were clipped on the web in both languages — fixed (`flexShrink: 0`, `lineHeight`).

## Contracts / requests

Same as APP-01 (optional error `code` — now also `invalid_email`; Arabic exercise content location; digits
decision), plus: **how server-generated text gets a language** (suggestions, plan disclaimer, routine names).
Proposal: the app sends `Accept-Language: ar|en` on every request; the server picks text by it and keeps IDs unchanged.
