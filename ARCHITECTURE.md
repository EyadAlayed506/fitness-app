# Fitness App: Architecture

This document describes the design of the fitness app. Phases 1–4d (section 16) are built; see [README.md](README.md) to run it.

**Image features are out of scope for now** (exercise machine photo, food photo, Nutrition Facts label scan, plate + hand estimate). They will be designed and added once everything below works.

## 1. What the app does

| Area | Features |
|---|---|
| Account | Sign up, log in, profile (age, weight, height, sex, activity level, availability) |
| Health plan | BMI and category, weight to lose or gain to reach a healthy BMI, daily calories, three diet options (light / normal / extreme) with calorie difference and projected weight change, workout routine based on availability |
| Marketing | Opt-in checkbox at sign-up to receive ads and discounts at the account email, with one-click unsubscribe |
| Workout log | Sessions and sets (reps, weight, RPE, rest, notes). Add an exercise by **QR code** or **typed name** |
| Food log | Add food by **name search** (food API). Units depend on the item: solids in g / kg / oz / lb, liquids in ml / l / fl oz / cup / gallon |
| Custom food | **Manual** entry of calories, macros and sub-macros |
| Visualisations | Body weight trend, calories vs target, lifting progress (estimated 1RM, volume), body measurements |
| Measurements (optional) | Waist, shoulders, chest, hips, neck, arms, thighs, with month-to-month comparison |
| Training days | The user picks the actual weekdays they train (any combination, 1–6 days); the routine, calendar, suggestions, weekly summary and points all use them (section 11) |
| Exercise library | Curated how-to cues, movement pattern and default rest per exercise; alternatives from the catalogue only (section 19) |
| Rest timer | Starts by itself after each logged set with the exercise's rest time; pause, resume, skip, restart, ±15 s remembered per exercise (section 19) |
| Today | Rule-based suggestions with reasons: the planned session or rest day, short sleep, WHOOP recovery, missed sessions, progression. No AI (section 19) |
| Weekly summary | Planned vs done, lifts against last time, records, sleep, weight goal, points, last 8 weeks (section 19) |
| Wellness points | Points for recorded healthy habits, levels and achievements; never taken away (section 19) |
| Sleep | Log by hand or import from WHOOP (section 18). Dashboard: last night vs a sleep goal, stages for tracker nights, 7-night chart with goal line, week-on-week average, bedtime / wake-up consistency |

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| API | **FastAPI** (Python 3.13) | Automatic OpenAPI docs, easy to test |
| ORM / models | **SQLModel** | One class serves as both the table and the Pydantic schema |
| Database | **SQLite** by default (a file, nothing to install), **PostgreSQL** in production via `DATABASE_URL` | No setup for development; a real server database in production |
| Migrations | **Alembic** (phase 5; tables are created at startup until then) | Schema changes without dropping data |
| Auth | **JWT** access tokens (PyJWT) + **Argon2** password hashing (pwdlib) | The approach the FastAPI docs recommend |
| HTTP client | **httpx** (async) | Calls to food APIs |
| Background jobs | FastAPI `BackgroundTasks` at first, **Celery/RQ + Redis** later | Sending emails should not block requests |
| Client | **Mobile app in React Native** in `mobile/` (Expo SDK 57 + Expo Router; one codebase for Android, iOS and the browser, testable on a phone with Expo Go). A small **web preview** in `app/static/` (plain HTML/JS + Chart.js) is also served by the backend | QR scanning and charts live on the client; the API just serves JSON |
| Tests | **pytest** + FastAPI `TestClient` | Fast tests with no external services |

## 3. High-level architecture

```mermaid
flowchart LR
    client["Mobile app"] -->|HTTPS + JWT| api

    subgraph api["FastAPI application"]
        routers["Routers<br/>(auth, profile, plan, workouts,<br/>exercises, foods, logs,<br/>measurements, analytics, marketing)"]
        services["Services<br/>(calculations, routine generator,<br/>units, food search, analytics)"]
        routers --> services
    end

    services --> db[("PostgreSQL")]
    services --> usda["USDA FoodData Central API"]
    services --> off["Open Food Facts API"]
    services -.-> mail["Email provider<br/>(later, e.g. Brevo)"]
```

Rules that keep this maintainable:
- **Routers** only handle HTTP: validation, auth, status codes.
- **Services** hold the business logic and are plain Python functions, easy to unit-test.

## 4. Project layout

```
fitness-app/
├── mobile/                   # React Native app (see mobile/README.md)
│   └── src/app/              # screens: login, signup, onboarding, (tabs)/home, workouts, food, progress, profile
├── ARCHITECTURE.md
├── README.md
├── pyproject.toml            # dependencies
├── app/
│   ├── main.py               # create FastAPI app, include routers
│   ├── config.py             # settings from .env (pydantic-settings)
│   ├── database.py           # engine, get_session, SessionDep
│   ├── security.py           # hashing, JWT create/verify
│   ├── deps.py               # CurrentUser / CurrentProfile dependencies
│   ├── demo.py               # demo account with ten weeks of data
│   ├── models/               # SQLModel tables + Create/Public/Update schemas
│   │   ├── user.py           # User, Profile, WeightEntry
│   │   ├── exercise.py       # Exercise (curated catalogue), RestPreference
│   │   ├── sleep.py, whoop.py  # SleepEntry, WhoopConnection
│   │   ├── points.py         # PointAward
│   │   ├── workout.py        # WorkoutSession, WorkoutSet
│   │   ├── food.py           # Food, FoodLog
│   │   └── measurement.py    # BodyMeasurement
│   ├── routers/              # one file per area in section 7 (analytics time series live in routers/analytics.py)
│   ├── services/
│   │   ├── calculations.py   # BMI, BMR, TDEE, diet plans, projections
│   │   ├── schedule.py       # training weekdays: validation, split choice, recovery spacing
│   │   ├── routine.py        # workout routine generator
│   │   ├── alternatives.py   # exercise alternatives from the catalogue
│   │   ├── activity.py       # shared reads: local dates, finished workouts, nights, sleep goal
│   │   ├── recommendations.py  # today's rule-based suggestions
│   │   ├── weekly.py         # weekly progress summary
│   │   ├── points.py         # wellness points rules, levels, achievements
│   │   ├── whoop.py          # WHOOP OAuth + sync
│   │   ├── units.py          # unit conversion
│   │   ├── plan.py           # builds the health plan from a profile
│   │   ├── food_search.py    # local fuzzy search + USDA + Open Food Facts clients
│   │   ├── accounts.py       # delete a user and all their data
│   │   └── qr.py             # QR sticker images
│   ├── seed/                 # starter machine catalogue + built-in foods
│   └── static/               # web preview of the mobile app
└── tests/
```

## 5. Data model

All values are stored in **metric** (kg, cm, g, ml). Conversion to the user's preferred units happens at the API edge, so calculations and charts never mix units.

```mermaid
erDiagram
    USER ||--|| PROFILE : has
    USER ||--o{ WEIGHT_ENTRY : logs
    USER ||--o{ WORKOUT_SESSION : performs
    WORKOUT_SESSION ||--o{ WORKOUT_SET : contains
    EXERCISE ||--o{ WORKOUT_SET : "used in"
    USER ||--o{ FOOD_LOG : logs
    FOOD ||--o{ FOOD_LOG : "logged as"
    USER ||--o{ FOOD : "creates (custom)"
    USER ||--o{ BODY_MEASUREMENT : records
    USER ||--o{ SLEEP_ENTRY : logs
    USER ||--o{ REST_PREFERENCE : sets
    EXERCISE ||--o{ REST_PREFERENCE : "rest for"
    USER ||--o{ POINT_AWARD : earns

    USER {
        int id PK
        string email UK
        string hashed_password
        bool marketing_opt_in "checkbox at sign-up"
        datetime marketing_consented_at
        string unsubscribe_token UK
        datetime created_at
    }
    PROFILE {
        int user_id FK
        date birth_date
        enum sex "male / female"
        float height_cm
        float weight_kg "latest weigh-in"
        enum activity_level
        enum goal "auto / lose / maintain / gain"
        enum diet_option "light / normal / extreme"
        int days_per_week "derived from training_days"
        string training_days "0,2,4 (0 = Monday); null = older profile, days filled in automatically"
        string day_plan "JSON: the user's session type and name per weekday; null = all recommended"
        int sleep_goal_minutes "null = recommended for age"
        int minutes_per_session
        enum equipment "gym / home / bodyweight"
        enum unit_system "metric / imperial"
    }
    WEIGHT_ENTRY {
        int id PK
        int user_id FK
        date date
        float weight_kg
    }
    EXERCISE {
        int id PK
        string name UK "Lat Pulldown"
        string aliases "lat pull down, pulldown"
        string category "machine / free weight / cable / bodyweight"
        enum muscle_group "chest / back / quads ..."
        string primary_muscles
        string equipment "gym / home / bodyweight"
        string qr_code UK "required, printed on the machine"
        string pattern "movement pattern, e.g. squat"
        string instructions "curated how-to cues, one per line"
        int default_rest_seconds
    }
    REST_PREFERENCE {
        int user_id PK
        int exercise_id PK
        int seconds "the user's own rest time for this exercise"
    }
    POINT_AWARD {
        int id PK
        int user_id FK
        string rule
        string key "unique per user, e.g. sleep_goal:2026-10-12"
        int points
        date day
        string reason
        string data_source "manual / whoop"
    }
    WORKOUT_SESSION {
        int id PK
        int user_id FK
        datetime started_at
        datetime ended_at
        string notes
    }
    WORKOUT_SET {
        int id PK
        int session_id FK
        int exercise_id FK
        int set_number
        int reps
        float weight_kg
        float rpe "optional"
        int rest_seconds "optional"
        string notes
        enum added_via "name / qr"
    }
    FOOD {
        int id PK
        int owner_id FK "null = global"
        string name
        string brand
        enum source "builtin / usda / off / manual"
        string external_id
        bool is_liquid
        float serving_size
        string serving_unit
        float calories "per 100 g or 100 ml"
        float protein_g
        float carbs_g
        float fat_g
        float fiber_g
        float sugar_g
        float added_sugar_g
        float saturated_fat_g
        float trans_fat_g
        float cholesterol_mg
        float sodium_mg
        float potassium_mg
    }
    FOOD_LOG {
        int id PK
        int user_id FK
        int food_id FK
        date date
        enum meal "breakfast / lunch / dinner / snack"
        float quantity
        string unit "g, oz, ml, cup..."
        float amount_base "converted to g or ml"
        float calories "snapshot"
        float protein_g "snapshot"
        float carbs_g "snapshot"
        float fat_g "snapshot"
        enum added_via "search / manual"
    }
    BODY_MEASUREMENT {
        int id PK
        int user_id FK
        date date
        float waist_cm
        float shoulders_cm
        float chest_cm
        float hips_cm
        float neck_cm
        float arm_cm
        float thigh_cm
        float body_fat_pct "optional / computed"
    }
    SLEEP_ENTRY {
        int id PK
        int user_id FK
        date date "the morning you woke up"
        datetime bedtime "local clock time, no timezone"
        datetime wake_time "local clock time, no timezone"
        int duration_minutes
        int quality "1-5, optional"
        string notes
        enum source "manual / whoop"
        string external_id "tracker id"
        int light_minutes "WHOOP"
        int deep_minutes "WHOOP"
        int rem_minutes "WHOOP"
        int awake_minutes "WHOOP"
        float performance_pct "WHOOP"
        float recovery_score "WHOOP"
    }
```

Design notes:
- `FOOD` nutrients are always **per 100 g** (solids) or **per 100 ml** (liquids). A log entry multiplies by `amount_base / 100`.
- `FOOD_LOG` stores a **snapshot** of the computed nutrients, so editing a food later does not rewrite history.
- Age is derived from `birth_date`, so it stays correct over time.
- Marketing uses the **account email**, so there is no separate subscription table: the opt-in is three fields on `USER`.
- Each weigh-in creates a `WEIGHT_ENTRY` and updates `PROFILE.weight_kg`; the entries feed the weight chart.

## 6. Core calculations (`services/calculations.py`)

All formulas are standard estimates. The API should label results as approximations, not medical advice.

**BMI**
```
BMI = weight_kg / height_m²
< 18.5 underweight · 18.5–24.9 normal · 25–29.9 overweight · ≥ 30 obese
```

**Target weight**
```
healthy range  = [18.5 × h², 24.9 × h²]
optimal target = 22 × h²                       (middle of the healthy range)
weight_change  = optimal_target − current_weight  (negative = lose)
```
The response also returns the distance to the nearest edge of the healthy range, which is the smallest change that gets the user into "normal".

**Daily calories** (Mifflin–St Jeor BMR × activity factor = TDEE)
```
BMR (male)   = 10·kg + 6.25·cm − 5·age + 5
BMR (female) = 10·kg + 6.25·cm − 5·age − 161
TDEE         = BMR × factor
factor: sedentary 1.2 · light 1.375 · moderate 1.55 · active 1.725 · very active 1.9
```

**Diet options** (applied to TDEE; a minus sign means a deficit for weight loss, a plus sign a surplus for gain)

| Option | Lose | Gain | Approx. weekly change |
|---|---|---|---|
| Light | −250 kcal/day | +250 kcal/day | ≈ 0.25 kg |
| Normal | −500 kcal/day | +350 kcal/day | ≈ 0.5 kg loss / 0.3 kg gain |
| Extreme | −1000 kcal/day | +500 kcal/day | ≈ 1 kg loss / 0.45 kg gain |

Safety floor: daily intake is never planned below `max(BMR, 1200 kcal female / 1500 kcal male)`. If an option hits the floor, the API caps it and returns a warning.

**Projection**
```
weekly_change_kg = daily_difference × 7 / 7700      (≈ 7700 kcal per kg of body fat)
weeks_to_target  = |weight_change| / weekly_change_kg
```
The endpoint returns a week-by-week projected weight curve for each option, so the app can plot the three options side by side. Real progress slows as weight drops (the TDEE falls), so the projection recomputes TDEE each week instead of using a straight line.

**Lifting progress**
```
estimated 1RM (Epley) = weight × (1 + reps / 30)
volume                = Σ reps × weight
```

**Body fat (optional, U.S. Navy formula, metric)**
```
male   = 495 / (1.0324 − 0.19077·log10(waist − neck) + 0.15456·log10(height)) − 450
female = 495 / (1.29579 − 0.35004·log10(waist + hip − neck) + 0.22100·log10(height)) − 450
```

## 7. API endpoints

All paths are under `/api` (e.g. `/api/me/plan`). All endpoints except sign-up, login, unsubscribe and the QR sticker image need `Authorization: Bearer <token>`. The full list with request/response schemas is at `/docs` when the server runs.

**Auth and profile**

| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | Create account (email, password, `marketing_opt_in` checkbox) |
| POST | `/auth/login` | Returns JWT (OAuth2 password flow) |
| GET / PUT | `/me/profile` | Read / update profile and availability |
| POST / GET | `/me/weight` | Log a weigh-in / list history |

**Health plan**

| Method | Path | Purpose |
|---|---|---|
| GET | `/me/plan` | BMI, category, target weight, weight change, BMR, TDEE, all three diet options with calories, difference, weekly change, weeks to target |
| GET | `/me/plan/projection?option=normal` | Week-by-week projected weight |
| GET | `/me/routine` | Workout routine on the user's training days: each day's session type, name and recommended type, why, and notes |
| PUT | `/me/schedule` | Save training days with an optional session type and name per day |
| POST | `/me/schedule/preview` | Same body as PUT; returns the routine without saving (for the editor) |
| DELETE | `/me/schedule/custom` | Back to the recommended session for every day |
| GET | `/me/recommendations?tz_offset=` | Today's rule-based suggestions, each with reasons and the data used |
| PUT | `/me/sleep-goal` | Nightly sleep goal in minutes, or `null` for the amount recommended for the user's age |

**Marketing**

| Method | Path | Purpose |
|---|---|---|
| PUT | `/me/marketing` | Turn the opt-in on or off from the app settings |
| GET | `/marketing/unsubscribe/{token}` | One-click unsubscribe link used in every email (no login needed) |

**Exercises and workouts**

| Method | Path | Purpose |
|---|---|---|
| GET | `/exercises?search=lat pull` | Typed name, fuzzy match |
| GET | `/exercises/qr/{code}` | Look up the machine by QR payload |
| GET | `/exercises/{id}/qr.png` | QR sticker image for a machine |
| GET | `/exercises/{id}/alternatives?all_equipment=` | Catalogue alternatives, "similar" (same movement) or "different" (same muscles), with reasons and differences |
| GET / PUT | `/exercises/{id}/rest` | The user's rest time for an exercise (`{seconds}` or `null` for the default) |
| POST / GET | `/workouts` | Start a session / list sessions |
| POST | `/workouts/{id}/sets` | Add a set (reps, weight, unit, RPE, notes) |
| PATCH / DELETE | `/workouts/{id}/sets/{set_id}` | Edit / remove a set |

**Food**

| Method | Path | Purpose |
|---|---|---|
| GET | `/foods/search?q=banana` | Local foods first, then USDA / Open Food Facts |
| POST | `/foods` | Manual custom food (calories, macros, sub-macros) |
| POST / GET | `/food-logs?date=2026-10-10` | Log food / list a day with totals vs target |
| PATCH / DELETE | `/food-logs/{id}` | Edit / remove |

**Measurements and analytics**

| Method | Path | Purpose |
|---|---|---|
| POST / GET | `/measurements` | Record / list body measurements |
| GET | `/measurements/compare?months=2026-09,2026-10` | Month vs month with differences |
| GET | `/analytics/weight` | Weight series + 7-day moving average + target line |
| GET | `/analytics/calories?from=&to=` | Daily intake vs target, macro split |
| GET | `/analytics/exercise/{id}` | Estimated 1RM and volume over time |
| GET | `/analytics/volume?group=week` | Weekly training volume per muscle group |
| GET | `/analytics/weekly-summary?week=&tz_offset=` | One week against the plan and the week before (section 19) |

**Points**

| Method | Path | Purpose |
|---|---|---|
| GET | `/points?tz_offset=` | Gives any points earned since the last check, then returns total, level, today, last 2 weeks, achievements and the rules |

`tz_offset` is the app's UTC offset in minutes (`-new Date().getTimezoneOffset()`), so "today" and "this week" are the user's own. Without it the server's time zone is used.

**Sleep**

| Method | Path | Purpose |
|---|---|---|
| POST / GET | `/sleep` | Log a sleep (bedtime, wake-up time, quality, notes) / list recent sleeps |
| PATCH / DELETE | `/sleep/{id}` | Edit / remove |
| GET | `/analytics/sleep?days=14&tz_offset=` | Per night: hours, bed / wake times, source, stages (tracker nights only), points earned; null for nights not logged. The goal, 7-day average and the 7 days before (only when both have 3+ nights), bedtime and wake-up spread |

Sleep times are stored as the user's local clock times (no timezone), because "went to bed at 23:30" means 23:30 wherever the user is. A sleep that overlaps one already logged is refused (409), so the same night is never counted twice; separate sleeps on the same day (naps) add up.

## 8. Adding an exercise: two input paths

```mermaid
flowchart TD
    A[User wants to log an exercise] --> B{How?}
    B -->|Typed name| C["Fuzzy search on name + aliases<br/>(rapidfuzz, or PostgreSQL pg_trgm)"]
    B -->|QR code| D["Phone camera decodes QR<br/>payload: fitapp://machine/&lt;code&gt;"]
    C --> F[Candidate exercises]
    D --> G["GET /exercises/qr/{code}"] --> F
    F --> I[User confirms] --> J[POST /workouts/id/sets]
```

- **Typed name:** matches `name` and `aliases` with fuzzy matching, so "lat pull down" and "latpulldown" both find *Lat Pulldown*.
- **QR code:** **every machine has a QR code.** Each machine in the catalogue has a unique code, and the gym prints the sticker from `/exercises/{id}/qr.png` (the app has a printable sticker page) and sticks it on the machine. The image is public because the code is printed on the machine anyway; adding machines to the catalogue is done through the seed file until an admin screen exists. The app only has to understand its own format (`fitapp://machine/<code>`). Decoding happens on the phone with the native camera library, so the server only does a database lookup.

## 9. Food registry: external APIs

| API | Use | Key |
|---|---|---|
| **USDA FoodData Central** | Generic foods (rice, chicken breast, banana) with full nutrients | Free API key from api.data.gov |
| **Open Food Facts** | Branded and packaged products; barcode lookup is an easy later addition | No key; send a descriptive User-Agent |

Search flow: local DB (38 built-in common foods, foods already imported, the user's own foods) → USDA → Open Food Facts. If an API is down, local results still come back with a warning. Results the user picks are **imported into the local `FOOD` table**, which caches them and avoids repeated API calls. Both responses are normalised to per-100 g / per-100 ml values.

## 10. Units (`services/units.py`)

| Kind | Units accepted | Stored as |
|---|---|---|
| Mass | g, kg, oz, lb | g |
| Volume | ml, l, tsp, tbsp, fl oz, cup, pint, quart, gallon (US) | ml |
| Body weight / lifted weight | kg, lb | kg |
| Length | cm, in | cm |

- `FOOD.is_liquid` decides which unit list the app shows.
- A food can also be logged by **serving** (e.g. "1 slice") using its `serving_size` + `serving_unit`.
- Logging a liquid by mass (or a solid by volume) is rejected. USDA reports per 100 g, so USDA drinks are logged by mass or serving.

## 11. Workout routine generator (`services/schedule.py`, `services/routine.py`)

Rule-based; inputs come from the profile.

**Training days.** The user picks the actual weekdays (any combination of 1–6 days, validated on the server). `days_per_week` is derived from them. Sessions are only placed on those days; every other day is a rest day. Profiles saved before days could be picked keep working: they get a fixed, explicit default for their count (`LEGACY_DEFAULT_DAYS`, e.g. 3 → Mon / Wed / Fri) and the app asks the user to pick their own. Changing the days changes the plan from then on; logged workouts are never touched.

**Recommended session for each day** (`recommend_focus`):

| Days | Recommended |
|---|---|
| 1–3 | Full body every day (full-body days alternate between two exercise variations, A and B) |
| 4 | Upper / Lower × 2 |
| 5 | Upper / Lower / Push / Pull / Legs |
| 6 | Push / Pull / Legs × 2 |

The rotation starts after the longest rest gap (Sunday → Monday counts as back to back), and the routine says why it recommends the split. Tests check every combination of 4+ days for no shared muscles on consecutive days.

**The user's own plan.** For any day the user can pick another session type (Full body, Upper body, Lower body, Push, Pull, Legs) and give the day their own name ("Heavy day"), in the Workouts tab → **Edit plan** (`PUT /me/schedule`, previewed live with `POST /me/schedule/preview`). Choices are stored as JSON in `PROFILE.day_plan`, keyed by weekday; a day without a choice follows the recommendation, and "Use recommended" (`DELETE /me/schedule/custom`) drops all choices. Changing the training days keeps the choices for days that stay. Plans are never blocked: friendly notes point out back-to-back days that train the same muscles, or a week with no legs, pushing or pulling.

- **Minutes per session** sets the number of exercises (about 9 minutes per exercise including rest).
- **Goal** sets rep ranges: fat loss 10–15 reps + 10–20 min cardio; muscle gain 6–12 reps; maintain 8–12.
- **Equipment** (gym / home / bodyweight) filters the exercise catalogue.
- Each exercise carries its own rest time (`default_rest_seconds`, or the user's saved one).

## 12. Visualisations

The API returns **chart-ready JSON** (`{labels: [...], series: [{name, data}]}`). The mobile app draws the charts itself with `react-native-svg` (`mobile/src/components/charts.tsx`), so they work in Expo Go and the browser with no extra native code: tap a chart for the values, or switch to a table.

| Chart | Type | Data |
|---|---|---|
| Body weight | Line + 7-day moving average + dashed target line | `/analytics/weight` |
| Projection vs actual | Line: three diet-option projections with the actual weight on top | `/me/plan/projection` + `/analytics/weight` |
| Calories vs target | Bar per day with target line | `/analytics/calories` |
| Macro split | Stacked bar per day | `/analytics/calories` |
| Lift progress | Line: estimated 1RM per exercise | `/analytics/exercise/{id}` |
| Training volume | Stacked bar per week by muscle group | `/analytics/volume` |
| Measurements | Grouped bar: this month vs last month per body part | `/measurements/compare` |
| Sleep, 14 nights | Bar per night with the goal as a reference line | `/analytics/sleep` |
| Last 7 nights | Bars coloured by source (WHOOP / by hand), dashed goal line, "not logged" markers | `/analytics/sleep` |
| Bedtime and wake-up | One bar per night on an 18:00–12:00 timeline | `/analytics/sleep` |
| Sleep stages | Stacked bar, only for nights a tracker measured | `/analytics/sleep` |
| Planned vs done | Grouped bars per week, last 8 weeks | `/analytics/weekly-summary` |

## 13. Security and privacy

- Passwords hashed with Argon2; JWT access tokens with a short expiry (e.g. 30 min) and refresh tokens later.
- Every query filters by `current_user.id`. A user can never read another user's logs.
- The marketing checkbox at sign-up is **unchecked by default**; consent is timestamped, can be turned off in settings, and every email carries an unsubscribe link (needed for GDPR / CAN-SPAM compliance).
- Health data is sensitive: HTTPS only, secrets in `.env` (never committed), and an account-deletion endpoint that removes all user data.
- Rate limits on login and the food search endpoint (it calls external APIs).

## 14. Configuration (`.env`)

```
DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/fitness_db
JWT_SECRET=change-me
JWT_EXPIRE_MINUTES=30
USDA_API_KEY=...
OFF_USER_AGENT=FitnessApp/0.1 (contact@example.com)
EMAIL_PROVIDER_API_KEY=...       # later, when an email provider is picked
```

## 15. Testing strategy

- **Unit tests** for `calculations`, `units` and `routine`, with known inputs and expected outputs (e.g. BMI for 80 kg / 180 cm = 24.7).
- **API tests** with `TestClient` on an in-memory SQLite database, overriding `get_session` through FastAPI's dependency overrides.
- **External food APIs mocked** in tests (saved sample responses), so tests run offline. WHOOP is tested against an `httpx.MockTransport` fake.
- **Rule services** (schedule, recommendations, points, weekly summary) are tested directly and through the API, including missing data.
- **Mobile logic** that doesn't need React (the rest timer state machine) is tested with Node's built-in test runner: `cd mobile && npm test`.

## 16. Build phases

| Phase | Scope |
|---|---|
| 1. Core ✅ | Project setup, auth, profile, weigh-ins, BMI / calories / diet options / projection, marketing opt-in |
| 2. Workouts ✅ | Exercise catalogue + seed data, name search, QR lookup, sessions and sets, routine generator |
| 3. Food ✅ | USDA + Open Food Facts search, units, manual custom food, food log with daily totals |
| 4. Analytics ✅ | Analytics endpoints, measurements + monthly compare, charts in the web preview |
| 4b. Mobile app ✅ | React Native (Expo) app with every screen: auth, profile, plan, workouts (name + camera QR), food, progress charts, measurements |
| 4c. Sleep log ✅ | Manual sleep logging, Sleep screen, Home card, sleep chart (mobile app), WHOOP import (section 18) |
| 4d. Coaching ✅ | Training weekdays, exercise library and alternatives, rest timer, today's suggestions, weekly summary, wellness points, sleep dashboard (section 19) |
| 5. Production | Alembic migrations, background jobs, rate limiting, deployment (Docker) |
| Later | Image features, designed once phases 1–5 work |

Each phase is usable on its own.

## 17. Decisions

| Question | Decision |
|---|---|
| Client | **Mobile app in React Native** (Expo), in `mobile/`. The backend's web preview stays as a no-install quick look. |
| Marketing email | The **email entered at sign-up** is used, with an opt-in checkbox. |
| Gym QR codes | **Every machine has a QR code**, generated by the app and printed as a sticker. |
| Image features | **Removed for now**; added after the rest works. |
| Email provider | **Later.** Opt-in and unsubscribe are built; sending is added when a provider is picked (Brevo's free plan is the front runner). |
| Sleep data | **Manual log or WHOOP**, the user chooses. Health Connect / Apple Health later. |
| Suggestions | **Rules, not AI.** Small, readable rules with reasons; no LLM or ML model. |
| Chatbot | **Optional** (section 20): a free local model through Ollama by default, or Claude with an API key; the rule-based features don't depend on it. |
| Equipment recognition | **A vision model on the PC, not a trained model** (section 20): it picks from the catalogue and the user confirms. |

## 18. Sleep from trackers

Users choose: type sleep in, or connect WHOOP. Imported sleeps sit next to manual ones in `SLEEP_ENTRY` (`source`, `external_id`).

**WHOOP (built).** `app/services/whoop.py`, `app/routers/whoop.py`, table `WHOOP_CONNECTION` (one per user: OAuth tokens, state, last sync).
- Login: `POST /api/whoop/connect` returns WHOOP's OAuth URL (scopes `offline read:profile read:sleep read:recovery`, random `state`, valid 15 minutes). WHOOP redirects the browser to `GET /api/whoop/callback`, which exchanges the code, reads the profile and imports the last 30 days.
- Sync: `POST /api/whoop/sync?stale_minutes=N` reads `v2/activity/sleep` and `v2/recovery` since the last sync (minus 3 days, because WHOOP scores nights after a delay), with pagination. Tokens refresh automatically; rotated refresh tokens are saved.
- Mapping: times are converted to the clock time where the user slept (`timezone_offset`), duration is time asleep (light + deep + REM), stages and sleep performance are stored, quality maps performance to 1–5 (85 %+ = 5), recovery comes from the matching recovery record.
- A WHOOP night replaces typed-in sleeps that overlap it; re-syncs update by WHOOP id (no duplicates) and keep the user's notes. Times of WHOOP nights can't be edited.
- A revoked or expired WHOOP login disconnects WHOOP (HTTP 409, never 401, so the user stays logged in to this app). WHOOP being down returns 502 and changes nothing.
- No webhooks: they need a public HTTPS address, which a backend on a home PC doesn't have. Syncing on app open covers it.
- `GET /api/whoop`, `DELETE /api/whoop` (revokes access at WHOOP; imported sleep stays).
- Tokens are stored as plain text in the database. Encrypt them before running the app for real users.
- Tested against a fake WHOOP server (`tests/test_whoop.py`), not a real WHOOP account.

Not built: Health Connect (Android, needs a development build) and Apple Health (needs the paid Apple Developer Program).

## 19. Coaching features

All rule-based, all from data the user recorded. Shared reads (the user's local dates, finished workouts, the main sleep of each night, the sleep goal, the routine) are in `services/activity.py` so every feature counts things the same way.

**Exercise library and alternatives** (`seed/exercises.json`, `services/alternatives.py`). Every catalogue exercise has a movement pattern, 3–5 standard how-to cues and a default rest. The seed updates existing rows by QR code, so older databases get the new details with the same ids. Alternatives come only from the catalogue: same pattern = "similar" (with equipment differences spelled out), a few close pattern pairs (flat / incline press, dip / triceps extension) = "similar" with the difference stated, same main muscle group with another pattern = "different", never presented as a like-for-like swap. Filtered to the user's equipment unless they ask to see everything. The catalogue has no experience levels yet, so alternatives aren't filtered by experience.

**Rest timer** (`mobile/src/lib/restTimer.ts`, `components/RestTimer.tsx`). A pure state machine (idle / running / paused / done) with one countdown per workout screen; starting again replaces the countdown, so two can never run. Saving a set starts it with the exercise's rest time (the user's saved one, else the default). Moving to another exercise sets the next rest without cutting the current one. ±15 s changes are saved per exercise (`REST_PREFERENCE`, 15–600 s). At zero the phone vibrates (a short tone in the browser) and a message shows. Time is kept as an end timestamp, so it stays right after the app was in the background, but there's no system notification while the app is closed (that needs `expo-notifications`).

**Today's suggestions** (`services/recommendations.py`). Each rule is a function `(context) -> [Recommendation]` listed in `RULES`: planned session or rest day (or "done for today"); a night at least 1 h under the sleep goal on a training day → "consider going lighter"; WHOOP recovery below 34 % → easier session, 67 %+ → train as planned (WHOOP's own bands); planned sessions missed earlier this week → carry on, never double up; every set at the top of the rep range last time → small step up (skipped on days the other rules suggest going lighter). Missing data makes a rule stay silent. Suggestions never change the plan and carry a not-medical-advice note.

**Weekly summary** (`services/weekly.py`). Monday–Sunday in the user's time zone: days trained against planned days (and other days), workouts, sets, volume, each lift's best set against the last time it was done, estimated 1RM, records (only when beating earlier history: "Best estimated 1RM yet" or "Heaviest weight yet"), sleep average and nights at goal with WHOOP / by-hand counts, latest weigh-in against the weight goal, points, and planned vs done for 8 weeks. Comparisons with the week before only when that week has data; anything missing is null, not zero. The summary says it doesn't claim sleep caused changes in training. "Planned" for past weeks uses the current training days, because earlier schedules aren't stored.

**Wellness points** (`services/points.py`, table `POINT_AWARD`). One `RULES` table: finished workout +20 (one a day, up to the plan's sessions per week, so extra sessions don't earn more and rest days never cost anything), full planned week +30, sleep goal reached +10 (WHOOP, or logged by hand within 2 days), eating within 10 % of the calorie target on a finished day with 2+ foods logged by the next day +10, weekly weigh-in +5. Points are given when `/points` is checked, over the last 14 days and only since sign-up; the unique `(user_id, key)` makes this safe to repeat. Points are never taken away, even if the record is later deleted. Levels start at 0, 100, 300, 600, 1000, … points; achievements are counts of awards. No leaderboard or spending.

**Sleep dashboard.** See the sleep rows in sections 7 and 12. Sleep stages are only shown for tracker nights; nothing is estimated for manual logs. Bedtime / wake-up consistency is the typical distance from the middle time over the last 7 nights (needs 3+ nights), shown as plain numbers without health claims.

**Equipment recognition.** Built on the `chatbot-assistant` branch with a vision model on the PC instead of a trained model: see "Photo of a machine" in section 20.

## 20. Coach (AI chatbot)

A chat assistant over the user's own data (`app/services/assistant.py`, `app/routers/assistant.py`, table `CHAT_MESSAGE`, mobile tab `coach.tsx`). Unlike everything in section 19, this part uses an LLM. Two interchangeable backends share the tools, the system prompt and the rules:

| | `OllamaBackend` (default without an API key) | `ClaudeBackend` |
|---|---|---|
| Runs | On the user's PC through Ollama's `/api/chat` (`stream: false`, `num_ctx` 16384) | Anthropic's API through the official `anthropic` SDK (`claude-opus-5-5`, effort medium, cached system prompt, server-side refusal fallbacks) |
| Cost / limit | Free, no daily limit | Paid; `ASSISTANT_DAILY_LIMIT` questions per user per 24 h |
| Data | Stays on the PC | Sent to Anthropic |
| Context | Last 10 messages, tool results cut at 8,000 characters | Last 20 messages, tool results cut at 20,000 characters |

`ASSISTANT_PROVIDER` picks one (`auto`: Claude when `ANTHROPIC_API_KEY` is set, otherwise Ollama). Each backend reports what's missing (`problem`): no API key, Ollama not running, or the model not pulled, with the command to fix it; the tab shows it.

- **Tools.** Each tool calls the same code as an API endpoint, so answers match the screens and only the logged-in user's data is touched. Reading: profile and plan, training plan, today's suggestions, recent workouts, exercise history, exercise info and alternatives, sleep, a day's food, calorie trend, weekly summary, points. Logging (only when the user asks, without asking back): `log_food` (finds the food in the user's foods / built-in list, then USDA / Open Food Facts; unknown units become one serving; the meal follows the time of day when not given), `remove_food_entry`, `log_workout_sets` (adds to the open workout or starts one), `log_weight`, `log_sleep`.
- **Actions.** Every change is returned as an action (summary, the screen it shows on, the API paths to DELETE to undo it), stored with the answer and shown in the Coach with Open and Undo. If the AI fails after changing something, the change is still reported with its Undo.
- **Voice** (`services/speech.py`, `POST /assistant/transcribe`): the app records with `expo-audio` (AAC on phones, Opus/webm in the browser) and uploads it; faster-whisper turns it into text on the PC and the text goes into the message box to check. The model downloads once; CPU int8 by default. PyAV is pinned below 17 because faster-whisper 1.2 uses an option newer versions removed; a test decodes both recording formats.
- **Loop.** Up to 8 model calls per question; tool problems go back to the model as errors. Ollama tool arguments sent as a JSON string are parsed; `<think>` blocks are removed from local models' answers.
- **Conversation.** One per user, stored as plain text. A message is saved only once an answer arrives. Deleting the account deletes it; the trash button clears it.
- **Tests** use a scripted fake Claude client and a fake Ollama (`httpx.MockTransport`) in `tests/test_assistant.py`: no network, no cost.

**Photo of a machine** (`services/recognition.py`, `POST /exercises/recognize`, `ExercisePhoto.tsx`). A vision model on the PC (Ollama, `OLLAMA_VISION_MODEL`, default `qwen3-vl:8b`) gets the photo and the catalogue (id, name, muscles, equipment) and must answer in a fixed JSON format (`format` = JSON schema, temperature 0) with up to 3 exercise ids and a confidence. Ids that aren't in the catalogue and duplicates are dropped, so it can only suggest real exercises. The app shows the guesses as "Very likely / Likely / Maybe"; the user taps one (the set is saved with `added_via = photo`) or searches by name. Only JPEG, PNG and WebP up to 15 MB are accepted, and the photo isn't stored. No model is trained.
