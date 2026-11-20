# Coach assistant — scope, behaviour and contracts

Owner: Nawaf. Reviewers: Samer (Arabic/English UX), Alzoman (authorization, persistence, service setup),
Badr (health-summary inputs). Status: **COACH-01 draft**, 2026-11-20, from `merged_branch` at `3ce0645`.

## 1. Scope for the pilot

A regular Arabic/English assistant on the Coach tab. It answers from the logged-in user's own records and
can log food, workout sets, a weigh-in or a night of sleep when the user asks. In scope:

- Questions about the user's own data, the app's plan and rules, and general mainstream fitness knowledge.
- The logging tools that already exist (below), with an action card and Undo for each change.
- Replies in the app's language; the user's own language wins if they write in the other one.
- A free-first model (Ollama). Claude stays optional and paid; it needs a group decision.

Not in scope now: research papers, retrieval (RAG), vector storage, scientific citations or "validated"
claims, fine-tuning, multi-agent setups, voice commands (hands-free was removed on 2026-11-18; the Coach's
voice *message* → text stays). A future evidence seam is COACH-03, disabled and empty by default.

## 2. What the coach can do today (inventory)

Code: `app/services/assistant.py` (prompt, tools, both backends), `app/routers/assistant.py` (endpoints).
System prompt fingerprint: `sha256[:12] = d9ccb70c8cbf` (4,384 characters; COACH-02 added the kg/lb rule —
COACH-01 was `ab6de9a2788c`). 16 tools.

| Tool | Reads / writes | Notes |
|---|---|---|
| `get_profile_and_plan` | reads | profile, calorie plan, sleep goal, today's date |
| `get_training_plan` | reads | weekly split and exercises |
| `get_today_suggestions` | reads | rule-based suggestions (`app/services/recommendations.py`) |
| `get_recent_workouts` | reads | finished workouts, sets in kg, 1–90 days |
| `get_exercise_history` | reads | 1RM / heaviest set per workout; Arabic exercise names match |
| `get_exercise_info` | reads | how-to, muscles, alternatives |
| `get_sleep` | reads | nights (null = not logged), goal, averages |
| `get_food_day` / `get_calorie_trend` | reads | entries and totals vs target |
| `get_weekly_summary` / `get_points` | reads | week vs last week; points |
| `log_food` | **writes** | meal must be named by the user (see §3); food name in English (an Arabic name not in the list is refused, the model retries in English); unknown food → AI estimate saved as the user's own food |
| `remove_food_entry` | **writes** | only the user's own entry, by id from `get_food_day` |
| `log_workout_sets` | **writes** | starts a workout if none is open; unit from the message or the profile |
| `log_weight` | **writes** | one per day (second replaces first) |
| `log_sleep` | **writes** | local clock times |

Limits: 8 model calls per question; tool results cut at 20,000 characters (8,000 for Ollama); history
20 messages (10 for Ollama); Claude questions limited by `ASSISTANT_DAILY_LIMIT` (50/24 h), Ollama unlimited.

## 3. Logging semantics (agreed rules — please confirm)

1. **Clear intent.** The coach logs only when the user asks to add/log something. It doesn't ask "are you sure?"
   first: every change appears as an action card with **Undo** (current prompt). *Decided 2026-11-20.*
2. **Validated parameters.** The tools refuse what's missing or impossible and nothing is saved: no meal named
   (food), no reps (sets), a weight that isn't a number, impossible nutrition numbers, bad sleep times.
   The model must then ask one short question.
3. **"Saved" only after a real save.** The reply may say something was added only when the tool succeeded;
   the action list in the response is the source of truth, not the text.
4. **Meals are never guessed** — only a meal named in the message (English or Arabic words), never from the
   time of day or earlier messages.
5. **Partial failure.** If the AI fails after a tool saved something, the change and its Undo are kept and the
   reply says what was added, in the app's language (COACH-02).
7. **Units.** A weight without a unit uses the profile's units, unless the number doesn't fit the user or their
   records ("I weigh 200" at ~95 kg, "bench 135" when they lift ~60 kg): then the coach asks kg or lb before
   logging (prompt rule, COACH-02).
6. **Own data only.** Identity comes from the token (`CurrentUser`); tools have no user parameter. Another
   user's records are invisible; another user's food entry id is answered like a missing one.

## 4. Contracts with other workstreams

**With Samer (app):**
- Request: `POST /api/assistant/messages` `{text}` with `Accept-Language: ar|en` (already sent on every request).
  No separate `language` field is needed — the server puts the app language in the per-question note and the
  prompt says to reply in it (answers APP-02's request; done in `9ffeaa5`).
- Response unchanged: `answer.text` (plain text with `**bold**`, `• ` bullets and emoji block titles, parsed by
  `mobile/src/lib/coachText.ts`), `answer.actions[]` `{kind, summary, screen, undo[]}`, `tools_used[]`,
  `messages_left_today`. Action summaries and the disclaimer come in the request's language.
- Digits: Western (0–9) in Arabic replies — confirmed; the prompt says so for Arabic.
- Errors: `detail` stays as the server writes it. Claude and Ollama problems (key refused, busy, timeout,
  unreachable, model missing) come in the request's language (Ollama ones since COACH-02). The daily-limit
  429 and voice-message errors are still English, as before.

**With Alzoman (server):** authorization rule in [CONTRACTS.md](CONTRACTS.md) applies (identity from
`CurrentUser`, other users' records = not found). Chat messages are deleted with the account. Free-first
setup: `ASSISTANT_PROVIDER=ollama`, `OLLAMA_MODEL=qwen3:8b`, `OLLAMA_NUM_CTX=16384` on the host PC
([HOSTING.md](HOSTING.md)). Coach side agrees to BE-02's 7-day sessions with revocation (decided 2026-11-20).

**With Badr (health data):** the coach reads sleep only through `get_sleep` (`app/routers/analytics.sleep_series`),
which already merges manual, WHOOP and Health Connect nights; null means not logged and the prompt forbids
filling gaps. Badr to confirm those fields are accurate for Health Connect/HealthKit nights.

## 5. Inference: free-first

| Route | Cost | Status |
|---|---|---|
| Ollama `qwen3:8b` on the host PC | $0 | Default. **Not yet measured** — no machine with Ollama and a GPU has run the cases. |
| Claude (`claude-opus-5-5`, effort medium) | per question; estimate in DELIVERY-OPTIONS ≈ $10–25 for the pilot week | Optional; needs a group decision and a measured cost per question first |

Resource notes: `qwen3:8b` is about a 5 GB download; with a 16k context it needs more GPU memory than that
(*estimate, not measured*). HOSTING.md asks for a 12 GB GPU for both the coach and the photo model. Nawaf's laptop has integrated graphics only (Intel Iris Xe, 16 GB RAM),
so it can run the cases only slowly on the CPU; the latency numbers must come from the host PC.

## 6. Evaluation

Cases: [`tests/coach_cases.json`](../../tests/coach_cases.json) — 24 cases × English and Arabic, in 10 categories
(personal data, missing data, logging actions, incomplete requests, ambiguous units, isolation, provider failure,
safety, evidence disabled, language). Offline checks: `tests/test_coach_cases.py` runs each case's scripted
tool calls in both languages (no model). With a real model (COACH-04), each case is scored against its
`expect` block: tools used, number of actions, and the reply rubric — plus latency per question.
