# Health data — scope, current behaviour and contracts

Owner: Badr. Reviewers: Alzoman (storage, authorization, config), Samer (bilingual health screens),
Nawaf (what the coach reads). Status: **HEALTH-01 draft**, 2026-11-23, from `merged_branch` at `3ce0645`.

Each section marks what is **Current** (read from the code and checked by tests at `3ce0645`) and what is
**Proposed** (not built; needs agreement, then lands in the named task). Nothing here has been run on a real
phone or a real WHOOP account yet.

## 1. Scope

Confirmed (decision record, Oct 25): Android and iPhone read **daily steps and sleep** when data and
permission exist; WHOOP imports **sleep and recovery**; the app shows the source and the last sync.
Foreground/manual read sync only: no background sync, nothing written back to Health Connect or Apple Health.

**Open — needs the group:** WEB-01 (Alzoman, 2026-11-16) proposed a web-only pilot. A browser cannot read
Health Connect or Apple Health, so under that decision only **WHOOP** and **manual sleep** remain for testers.
Phone code stays in the repo. Until Nawaf confirms or reverses it, HEALTH-02+ plans both cases (section 8).

## 2. Current behaviour (inventory)

| Connector | What it imports | Where | How it's tested |
|---|---|---|---|
| Manual | Sleep: bedtime, wake-up, quality 1–5, notes | `app/routers/sleep.py` | `tests/test_sleep.py` |
| Android Health Connect | **Sleep only** (`SleepSession`, with stages). No steps | `mobile/src/lib/healthConnect.ts` reads on the phone → `POST /api/sleep/health-connect` → `app/services/health_connect.py` | `tests/test_health_connect.py`, `mobile/src/lib/healthConnectSessions.test.ts` (mapping only). **Never run on a phone** |
| WHOOP (API v2) | Sleep with stages and sleep performance; recovery % attached to the matching sleep | Server-side OAuth: `app/routers/whoop.py`, `app/services/whoop.py` | `tests/test_whoop.py` against a fake WHOOP server. **Never run against a real account** |
| Apple Health | Nothing. No library, no entitlement, no `apple_health` source | — | — |
| Steps (any source) | Nothing. No table, no permission (`READ_STEPS` not in `app.json`) | — | — |

Native setup today: `react-native-health-connect` 4.1.3 (its Expo plugin is bundled), `minSdkVersion` 26,
`android.permission.health.READ_SLEEP`. Expo SDK 57.0.27, React Native 0.86.3. Needs a development or
release build; Expo Go and the web return `needs_build`.

## 3. Canonical records

### 3.1 Sleep — Current (`SleepEntry`)

| Field | Unit / rule |
|---|---|
| `bedtime`, `wake_time` | **Local wall-clock time where the user slept**, stored without a time zone, rounded to the minute. Imported times are UTC + the record's own offset (Health Connect `startZoneOffset`, WHOOP `timezone_offset`); the phone's offset if Health Connect has none |
| `date` | **The local date of the wake-up.** A night 23:30 → 07:15 belongs to the morning it ended (midnight rule) |
| `duration_minutes` | Integer minutes **asleep** (light + deep + REM, plus "sleeping"/unknown stages) when the tracker gives stages; otherwise bedtime → wake-up |
| `light/deep/rem/awake_minutes` | Integer minutes, **null when the tracker didn't measure stages** (never 0 as a stand-in) |
| `performance_pct`, `recovery_score` | WHOOP only, 0–100. **Null for every other source** — never derived or estimated |
| `source` | `manual`, `health_connect`, `whoop` (Proposed: `apple_health`) |
| `external_id` | Provider record id: Health Connect `metadata.id` (fallback `start/end`), WHOOP sleep UUID |

Limits: a sleep longer than 20 h or ending before it starts is skipped (`skipped` count), not stored.

### 3.2 Daily steps — Proposed (HEALTH-02/03, schema change → Alzoman reviews)

```
DailySteps: user_id, date (local day), steps (int ≥ 0), source (health_connect | apple_health),
            tz_offset_seconds, synced_at (UTC)          unique (user_id, date, source)
```

- **The phone asks the platform for the day's total; it never sums raw samples itself.** Health Connect's
  aggregate API removes duplicates between apps using the user's app-priority list; Apple's statistics query
  (cumulative sum) does the same across sources. Day boundaries are the phone's local midnight.
- **Upsert, never add:** re-sending a day replaces that day's value for that source. Today's partial total
  simply grows on each sync.
- **Missing ≠ 0:** if the platform returns no value for a day, nothing is sent and there is no row. A real
  0 (the platform reports 0) is stored as 0.
- **One source per day, never summed across sources.** If both `health_connect` and `apple_health` exist for
  the same day (a user with two phones), show the most recently synced one. WHOOP's API has no step count.
- First sync: up to 30 days (Health Connect only lets an app read 30 days before permission was first
  granted); later syncs re-read the last 7 days, like sleep.

### 3.3 Recovery — Current

WHOOP recovery stays a WHOOP metric on the WHOOP sleep entry. No equivalent is computed for Health
Connect or Apple Health. If a WHOOP recovery has no matching sleep, it is not stored (Proposed: keep as is
for the MVP).

## 4. One night counted once — Current precedence

`whoop` > `health_connect` (and, Proposed, `apple_health` at the same level) > `manual`.

- Re-sending the same record updates it by `(user, source, external_id)`; the user's notes and quality stay.
- A Health Connect or WHOOP night **replaces** overlapping manual nights (`replaced_manual` count).
- A Health Connect session that overlaps a WHOOP night or another imported night is **skipped**. Within one
  batch, sessions with stages go first, so the detailed one wins.
- A WHOOP sync **deletes** overlapping Health Connect nights.
- Imported nights' times can't be edited (409); quality and notes can.

Known edges (no fix proposed yet): a detailed Health Connect session that arrives in a *later* sync than a
stage-less one for the same night is skipped, so the less detailed night stays. A session deleted in Health
Connect is not deleted on the server. WHOOP naps (`nap: true`) are imported as their own entries, dated
the day they end. The weekly summary, points and today's "last night" use the longest entry per day
(`activity.sleep_nights`), but the sleep chart and the coach's `get_sleep` (`analytics.sleep_series`) **add
naps into that day's hours**. So the same day can show different sleep totals in different places.

## 5. Availability states

Stable, language-neutral codes. Samer maps each to Arabic/English text; the code is never translated.

| Connector | Code | Meaning | Status |
|---|---|---|---|
| Health Connect | `unsupported` | Not Android | Current (`HealthConnectStatus.state`) |
| | `needs_build` | Expo Go / web: module not in this build | Current |
| | `not_installed`, `update_required` | Health Connect app missing or too old | Current |
| | `available` + `connected: false` | Installed, not turned on, or permission removed | Current |
| | `available` + `connected: true` | Can read | Current |
| | `permission_denied` | User refused in Health Connect's screen. **Android exposes this** (`getGrantedPermissions`) | Proposed (today it's folded into "not connected") |
| | `no_data` | Permission granted, nothing in the window | Proposed |
| Apple Health | `unsupported`, `needs_build` | As above | Proposed |
| | `requested` | Permission sheet shown. **Apple never tells an app whether read access was refused**, so "denied" and "no data" can't be told apart | Proposed |
| | `no_data` | Read returned nothing (could be refusal) — wording must not say "denied" | Proposed |
| WHOOP | `not_configured` | Server has no WHOOP app keys (`configured: false`, connect → 503) | Current |
| | `not_connected` | `connected: false` | Current |
| | `connected` | Token stored; `last_sync_at` known | Current |
| | `auth_expired` | Revoked/expired login → 409, connection forgotten, app login kept | Current (as text in `detail`) |
| | `provider_unavailable` | WHOOP down or answered an error → 502, nothing changed | Current (as text) |
| | `rate_limited` | WHOOP 429 → 502 with "try again in a minute" | Current (as text) |

Errors today are English sentences in `detail`. Proposed (agreed shape in CONTRACTS.md §1): add an
optional `code` next to `detail` for the health endpoints; `detail` stays.

## 6. Sync rules

- **When:** foreground only, when Home or Sleep opens (skipped if synced in the last 15–30 min), or when the
  user taps sync. No background task, no health-store writes.
- **Window:** Health Connect 30 days the first time, then the last 7. WHOOP 30 days, then from the last sync
  minus 3 days (WHOOP scores nights late).
- **Batches:** phone sends ≤ 200 sessions per request; server accepts ≤ 400.
- **Isolation:** every import is written under the logged-in user from the token, never a user id in the
  body. The same Health Connect record id in two accounts stays separate
  (`tests/test_isolation_more.py`).
- **Last sync:** WHOOP's is on the server (`GET /api/whoop`). Health Connect's is **only on the phone**
  today. Proposed (HEALTH-03): the server records it per user and source so Samer's screen and Nawaf's coach
  can read "source + last sync" from one place.

## 7. Example payloads

### 7.1 Current — captured from the running API (`3ce0645`, test database, synthetic data)

Health Connect import, `POST /api/sleep/health-connect` (Bearer token):

```json
{"sessions": [{
  "id": "hc-night-1",
  "start_time": "2026-11-22T20:30:00Z", "end_time": "2026-11-23T04:15:00Z",
  "zone_offset_seconds": 10800, "app": "com.sec.android.app.shealth",
  "stages": [
    {"start_time": "2026-11-22T20:30:00Z", "end_time": "2026-11-22T20:50:00Z", "stage": 1},
    {"start_time": "2026-11-22T20:50:00Z", "end_time": "2026-11-22T23:20:00Z", "stage": 4},
    {"start_time": "2026-11-22T23:20:00Z", "end_time": "2026-11-23T01:00:00Z", "stage": 5},
    {"start_time": "2026-11-23T01:00:00Z", "end_time": "2026-11-23T02:30:00Z", "stage": 6},
    {"start_time": "2026-11-23T02:30:00Z", "end_time": "2026-11-23T04:00:00Z", "stage": 4},
    {"start_time": "2026-11-23T04:00:00Z", "end_time": "2026-11-23T04:15:00Z", "stage": 3}
  ]}]}
```

| Case | Status | Response |
|---|---|---|
| Success, first time | 200 | `{"imported": 1, "updated": 0, "replaced_manual": 0, "skipped": 0}` |
| Same session again (repeat sync) | 200 | `{"imported": 0, "updated": 1, "replaced_manual": 0, "skipped": 0}` |
| Empty (`"sessions": []`) | 200 | `{"imported": 0, "updated": 0, "replaced_manual": 0, "skipped": 0}` |
| Unusable session (ends when it starts) | 200 | `{"imported": 0, "updated": 0, "replaced_manual": 0, "skipped": 1}` |
| Time without a zone | 422 | `{"detail": [{"type": "timezone_aware", "loc": ["body","sessions",0,"start_time"], "msg": "Input should have timezone info", …}]}` |
| No login | 401 | `{"detail": "Not authenticated"}` |

Resulting night, `GET /api/sleep?limit=1` (23:30 → 07:15 at UTC+3, dated the morning it ended):

```json
[{"id": 1, "date": "2026-11-23", "bedtime": "2026-11-22T23:30:00", "wake_time": "2026-11-23T07:15:00",
  "duration_minutes": 430, "quality": null, "notes": "", "source": "health_connect",
  "light_minutes": 240, "deep_minutes": 100, "rem_minutes": 90, "awake_minutes": 35,
  "performance_pct": null, "recovery_score": null}]
```

WHOOP, server without WHOOP keys:

| Call | Status | Response |
|---|---|---|
| `GET /api/whoop` | 200 | `{"configured": false, "redirect_uri": "http://localhost:8000/api/whoop/callback", "connected": false, "whoop_name": "", "connected_at": null, "last_sync_at": null}` |
| `POST /api/whoop/connect` | 503 | `{"detail": "WHOOP isn't set up on this server yet: …"}` |
| `POST /api/whoop/sync` (not connected) | 409 | `{"detail": "WHOOP is not connected"}` |

### 7.2 Proposed — **sample data, not implemented**

Daily steps upload (HEALTH-02/03), `POST /api/health/steps`:

```json
{"source": "health_connect", "tz_offset_seconds": 10800,
 "days": [{"date": "2026-11-22", "steps": 8412}, {"date": "2026-11-23", "steps": 1290}]}
```
→ `200 {"inserted": 1, "updated": 1}`. A day the platform has no value for is left out, not sent as 0.

One place for source and last sync (HEALTH-03), `GET /api/health/connectors`:

```json
{"connectors": [
  {"source": "health_connect", "state": "connected", "metrics": ["sleep", "steps"], "last_sync_at": "2026-11-23T05:02:00Z"},
  {"source": "apple_health", "state": "unsupported", "metrics": [], "last_sync_at": null},
  {"source": "whoop", "state": "auth_expired", "metrics": ["sleep", "recovery"], "last_sync_at": "2026-11-20T06:40:00Z"}
]}
```

Error with a code (needs Samer's agreement): `409 {"detail": "WHOOP no longer accepts this login. Connect WHOOP again.", "code": "whoop.auth_expired"}`

## 8. Open decisions

| # | Decision | Who | Effect |
|---|---|---|---|
| 1 | Web-only pilot (WEB-01): confirm or reverse | Nawaf, group | If confirmed: HEALTH-02 focuses on WHOOP live check + steps/HealthKit code kept for later builds |
| 2 | iPhone build route (Mac + free Apple ID, $99 + EAS, or unsigned CI build + sideload) | Alzoman + Badr → group | No Apple Health claim without a signed build on the iPhone |
| 3 | `DailySteps` table and `/api/health/*` endpoints (section 7.2) | Alzoman | Additive schema change |
| 4 | Optional `code` on health errors | Samer | Bilingual status text |
| 5 | Naps: count them in a day's sleep hours (chart, coach) or only the main sleep (weekly summary, points)? | Badr + Nawaf + Samer | Today the two disagree for days with a nap |
| 6 | Server-side record of Health Connect last sync | Alzoman | Needed for "source + last sync" outside the phone |
