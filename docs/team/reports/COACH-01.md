# COACH-01 — Agree assistant behaviour and evaluation

| Field | Value |
|---|---|
| Owner | Nawaf |
| Date | 2026-11-20 (planned Oct 25–26; started late) |
| Branch | `nawaf/coach-contract-evaluation-baseline` from `origin/merged_branch` at `3ce0645` |
| Reviewers | Samer (UX/locale contract), Alzoman (auth/service setup), Badr (sleep inputs) |

## Delivered

- **[COACH.md](../COACH.md)** — pilot scope, inventory of the 16 tools, logging rules, contracts with
  Samer/Alzoman/Badr, free-first inference route, prompt fingerprint (`ab6de9a2788c`).
- **[tests/coach_cases.json](../../../tests/coach_cases.json)** — 24 evaluation cases, each in English and Arabic
  with the same expectations, in 10 categories. Each has an `expect` block (tools, number of actions,
  reply rubric) for runs with a real model in COACH-04.
- **[tests/test_coach_cases.py](../../../tests/test_coach_cases.py)** — checks the case file and runs every
  case's scripted tool calls in both languages, against that case's data, without an AI model.
  Known gaps are strict `xfail`s, so fixing one makes the test say so.

No app behaviour changed.

## Checks

| Check | Result |
|---|---|
| Baseline `pytest` on `3ce0645` (before changes) | 299 passed |
| `pytest` with this branch | **320 passed, 3 xfailed** (21 new pass; 3 known gaps fail for the stated reason, checked with `--runxfail`) |
| Real model (Ollama or Claude) | **Not run** — Ollama isn't installed on this laptop and there's no dedicated GPU (Intel Iris Xe, 16 GB RAM); no Claude key |
| Phones | Not run (APP-02 phone test is the next step) |

`uv` isn't on this laptop's PATH; the checks ran with the project's existing `.venv` (Python 3.13.17,
dependencies unchanged since it was synced).

## Findings (for COACH-02)

1. **Arabic food names miss the built-in foods.** `log_food` with "موزة" doesn't find the app's "Banana":
   the local search only knows English names, so it goes online (Open Food Facts usually returns a branded
   Saudi product) or to an AI estimate saved as a new food. English names work. Fix options: tell the model
   to pass English food names, and/or add Arabic aliases to `app/seed/foods.json`. Exercise names in Arabic
   already work ("بنش", "سكوات").
2. **Partial-failure reply is mixed English/Arabic.** When the AI fails after saving something, the reply is
   `I added: Banana، حصة واحدة (105 سعرة) في الفطور. Then something went wrong: تعذّر…` (`app/routers/assistant.py`).
3. **Ollama errors during a chat are English only** (timeout, unreachable, model missing), unlike Claude's.
   They reach the app as `detail` texts that the app doesn't know, so Arabic users see English.
4. **Ambiguous units aren't guarded.** A metric user saying "I weigh 200" or "bench 135" — the prompt has no rule
   to check lb vs kg before logging. Cases are written. They need a real model to see what it does.
5. **No reply-language guarantee.** The prompt and per-question note now name the language (Samer, `9ffeaa5`),
   but no real model has been seen answering in Arabic yet.

## Decided (Nawaf, 2026-11-20)

- The coach logs straight away with an action card and Undo; no "confirm?" step (COACH.md §3.1).
- No `language` field on `POST /assistant/messages`: `Accept-Language` already reaches the coach.
- Western digits (0–9) in Arabic (answers APP-01).
- Coach side agrees to 7-day sessions with revocation (CONTRACTS BE-02 item 4): a 30-minute expiry
  interrupts a chat and a workout.

## Still open

| Item | From | Proposal |
|---|---|---|
| Sleep fields the coach reads are right for Health Connect / HealthKit nights | Badr | Please confirm |
| Coach provider for the pilot | Group | Ollama `qwen3:8b` (free); Claude only if a measured cost per question justifies it |

## Blockers

- **No machine with Ollama + GPU has run the cases.** This blocks the latency/quality numbers (COACH-02/04).
  Nawaf's laptop can't do it (no dedicated GPU), so this is handed over (below).

## Handed over (proposed — please confirm)

| Task | To | What's needed back |
|---|---|---|
| APP-02 phone test ([APP-02-phone-test.md](APP-02-phone-test.md)), run from the PC that hosts the server | **Alzoman** | The filled-in table (phone, language, result, problems) and screenshots; Nawaf still reviews the Arabic wording of the coach from those screenshots |
| Coach on a real model: Ollama `qwen3:8b` on a PC with a GPU, asking the 24 cases in [coach_cases.json](../../../tests/coach_cases.json) in both languages | **Eyad** | Per case and language: reply, tools used, actions, seconds to answer; plus GPU, model and `OLLAMA_NUM_CTX`. Nawaf scores the replies against each case's `expect` rubric |

## Next

1. Nawaf: COACH-02 on `nawaf/coach-reliability` — fix findings 1–3 and add a units rule for finding 4. None of
   this needs a model.
2. When Eyad's run is back: score it, and fix the cases where the model is wrong (COACH-02/04).
