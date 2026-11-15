# Account, data/schema and build contracts — draft for agreement

Owner: Alzoman. Reviewers: Nawaf (accounts/coaching), Samer (mobile session/error behaviour),
Badr (health storage), Eyad (model artifacts). Status: **draft (BE-01)**. Base commit: `dfd5df0`.

Each section separates **Current** (read from the code at the base commit) from **Proposed**
(not implemented; needs agreement, then lands in the named task). Domain contracts
(machine recognition, health, coach, language) stay with their owners; this file covers only
the shared backend/build pieces.

---

## 1. Accounts and sessions

### Current

| Item | Behaviour | Code |
|---|---|---|
| Sign-up | Open to anyone: `POST /api/auth/signup` | `app/routers/auth.py` |
| Log-in | `POST /api/auth/login`, OAuth2 form (`username` = email, `password`) → `{"access_token", "token_type": "bearer"}` | `app/routers/auth.py` |
| Token | HS256 JWT, claims `sub` (user id) and `exp` only | `app/security.py` |
| Expiry | `JWT_EXPIRE_MINUTES`, default **30** | `app/config.py` |
| Identity | `CurrentUser` dependency decodes the bearer token and loads the user; invalid/expired → 401 | `app/deps.py` |
| Log-out | Client-side only (token deleted on the phone). The token stays valid until `exp` | `mobile/src/lib/auth.tsx` |
| Revocation | **None** at `dfd5df0`. Added in BE-02 (branch `alzoman`): see below | — |
| Delete account | `DELETE /api/me` removes the user and their rows and photo files | `app/services/accounts.py` |
| Demo account | `demo@fitness.app` / `demo1234`, fixed in the repository | `app/demo.py` |
| Mobile 401 handling | Shows "Your session expired. Please log in again." | `mobile/src/lib/api.ts` |

### BE-02 status (branch `alzoman`)

Items 1, 2, 3 and 5 below are **implemented** (runbook: [ACCOUNTS.md](ACCOUNTS.md)); item 4 (session length)
is still a proposal. The admin command became a roster sync, `uv run python -m app.pilot_accounts`, driven by
`PILOT_ACCOUNTS` in the server `.env`. Removing an account *disables* it (records kept); nothing is deleted.
A disabled account logging in gets `403 {"detail": "This account no longer has access to the pilot"}`.

### Proposed (BE-02) — needs Nawaf + Samer sign-off

1. **Pre-created accounts only on the hosted server.** New setting `ALLOW_SIGNUP` (default `true`
   locally so existing tests and dev flow keep working; `false` on the hosted pilot).
   Sign-up when closed → `403 {"detail": "Sign-up is closed for this pilot"}`.
2. **Account admin command** run on the server, e.g. `uv run python -m app.admin create|disable|reset-password|revoke <email>`.
   Passwords are generated and handed to each tester privately; never committed or posted in chat.
   One account per tester (5–7). No invitation system.
3. **Revocation:** add `User.token_version` and `User.disabled_at` (both nullable, see §2), put
   `ver` in the JWT, and reject in `get_current_user` when the user is disabled or `ver` differs.
   "Revoke" = increment `token_version`. Same 401 body as expiry so the app needs no change.
4. **Session length:** 30 minutes means testers are logged out mid-workout. Proposal: 7 days
   (`JWT_EXPIRE_MINUTES=10080`) on the pilot, made safe by (3). Samer to confirm the app UX.
5. **Demo account never created on the hosted server** (its password is public in the repo).

### Authorization rule (applies to every user-data endpoint)

- Identity comes only from `CurrentUser`. A `user_id` in a path, query or body is never authorization.
- A record belonging to another user is answered exactly like a missing record: **404** with the
  usual "… not found" message. (Current pattern: `_get_owned_session`, `_get_owned_set`,
  `_get_owned_log`, `owned_gym`, sleep `_get_owned`.)
- BE-02 adds a two-account isolation test per area (workouts, food, weight/measurements, sleep/health,
  photos, gyms, coach chat/actions) where one is missing.

### Example payloads

```http
POST /api/auth/login            (form: username=tester1@pilot.local&password=…)
200 {"access_token": "<jwt>", "token_type": "bearer"}
401 {"detail": "Wrong email or password"}

GET /api/me                     (Authorization: Bearer <expired, revoked or invalid token>)
401 {"detail": "Not logged in or session expired"}      WWW-Authenticate: Bearer

GET /api/workouts/123           (record owned by another user, or missing)
404 {"detail": "Workout not found"}

POST /api/auth/signup           (hosted pilot, ALLOW_SIGNUP=false)   ← proposed
403 {"detail": "Sign-up is closed for this pilot"}
```

### Error envelope

Current and kept: FastAPI's `{"detail": <string>}` for 4xx/5xx and `{"detail": [<validation errors>]}`
for 422. The mobile app already parses both. **Open (Samer):** if the bilingual UI needs stable error
codes, add an *optional* `code` field next to `detail`; never replace `detail`.

---

## 2. Data and schema

### Current

- SQLite file by default (`DATABASE_URL=sqlite:///./fitness.db`); PostgreSQL supported via URL.
- Tables are created at start-up (`create_all`). `add_missing_columns` then adds **new nullable columns**
  to existing tables. It never adds non-null columns, renames, changes types, adds indexes/constraints
  to existing tables, or removes anything. There is no migration history (Alembic is "phase 5").
- Photos are files under `data/photos/`; downloaded models under `models/`. Both are outside the DB.

### Proposed rules until/unless Alembic is adopted (BE-03)

1. Schema changes are **additive**: new tables, or new columns that are nullable (or have a Python
   default and tolerate `NULL` for old rows). Anything else needs an explicit migration step reviewed by Alzoman.
2. Every schema PR states the change and is tested on **(a) a fresh database and (b) a copy of a populated
   database** (the demo DB is the minimum; a real pilot backup once one exists).
3. IDs and enum values stored in the DB are language-neutral (e.g. `leg_press`), never translated text.
4. Health records (Badr) follow his canonical daily steps/sleep contract; storage additions go through
   the rules above. Repeated sync must update/deduplicate, not add.
5. **Persistence = the DB file + `data/photos/`.** Backups must include both. Decision on Alembic vs
   continuing additive-only is due before BE-03 work starts — recommendation: stay additive-only for the
   pilot (smallest change, already working), and add a backup-before-start step instead.

---

## 3. Build and release

### Current

| Item | Value |
|---|---|
| App id | `com.eyadalayed.fitnessapp` (iOS bundle id and Android package) |
| App version | `1.0.0` in `mobile/app.json`; EAS `appVersionSource: remote` |
| EAS profiles | `development` (dev client, internal, APK), `preview` (internal, APK), `production` (autoIncrement) |
| Native modules needing a dev/release build | `react-native-health-connect`, camera, audio, image picker, notifications, secure store |
| Android permissions | `android.permission.health.READ_SLEEP` (steps not yet declared) |
| iOS HealthKit | Not configured yet (no entitlement or library in `app.json`) |
| API URL | `EXPO_PUBLIC_API_URL` overrides the default; the login screen also lets the user change it |
| Backend version | `0.1.0` in `pyproject.toml` / FastAPI app |
| Machine model in use | `MACHINE_MODEL_DIR` default `ml/machine_classifier/model/machines13_yt` (13 classes). **Note:** the Oct 25 baseline said `machines13_team`; commit `dfd5df0` changed it. Eyad to confirm which is shipped |

### Proposed

1. **Release record** for every candidate (file `docs/team/releases/<version>.md`): app version + EAS build
   id/URL, backend commit, `MACHINE_MODEL_DIR` + its `model_card.json`, coach provider/model + prompt version,
   evidence retrieval mode (**disabled** for this MVP), API URL, known issues.
2. **Hosted API URL is baked in at build time** with `EXPO_PUBLIC_API_URL` set in the EAS profile `env`
   (it is a public URL, not a secret). No private key or token is ever put in `app.json`, `eas.json`
   or any `EXPO_PUBLIC_*` variable — those end up readable in the app bundle.
3. Changes to `mobile/app.json` / `mobile/eas.json` (native modules, permissions, HealthKit) are coordinated:
   Badr proposes health permissions, Alzoman owns the build profiles, Samer is told before merge.
4. Android: `preview` profile APK is the pilot install. iPhone: see [DELIVERY-OPTIONS.md](DELIVERY-OPTIONS.md).

---

## Production settings

The defaults are for a laptop. Before anything is reachable from the internet (BE-03):

| Setting | Required on the hosted pilot |
|---|---|
| `JWT_SECRET` | Long random value, only in the server's `.env`. Proposed: refuse to start if the default is used with signup closed / non-local URL |
| `CORS_ORIGINS` | Not `*` if the web build is served; the native app does not need CORS |
| `ALLOW_SIGNUP` | `false` (proposed setting) |
| `ANTHROPIC_API_KEY`, `WHOOP_CLIENT_SECRET`, `USDA_API_KEY` | Server `.env` only; never in the mobile build, logs, chat or git |
| `ASSISTANT_DAILY_LIMIT` | Keep a limit if Claude is used (default 50/user/24 h) |
| Demo data | Do not run `app.demo` on the hosted DB |
