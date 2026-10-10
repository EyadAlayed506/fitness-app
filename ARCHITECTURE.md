# Fitness App: Architecture

This document describes the planned design of the fitness app. Nothing here is built yet. It is the base to agree on before writing code.

## 1. What the app does

| Area | Features |
|---|---|
| Account | Sign up, log in, profile (age, weight, height, sex, activity level, availability) |
| Health plan | BMI and category, weight to lose or gain to reach a healthy BMI, daily calories, three diet options (light / normal / extreme) with calorie difference and projected weight change, workout routine based on availability |
| Marketing | Opt-in checkbox at sign-up to receive ads and discounts at the account email, with one-click unsubscribe |
| Workout log | Sessions and sets (reps, weight, RPE, rest, notes). Add an exercise by **photo** (image model), **QR code**, or **typed name** |
| Food log | Add food by **name search** (food API) or **photo** (image model). Units depend on the item: solids in g / kg / oz / lb, liquids in ml / l / fl oz / cup / gallon |
| Custom food | **Manual** entry of calories, macros and sub-macros, or **photo of the Nutrition Facts label** (OCR fills it in and saves it immediately) |
| Plate estimate | Photo of a plate next to the user's hand. The model names the food and estimates the portion and macros |
| Visualisations | Body weight trend, calories vs target, lifting progress (estimated 1RM, volume), body measurements |
| Measurements (optional) | Waist, shoulders, chest, hips, neck, arms, thighs, with month-to-month comparison |

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| API | **FastAPI** (Python 3.13) | Same framework as the tutorial; automatic OpenAPI docs |
| ORM / models | **SQLModel** | One class serves as both the table and the Pydantic schema (as in day10) |
| Database | **PostgreSQL** (SQLite for tests and local dev) | Already used in day10 |
| Migrations | **Alembic** | Schema changes without dropping data |
| Auth | **JWT** access tokens (PyJWT) + **Argon2** password hashing (pwdlib) | The approach the FastAPI docs recommend |
| HTTP client | **httpx** (async) | Calls to food APIs |
| ML runtime | **Hugging Face `transformers`** models exported to **ONNX Runtime** (CPU), **PaddleOCR**, **OpenCV**, **MediaPipe** | Pretrained models, no training needed to start; ONNX keeps CPU inference fast (no GPU) |
| Background jobs | FastAPI `BackgroundTasks` at first, **Celery/RQ + Redis** later | Emails and the slow plate estimate should not block requests |
| Image storage | Local disk in dev, **S3-compatible** bucket in prod | Keep uploaded photos for re-processing and future fine-tuning |
| Client | **Mobile app** (Flutter or React Native), the only client | Camera, QR scanning and charts all live on the phone; the API just serves JSON |
| Tests | **pytest** + FastAPI `TestClient` (as in day8) | ML calls are mocked so tests run without model weights |

The ML dependencies are heavy (torch is about 1 GB), so they go in an optional install group (`pip install .[ml]`). Without them the API still runs; the image endpoints return `503 Model not available`.

## 3. High-level architecture

```mermaid
flowchart LR
    client["Mobile app"] -->|HTTPS + JWT| api

    subgraph api["FastAPI application"]
        routers["Routers<br/>(auth, profile, plan, workouts,<br/>exercises, foods, logs,<br/>measurements, analytics, marketing)"]
        services["Services<br/>(calculations, routine generator,<br/>units, food search, analytics)"]
        vision["Vision layer<br/>(machine classifier, QR decoder,<br/>food classifier, label OCR,<br/>plate estimator)"]
        routers --> services
        routers --> vision
    end

    services --> db[("PostgreSQL")]
    vision --> models[["Pretrained models<br/>(Hugging Face cache)"]]
    vision --> storage[("Image storage")]
    services --> usda["USDA FoodData Central API"]
    services --> off["Open Food Facts API"]
    services --> mail["Email provider<br/>(SMTP / SendGrid / Resend)"]
```

Rules that keep this maintainable:
- **Routers** only handle HTTP: validation, auth, status codes.
- **Services** hold the business logic and are plain Python functions, easy to unit-test.
- The **vision layer** sits behind small interfaces (`classify_machine(image) -> list[Prediction]`), so a model can be swapped (e.g. CLIP → a fine-tuned model) without touching routers.

## 4. Project layout

```
fitness_app/
├── ARCHITECTURE.md
├── README.md
├── pyproject.toml            # core deps + optional [ml] group
├── alembic/                  # migrations
├── app/
│   ├── main.py               # create FastAPI app, include routers
│   ├── config.py             # settings from .env (pydantic-settings)
│   ├── database.py           # engine, get_session, SessionDep
│   ├── security.py           # hashing, JWT create/verify
│   ├── deps.py               # CurrentUser dependency
│   ├── models/               # SQLModel tables + Create/Public/Update schemas
│   │   ├── user.py           # User, Profile, WeightEntry
│   │   ├── exercise.py       # Exercise (machine catalogue)
│   │   ├── workout.py        # WorkoutSession, WorkoutSet
│   │   ├── food.py           # Food, FoodLog
│   │   └── measurement.py    # BodyMeasurement
│   ├── routers/              # one file per area in section 7
│   ├── services/
│   │   ├── calculations.py   # BMI, BMR, TDEE, diet plans, projections
│   │   ├── routine.py        # workout routine generator
│   │   ├── units.py          # unit conversion
│   │   ├── food_search.py    # USDA + Open Food Facts clients, caching
│   │   ├── label_parser.py   # OCR text → nutrient fields
│   │   └── analytics.py      # time series for charts
│   ├── vision/
│   │   ├── machine_classifier.py
│   │   ├── qr.py
│   │   ├── food_classifier.py
│   │   ├── label_ocr.py
│   │   └── plate_estimator.py
│   └── seed/exercises.json   # starter machine catalogue
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
        enum goal "lose / maintain / gain"
        enum diet_option "light / normal / extreme"
        int days_per_week
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
        string primary_muscles
        string qr_code UK "required, printed on the machine"
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
        enum added_via "name / qr / photo"
    }
    FOOD {
        int id PK
        int owner_id FK "null = global"
        string name
        string brand
        enum source "usda / off / manual / label_scan"
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
        enum added_via "search / photo / manual / label / plate"
        string image_path
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

All endpoints except sign-up, login and unsubscribe need `Authorization: Bearer <token>`.

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
| GET | `/me/routine` | Workout routine generated from availability |

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
| POST | `/exercises/identify` | Upload a photo; returns top-3 machine predictions with confidence |
| GET | `/exercises/{id}/qr.png` | QR sticker for a machine (admin only) |
| POST / GET | `/workouts` | Start a session / list sessions |
| POST | `/workouts/{id}/sets` | Add a set (reps, weight, unit, RPE, notes) |
| PATCH / DELETE | `/workouts/{id}/sets/{set_id}` | Edit / remove a set |

**Food**

| Method | Path | Purpose |
|---|---|---|
| GET | `/foods/search?q=banana` | Local foods first, then USDA / Open Food Facts |
| POST | `/foods` | Manual custom food (calories, macros, sub-macros) |
| POST | `/foods/scan-label` | Nutrition Facts photo → parsed food, saved immediately |
| POST | `/foods/identify` | Food photo → top-3 food predictions with nutrients |
| POST | `/foods/estimate-plate` | Plate + hand photo → food, estimated grams, macros |
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

## 8. Adding an exercise: three input paths

```mermaid
flowchart TD
    A[User wants to log an exercise] --> B{How?}
    B -->|Typed name| C["Fuzzy search on name + aliases<br/>(rapidfuzz, or PostgreSQL pg_trgm)"]
    B -->|QR code| D["Phone camera decodes QR<br/>payload: fitapp://machine/&lt;code&gt;"]
    B -->|Photo| E["CLIP zero-shot classifier<br/>vs. catalogue names"]
    C --> F[Candidate exercises]
    D --> G["GET /exercises/qr/{code}"] --> F
    E --> H["Top-3 with confidence"] --> F
    F --> I[User confirms] --> J[POST /workouts/id/sets]
```

- **Typed name:** matches `name` and `aliases` with fuzzy matching, so "lat pull down" and "latpulldown" both find *Lat Pulldown*.
- **QR code:** **every machine has a QR code.** When a machine is added to the catalogue the API generates a unique code, and the gym prints the sticker from `/exercises/{id}/qr.png` (admin only) and sticks it on the machine. The app only has to understand its own format (`fitapp://machine/<code>`). Decoding happens on the phone with the native camera library, so the server only does a database lookup.
- **Photo:** there is no well-known pretrained model for gym machines, so the first version uses **CLIP zero-shot classification** (`openai/clip-vit-base-patch32`). The image is compared with text prompts built from the catalogue, such as "a photo of a lat pulldown machine in a gym". New machines work by adding them to the catalogue, with no retraining. Upgrade path: the photos users confirm become a labelled dataset for fine-tuning a dedicated classifier.
- The user always **confirms** the prediction before it is saved. Low confidence (below about 0.4) shows a "not sure, pick one" list.

## 9. Food registry: models and APIs

### 9.1 External food APIs

| API | Use | Key |
|---|---|---|
| **USDA FoodData Central** | Generic foods (rice, chicken breast, banana) with full nutrients | Free API key from api.data.gov |
| **Open Food Facts** | Branded and packaged products; barcode lookup is an easy later addition | No key; send a descriptive User-Agent |

Search flow: local DB (foods already imported or created) → USDA → Open Food Facts. Results the user picks are **imported into the local `FOOD` table**, which caches them and avoids repeated API calls. Both responses are normalised to per-100 g / per-100 ml values.

### 9.2 Pretrained models

| Task | Model | Output |
|---|---|---|
| Food photo | ViT fine-tuned on **Food-101** (e.g. `nateraw/food` on Hugging Face) | Top-3 dish labels + confidence → nutrients via the food APIs |
| Nutrition Facts label | **PaddleOCR** (pretrained text detection and recognition, light enough for CPU) + rule-based parser | Structured nutrients |
| Plate + hand portion | Food-101 classifier + **MediaPipe Hands** (hand landmarks) + **MobileSAM** (a small, CPU-friendly version of SAM) for the food region | Dish, estimated grams, macros |
| Exercise machine | **CLIP** zero-shot (see section 8) | Top-3 machines |

Food-101 covers 101 mostly Western dishes. Anything outside that list falls back to name search. Local cuisine (e.g. Middle Eastern dishes) is planned for a later phase: fine-tune the classifier on photos of those dishes and add their nutrients to the local `FOOD` table.

### 9.3 Running on CPU (no GPU)

The server has no GPU, so the models are chosen and run to keep each request to about 1 second:
- **Small models only:** CLIP ViT-B/32, a ViT-base Food-101 classifier, PaddleOCR mobile models, MobileSAM.
- **ONNX Runtime:** models are exported once to ONNX (with int8 quantisation where accuracy allows), which is usually 2–4× faster on CPU than plain PyTorch and avoids installing torch on the server.
- **Load once:** models load at startup and stay in memory, not per request.
- **Shrink images on the phone:** the app resizes photos to about 512 px before upload, which cuts upload time and inference time.
- **Cache CLIP text embeddings** for the machine catalogue; only the image embedding is computed per request.
- **Plate estimate runs as a background job** (it chains three models): the API returns a job id and the app polls or gets a push notification.

### 9.4 Nutrition label pipeline

```mermaid
flowchart LR
    A[Label photo] --> B["Pre-process<br/>(OpenCV: deskew, grayscale, contrast)"]
    B --> C["OCR<br/>(PaddleOCR)"]
    C --> D["Parser<br/>regex per field:<br/>Calories, Total Fat, Sat. Fat,<br/>Trans Fat, Cholesterol, Sodium,<br/>Total Carb, Fiber, Sugars, Protein,<br/>Serving size"]
    D --> E["Normalise to per 100 g / 100 ml<br/>using serving size"]
    E --> F[(Save FOOD, source = label_scan)]
    F --> G[Return food + confidence per field]
```

The food is saved immediately, as requested. The response flags fields the parser was unsure about, so the app can highlight them for a quick edit. The parser handles both US-style labels (per serving) and EU-style labels (per 100 g, kJ + kcal).

### 9.5 Plate + hand estimation

This is the least precise feature, and the app should present it as an **estimate**.

1. **Classify** the dish (Food-101 model).
2. **Detect the hand** with MediaPipe Hands. Average adult palm width is about 8–9 cm, which gives a pixels-to-cm scale.
3. **Segment the food** region and measure its area in cm².
4. **Area → grams**: area × an assumed thickness for the dish class × a density table (`seed/food_density.json`).
5. **Grams × nutrients per 100 g** → calories and macros.
6. If no hand is found, fall back to a typical serving size for the dish and return `confidence: low`.

The user can adjust the grams before saving. Upgrade path: a vision-language model can replace steps 1–4 later behind the same `estimate_plate()` interface.

## 10. Units (`services/units.py`)

| Kind | Units accepted | Stored as |
|---|---|---|
| Mass | g, kg, oz, lb | g |
| Volume | ml, l, tsp, tbsp, fl oz, cup, pint, quart, gallon (US) | ml |
| Body weight / lifted weight | kg, lb | kg |
| Length | cm, in | cm |

- `FOOD.is_liquid` decides which unit list the app shows.
- A food can also be logged by **serving** (e.g. "1 slice") using its `serving_size` + `serving_unit`.
- Logging a liquid by mass (or a solid by volume) is rejected unless the food has a density value.

## 11. Workout routine generator (`services/routine.py`)

Rule-based to start; inputs come from the profile.

| Days per week | Split |
|---|---|
| 1–2 | Full body |
| 3 | Full body A / B / A |
| 4 | Upper / Lower × 2 |
| 5 | Upper / Lower / Push / Pull / Legs |
| 6 | Push / Pull / Legs × 2 |

- **Minutes per session** sets the number of exercises (about 8–10 minutes per exercise including rest). For example, 30 min → 3–4 exercises, 60 min → 6–7.
- **Goal** sets rep ranges: fat loss 10–15 reps + 10–20 min cardio; muscle gain 6–12 reps; maintain 8–12.
- **Equipment** (gym / home / bodyweight) filters the exercise catalogue.
- Exercises are picked from the catalogue by muscle group, so every routine links to real `EXERCISE` rows the user can log against.

## 12. Visualisations

The API returns **chart-ready JSON** (`{labels: [...], series: [{name, data}]}`). The mobile app draws the charts with its own chart library (e.g. `fl_chart` for Flutter or Victory Native for React Native).

| Chart | Type | Data |
|---|---|---|
| Body weight | Line + 7-day moving average + dashed target line | `/analytics/weight` |
| Projection vs actual | Line: three diet-option projections with the actual weight on top | `/me/plan/projection` + `/analytics/weight` |
| Calories vs target | Bar per day with target line | `/analytics/calories` |
| Macro split | Stacked bar per day | `/analytics/calories` |
| Lift progress | Line: estimated 1RM per exercise | `/analytics/exercise/{id}` |
| Training volume | Stacked bar per week by muscle group | `/analytics/volume` |
| Measurements | Grouped bar: this month vs last month per body part | `/measurements/compare` |

## 13. Security and privacy

- Passwords hashed with Argon2; JWT access tokens with a short expiry (e.g. 30 min) and refresh tokens later.
- Every query filters by `current_user.id`. A user can never read another user's logs.
- The marketing checkbox at sign-up is **unchecked by default**; consent is timestamped, can be turned off in settings, and every email carries an unsubscribe link (needed for GDPR / CAN-SPAM compliance).
- Health data is sensitive: HTTPS only, secrets in `.env` (never committed), and an account-deletion endpoint that removes all user data.
- Upload limits: images ≤ 10 MB; content type checked; files stored under random names.
- Rate limits on login and the ML endpoints.

## 14. Configuration (`.env`)

```
DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/fitness_db
JWT_SECRET=change-me
JWT_EXPIRE_MINUTES=30
USDA_API_KEY=...
OFF_USER_AGENT=FitnessApp/0.1 (contact@example.com)
ML_ENABLED=true
ONNX_THREADS=4
MODEL_CACHE_DIR=./models
UPLOAD_DIR=./uploads
EMAIL_PROVIDER_API_KEY=...
```

## 15. Testing strategy

- **Unit tests** for `calculations`, `units`, `routine` and `label_parser`, with known inputs and expected outputs (e.g. BMI for 80 kg / 180 cm = 24.7).
- **API tests** with `TestClient` on an in-memory SQLite database, overriding `get_session` through FastAPI's dependency overrides.
- **Vision and external APIs mocked** in tests. A separate, opt-in test suite runs the real models on a few sample images.
- **Label parser fixtures**: OCR text from real labels saved as `.txt` files, so parsing is tested without OCR.

## 16. Build phases

| Phase | Scope |
|---|---|
| 1. Core | Project setup, auth, profile, weigh-ins, BMI / calories / diet options / projection, marketing opt-in |
| 2. Workouts | Exercise catalogue + seed data, name search, QR lookup, sessions and sets, routine generator |
| 3. Food (no ML) | USDA + Open Food Facts search, units, manual custom food, food log with daily totals |
| 4. Analytics | Analytics endpoints, measurements + monthly compare |
| 5. Vision | ONNX export, CLIP machine classifier, Food-101 classifier, label OCR + parser |
| 6. Plate estimate | Hand detection, segmentation, portion estimation |
| 7. Production | Alembic migrations, background jobs, S3 storage, rate limiting, deployment (Docker) |
| 8. Local cuisine | Fine-tune the food classifier on local dishes, add their nutrient data |

Each phase is usable on its own. ML comes after the core so the app works end to end before the heavy parts.

## 17. Decisions

| Question | Decision |
|---|---|
| Client | **Mobile app** only. QR scanning, camera and charts are on the phone. |
| Marketing email | The **email entered at sign-up** is used, with an opt-in checkbox. |
| Gym QR codes | **Every machine has a QR code**, generated by the app and printed as a sticker. |
| Local cuisine | Food-101 to start; local dishes are **phase 8**. |
| GPU | **None.** CPU-friendly models with ONNX Runtime (section 9.3). |

Still open:
1. **Mobile framework:** Flutter or React Native?
2. **Email provider** for sending the ads and discounts (SMTP, SendGrid, Resend or another)?
