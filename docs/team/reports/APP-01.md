# APP-01 — Bilingual app foundation

| Field | Value |
|---|---|
| Owner | Samer |
| Branch | `samer/app-bilingual-foundation` (local, not pushed) |
| Base | `origin/merged_branch` @ `de689db` ("Fix closed sign-up answering 422 instead of 403") — same commit as `origin/alzoman` |
| Date | 2026-11-18 |
| Platform | Web app for the pilot (WEB-01, group confirmation pending). Native kept working. |
| Status | Foundation + one translated screen (Login) done and checked in a browser. Arabic text **not yet human-reviewed**. |

## What changed for users

- Login screen has an `English | العربية` switch. Arabic switches the page to right-to-left immediately
  (logo, text, error icon and buttons mirror). The choice is remembered after reload.
- First visit picks Arabic when the browser's first language is Arabic, else English.
- Login errors are translated: empty fields, can't reach server, wrong email/password, access revoked,
  session expired, sign-up closed, email taken. An error already on screen re-translates when the language switches.
- Empty email/password is caught before calling the server (previously the server's
  `username: Field required` was shown). The email is trimmed before login.

## Code

| File | Purpose |
|---|---|
| `mobile/src/lib/i18n/en.ts`, `ar.ts` | Dictionaries. `ar` must have every key (typecheck). |
| `mobile/src/lib/i18n/core.ts` | Pure logic: language choice, direction, Intl locale, `{placeholder}` filling with Unicode isolates in Arabic, API error → message key. |
| `mobile/src/lib/i18n/index.tsx` | `LanguageProvider`, `useI18n()` (`t`, `errorText`, `lang`, `dir`, `locale`, `setLanguage`), `useLanguage()`. Persists via existing `storage`; sets `<html lang dir>` on the web; expo-router `LocaleProvider` for navigation direction. |
| `mobile/src/components/LanguageSwitch.tsx` | The switch, built on the existing `Segmented`. |
| `mobile/src/app/_layout.tsx` | Wraps the app in `LanguageProvider`. |
| `mobile/src/app/login.tsx`, `components/AuthScreen.tsx` | Translated; `AuthScreen` gets a `top` slot for the switch. |
| `mobile/src/components/ui.tsx` | `Txt` removes letter spacing in Arabic (it breaks joined letters). |
| `mobile/src/lib/i18n.test.ts` | 13 tests. |
| `mobile/DESIGN.md` | Design + language/RTL rules. |

**No new dependencies.** `package.json`, lockfile, `app.json`, `eas.json` and `api.ts` are untouched.
`expo-localization` was considered (Expo 57 docs recommend it), but on the web it only reads the browser
language, which `navigator.languages` already gives; it can be added later for native builds.

## Decision: localization approach

- Own small typed dictionaries + `Intl` (works on web and Hermes), following the Expo localization guide's
  web advice (`dir`/`lang` at the root) — https://docs.expo.dev/guides/localization/ (fetched 2026-11-18).
- Direction on the web comes from `<html dir>`; react-native-web mirrors `row` layouts and logical
  (`start/end`) styles from it. Native direction applies after app restart (documented, not needed for the web pilot).
- Arabic numbers/dates: Western digits + Gregorian calendar — **needs Nawaf's confirmation**.

## Checks

| Check | Command / procedure | Result |
|---|---|---|
| Baseline (before changes) | typecheck, lint, tests | Pass; **72/72** tests |
| Unit tests | `src/lib/*.test.ts` | **85/85** pass (72 existing + 13 new). Run on Node 20 by compiling with the project's `tsc`, because `npm test` needs Node ≥22.6 (CI uses 22). `npm test` itself not run here. |
| Typecheck | `npx tsc --noEmit` | Pass |
| Lint | `npx expo lint` | Pass |
| Web build | `npx expo export -p web` | Pass (first ever local export of this app, before and after the change) |
| Browser, phone size 375×812 | `expo start --web`, Login: switch EN↔AR, empty submit, submit with backend off, reload | Pass — see screenshots below. Only console errors: connection refused to the (deliberately stopped) backend. |
| Live login against backend | — | **Not run** (backend not started; `uv` setup not done in this session) |
| Real phones / Safari / Firefox | — | **Not run** |

Screenshots: [English](APP-01/login-en.jpg) · [Arabic](APP-01/login-ar.jpg) ·
[Arabic error](APP-01/login-ar-error.png) · [error after switching to English](APP-01/login-en-error.jpg)

## Screen and string inventory

Approximate English UI strings per file (regex count of literal texts; real count is higher — template strings,
`format.ts` helpers and alerts are partly missed). **Translated so far: Login + server setting.**

| Area (journey) | Files (approx. strings) | Domain owner for meaning |
|---|---|---|
| Login / sign-up / onboarding | `login` ✅, `AuthScreen` ✅, `signup` (6), `onboarding` (12), `ProfileForm` (33) | Alzoman (account errors) |
| Navigation | tab titles in `(tabs)/_layout` (6), stack titles in `_layout` (4) | Samer |
| Today / home | `home` (18), `TodayCard` (3), `FirstWeek` (7), `Insights` (4), `WeeklySummary` (15) | Samer |
| Workouts | `workouts` (50), `WorkoutParts` (42), `SetHelpers` (13), `RestTimer` (9), `PlanCards` (8), `ScheduleEditor` (6), `WorkoutSession` (3), `ExerciseInfo` (10), `HandsFree` (15) | Samer; Nawaf reviews coaching content |
| Exercise library content | `app/seed/exercises.json`: 48 exercises × name, aliases, muscles, 3–5 instructions (server data) | Samer + Nawaf; **needs a data-model decision with Alzoman** (where Arabic name/instructions live) |
| Machine photo / QR / gyms | `ExercisePhoto` (16), `SnapParts` (10), `GymParts` (22), `gyms` (21), `qr-stickers` | Eyad (machine names/mapping) |
| Food | `food` (14), `FoodParts` (31), `MacroBars` | Samer; external food names stay as-is |
| Progress | `progress` (28), `charts` | Samer |
| Sleep / health | `sleep` (7), `SleepDashboard` (19), `SleepParts` (23), `WhoopCard` (16), `HealthConnectCard` (9) | Badr |
| Coach | `coach` (12) + server replies | Nawaf (reply language is server-side) |
| Profile / settings / points | `profile` (21), `points` (4), `PointsParts` | Samer |
| Shared | `ui.tsx` (dialogs, empty states), `lib/format.ts` (dates, "min ago", weekdays, units), `lib/confirm.ts`, `lib/api.ts` (client error texts) | Samer |

## Contracts / requests to other owners

- **Alzoman:** CONTRACTS.md §1 open item — please add an optional `code` next to `detail` for auth errors
  (`wrong_credentials`, `access_revoked`, `signup_closed`, `email_taken`, `session_expired`). The app already
  prefers `code` when present and falls back to matching today's English `detail` texts, so this is backward compatible.
  Also: where should Arabic exercise names/instructions live (seed fields vs. app-side dictionary)?
- **Nawaf:** confirm Western digits in Arabic; how the chosen language reaches the coach (proposal: send `lang`
  with each coach request).
- **Arabic speaker (any teammate):** review `mobile/src/lib/i18n/ar.ts` in the running Login screen.

## Limitations

- Only Login is translated; the rest of the app is still English (Arabic layout direction applies everywhere, so
  untranslated screens will look mixed until APP-02).
- Existing physical styles (`marginLeft`, `textAlign: "left"`, chevron icons) in other screens are not yet mirrored.
- Phones: the direction changes only after restart; not tested on a native build.

## Next

APP-02: translate the core journey (navigation, sign-up, onboarding, home, workouts) and move `format.ts` to the
chosen locale; settle the exercise-content data decision with Alzoman. Open a PR to `merged_branch` once you
approve publishing (push access to the repo not yet verified).
