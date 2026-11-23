# HEALTH-02/03 — Steps, Apple Health and "source + last sync" (code)

| Field | Value |
|---|---|
| Owner | Badr (health integrations) |
| Branch | `badr/health-native-sync`, on top of `badr/health-contract-device-spike` (HEALTH-01) |
| Base | `origin/merged_branch` @ `3ce064540f65313b96372ebd679e239a09c53882` |
| Session date | 2026-11-23 (planned windows were Oct 27–Nov 4) |
| Status | **Code and synthetic checks done. No live evidence**: not run on an Android phone, an iPhone or a real WHOOP account (section 5) |

This covers the code parts of HEALTH-02 (native imports) and HEALTH-03 (normalized sync). Their completion
evidence is live device data, which this report does **not** claim.

## Changed behaviour

| Area | What a user gets (once installed as a native build) |
|---|---|
| Android | Health Connect now asks for **sleep and steps**. Each sync also sends the last 30 (first time) or 7 days of daily step totals. Older connections see "Also import steps" |
| iPhone | New **Apple Health** card: read-only access to sleep and steps; sleep grouped into nights with stages when a Watch recorded them; daily step totals |
| Both | A **Steps** card on the Sleep screen: today's steps, the last 7 days, "no data" (never 0) for missing days, and the source |
| Server | `POST /api/health/steps`, `GET /api/health/steps`, `GET /api/health/connectors`, `POST /api/sleep/apple-health`; weekly summary counts Apple Health nights |
| Web app / Expo Go | No change: both cards say this version can't read phone health data (`needs_build`) |

## Files

| File | Change |
|---|---|
| `app/models/health.py` | New: `DailySteps`, `HealthSync` tables; request/response models |
| `app/services/health_sync.py` | New: steps upsert, steps history (missing = null, sources never added), connectors |
| `app/routers/health.py` | New: `/api/health/steps`, `/api/health/connectors` |
| `app/models/sleep.py`, `app/services/health_connect.py`, `app/routers/sleep.py` | `apple_health` source; one importer for both phone stores; records last sync |
| `app/services/accounts.py`, `app/services/weekly.py`, `app/models/points.py`, `app/main.py` | Delete new rows with the account; `from_apple_health`; register router |
| `mobile/src/lib/phoneHealth.ts` (+ test) | New, pure: Health Connect / HealthKit daily buckets → payload, Apple sleep samples → sessions |
| `mobile/src/lib/appleHealth.ts` | New: HealthKit status, permission, foreground sync |
| `mobile/src/lib/healthConnect.ts` | Steps permission and daily-steps sync |
| `mobile/src/components/AppleHealthCard.tsx`, `StepsCard.tsx` | New cards; `HealthConnectCard.tsx` gets the steps prompt |
| `mobile/src/app/sleep.tsx`, `(tabs)/home.tsx` | Show the new cards; sync Apple Health on open (15 / 30 min) |
| `mobile/src/lib/i18n/en.ts`, `ar.ts` | 22 new keys each (Arabic drafted with AI help — **needs a native speaker's review**) |
| `mobile/app.json`, `package.json`, `package-lock.json` | `READ_STEPS`; HealthKit plugin (`background: false`, no write permission); two new dependencies |
| `tests/test_health_sync.py` | 16 new tests |
| `docs/team/HEALTH.md`, `ARCHITECTURE.md` | Contract and architecture updated (Current / Built / Proposed) |

## Checks (this session, Linux container)

| Check | Command | Result |
|---|---|---|
| New backend tests first, failing | `uv run python -m pytest tests/test_health_sync.py` | Failed (module missing), then 15/15 and 16/16 after the code |
| Backend suite | `uv run python -m pytest` | **315 passed** (299 before + 16) |
| Mobile tests | `npm test` | **57 passed** (50 before + 6 phone-health + 1 summary) |
| Lint / typecheck | `npm run lint`, `npm run typecheck` | Pass / pass. The two libraries' result types are used without casts, so the compiler checks our code against them |
| Lockfile | `npm ci --dry-run` | Consistent |
| Native config | `npx expo prebuild --no-install --platform all` (output inspected, then deleted) | iOS: `com.apple.developer.healthkit` entitlement, no background-delivery entitlement, read usage text only. Android: `READ_SLEEP` + `READ_STEPS` |
| JS bundles | `npx expo export -p web`, `-p ios -p android` | All three bundle |

What these checks do **not** prove: that a phone returns data in the shapes assumed, that HealthKit or Health
Connect permission screens behave as coded, or that the iPhone build installs. Mocks and unit tests only cover
local logic.

## Decisions taken in code (for review)

- **Missing ≠ 0 for Android steps:** the Health Connect library turns "no data" into `COUNT_TOTAL: 0`; a day
  with no `dataOrigins` is dropped. A real 0 (data origins present) is kept.
- **Steps from two sources on one day are not added;** the latest sync is shown.
- **Apple sleep:** one session per source per night, 60-minute gap rule, the earliest sample's UUID as the id.
  Known edge: if a source later adds an earlier sample to a night, the id changes and the new session is
  skipped as an overlap, so the older version stays.
- **Every phone sync posts at least once** (even with no new nights), so "last sync" means "last checked".
- `npx expo install` could not reach Expo's version service from this environment, so the packages were
  installed with npm at their latest versions (HealthKit library needs React Native ≥ 0.79, React ≥ 19: met).
  Run `npx expo install --check` on a normal connection before the next build.

## Risks for the iPhone build (for Alzoman)

- The generated iOS entitlements also contain **`aps-environment`** (push notifications), added by
  `expo-notifications`, which was already in the app. Free Apple accounts (Personal Team) are widely reported
  not to support the push capability, so a free-account Xcode build may need that removed for the test build.
  Not verified here.
- `react-native-nitro-modules` and the HealthKit library compile Swift/C++ in the iOS build; untested on
  Expo SDK 57 / React Native 0.86.

## Dependencies and reviewers

| Who | What |
|---|---|
| Alzoman | Two new tables, new endpoints, `app.json`/`package.json` native changes, iPhone build route |
| Samer | New cards and 22 strings; where steps should live in the UI (now a card on the Sleep screen) |
| Nawaf | Whether the coach should read steps / connectors (no coach tool added) |
| Arabic speaker | Arabic text of the new keys |

## 5. Still blocked — live evidence

| Check | Needs |
|---|---|
| WHOOP: connect, sync twice, no duplicates, one real night recorded (no personal details in the report) | Badr's WHOOP account + a WHOOP developer app's keys in a local `.env` (not git) |
| Android: sleep + steps on a real phone | A teammate's Android phone with a development or preview build |
| iPhone: Apple Health sleep + steps | A signed iPhone build (Mac + free Apple ID, or $99 + EAS) — group decision |

## Next action

1. Badr: live WHOOP check (steps in the chat handoff), then record the result in HEALTH-04.
2. Group: confirm web-only vs phone builds; if phone builds, Alzoman builds an Android preview APK for a
   teammate's phone and the group decides the iPhone route.
3. Reviews above; then open the PR to `merged_branch`.
