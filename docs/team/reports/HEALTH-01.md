# HEALTH-01 — Devices, access and health data semantics

| Field | Value |
|---|---|
| Owner | Badr (health integrations) |
| Branch | `badr/health-contract-device-spike` |
| Base | `origin/merged_branch` @ `3ce064540f65313b96372ebd679e239a09c53882` (2026-11-18, "Phone test handoff to Nawaf (APP-02)") |
| Session date | 2026-11-23 (planned window was Oct 25–26) |
| Status | **Code inspection, checks, contract draft and sample payloads done. Device matrix and live connector checks not done** (need Badr's phones and WHOOP account, section 4) |

## Schedule warning

HEALTH-01 was due Oct 26; the Nov 8 candidate and the Nov 8–14 pilot have passed. BE-01 and DELIVERY-OPTIONS
asked for the HealthKit status on Nov 5; this report answers it: **no HealthKit code exists**. WEB-01
(Nov 16) proposed a web-only pilot, which removes phone health sync for testers until phone builds return.
That decision is still marked "needs group confirmation" and decides what HEALTH-02 should be (section 6).

## What changed

| File | Purpose |
|---|---|
| `docs/team/HEALTH.md` | Health contract: current behaviour, canonical sleep/steps/recovery records, units, local-day rule, source precedence, availability codes, sync rules, real and proposed example payloads, open decisions |
| `docs/team/reports/HEALTH-01.md` | This report |

No app code changed. User-visible behaviour: none.

## Skills

Read from the HEALTH pack (not installed into the repo or any account): `fitness-health-sync` (applied
throughout: missing ≠ zero, idempotent sync, native-only evidence, no background sync) and
`verification-before-completion` (every claim below has a command or file reference). `test-driven-development`
and `systematic-debugging` were not needed: no logic changed and no check failed.

## Baseline checks (this session, Linux container, commit `3ce0645`)

| Check | Command | Result |
|---|---|---|
| Backend tests | `uv sync` then `uv run python -m pytest` | **299 passed** (59.8 s) |
| Mobile tests | `cd mobile && npm ci && npm test` | **50 passed**, 0 failed |
| Mobile lint | `npm run lint` | Pass, no warnings printed |
| Mobile typecheck | `npm run typecheck` | Pass |
| Sample payloads | Temporary pytest file calling the real API with the test database (removed afterwards) | Responses in HEALTH.md §7.1 |

Not run: a native Android or iOS build, anything on a phone, a real WHOOP account.

## 1. Current behaviour confirmed (from code and tests, not a device)

- **Android reads sleep only.** `healthConnect.ts` asks for `SleepSession` read permission and nothing else;
  `app.json` declares only `READ_SLEEP`. No steps anywhere in the app or server.
- **Apple Health: not started.** No HealthKit library, entitlement, usage text or `apple_health` source.
- **WHOOP: complete server-side flow** (OAuth, token refresh, sleep + stages + performance, recovery on the
  matching sleep, revoked login → 409 without logging the user out, WHOOP down → 502). Tested only against a
  fake WHOOP server.
- Repeat sync doesn't duplicate (by source + record id), imported nights replace manual ones, and the same
  Health Connect id in two accounts stays separate. All covered by existing tests.

## 2. Connector feasibility (checked 2026-11-23)

| Connector | Library / API | Fit with this app | Unknowns |
|---|---|---|---|
| Health Connect sleep | `react-native-health-connect` 4.1.3 (installed). Since v4 the Expo plugin ships inside the package | Already wired; typecheck passes against Expo 57 / RN 0.86 | No native build is recorded in any team report (APP-02's phone test used the web app); Health Connect only allows reading 30 days before the first permission grant |
| Health Connect steps | Same library: `StepsRecord` read permission + aggregate `COUNT_TOTAL` | Aggregate removes duplicates across apps by the user's priority list and returns nothing (not 0) when there's no data | Needs `READ_STEPS` in `app.json` (→ native rebuild); the docs' samples turn "no data" into 0, which we must not copy |
| Apple Health | `@kingstinct/react-native-healthkit` (v14 line; needs `react-native-nitro-modules`; has an Expo config plugin). Alternative: `react-native-health` | Statistics query gives a de-duplicated daily step sum; sleep via category samples | **Its plugin turns on the background-delivery entitlement by default — set `background: false`** (no background sync in scope). Compatibility with Expo 57 / RN 0.86 unverified. Apple never reveals whether read access was refused. Needs a signed build on the iPhone (decision 2) |
| WHOOP | API v2 (v1 retired). Scopes in use: `offline read:profile read:sleep read:recovery` | Matches current code. API has no step count | Needs a WHOOP developer app (client id/secret) on the server and the redirect URI registered — `https://<host>/api/whoop/callback` when hosted (HOSTING.md) |

## 3. Data semantics agreed for review

Full detail in `docs/team/HEALTH.md`. Summary: times stored as local wall-clock with the record's own zone
offset; a night belongs to the **local date it ended**; durations in integer minutes; steps as one total per
local day per source, upserted, never added across sources; **missing is null/absent, never 0**; WHOOP wins
over phone sources, which win over manual; recovery is WHOOP-only. Availability states have stable codes
(`needs_build`, `permission_denied`, `no_data`, `auth_expired`, …) for Samer to translate.

Found while checking: the sleep chart and the coach's `get_sleep` add naps into a day's hours, while the weekly
summary and points use only the longest sleep. Logged as open decision 5 in HEALTH.md; not changed here.

## 4. Device and access matrix — **Badr to fill in**

| Item | Value | Checked how |
|---|---|---|
| Android phone (model, Android version) | | Settings → About phone |
| Health Connect on it (built into Android 14+, or app version on 13 and older) | | Settings → Health Connect |
| Which apps write sleep/steps into Health Connect (Samsung Health, Google Fit, …) | | Health Connect → App permissions |
| iPhone (model, iOS version) | | Settings → General → About |
| WHOOP band and account active | | WHOOP app |
| WHOOP developer app created (client id/secret on the server, not in git) | | developer.whoop.com dashboard |
| A Mac available, even for one afternoon? | | Ask the group |
| GitHub push access to the team repo | **Yes** (`can_push: true` for Badr's account) | Checked this session |

## 5. Blockers

| Blocker | Needed from | Blocks |
|---|---|---|
| Web-only vs phone builds for testers | Nawaf (group decision) | Whether HEALTH-02 targets phones at all |
| A device and the device matrix above | Badr | Live Health Connect evidence |
| WHOOP developer app keys on a server Badr can reach | Badr (+ Alzoman for the hosted `.env`) | Live WHOOP check |
| iPhone signed-build route | Alzoman + Badr → group | Any Apple Health claim |
| Agreement on `DailySteps` / `/api/health/*` and error `code` | Alzoman, Samer | HEALTH-02/03 implementation |

## 6. Next action

1. **Badr:** fill in section 4, ask Nawaf to confirm or reverse the web-only pilot, and share this report and
   `HEALTH.md` with Alzoman (storage), Samer (states/wording) and Nawaf (coach inputs) for review.
2. **HEALTH-02, whichever way the decision goes:** live WHOOP check (connect, sync twice, confirm no
   duplicates, record one real night's numbers without personal details). It works in the web pilot too.
3. **If phone builds come back:** Android steps (permission + aggregate + `DailySteps` upsert, test-first),
   then a dev build on Badr's Android phone to prove sleep and steps, then HealthKit behind the iPhone route.
