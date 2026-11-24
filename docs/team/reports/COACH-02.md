# COACH-02 — Make the personal assistant reliable (part 1: fixes without a model)

| Field | Value |
|---|---|
| Owner | Nawaf |
| Date | 2026-11-20 |
| Branch | `nawaf/coach-reliability` (to be cut after COACH-01; work done on top of COACH-01, base `3ce0645`) |
| Reviewers | Samer (Arabic texts, error display), Alzoman (router change) |

## What changed for users

1. **Arabic food names log the app's own food.** Before, "سجّل موزة في الفطور" could log a branded product
   found online or a new "AI estimate" food instead of the built-in Banana. Now `log_food` refuses an Arabic
   name that isn't in the food list (nothing is saved) and tells the model to retry with the English name; the
   tool description also asks for English names. *Trade-off:* the coach no longer logs Arabic-named products
   from Open Food Facts; those are still in the Food screen's search.
2. **Partial-failure reply in the app's language.** "أضفتُ: Banana، حصة واحدة (105 سعرة) في الفطور. ثم حدث خطأ: …"
   instead of mixed English/Arabic. The saved food and its Undo are kept, as before.
3. **Ollama problems during a chat in the app's language** (timeout, unreachable, model missing, other error),
   matching the Claude ones. The 404 text now reuses the "not downloaded yet" wording of the status check.
4. **kg/lb check before logging** (prompt rule): a weight without a unit that doesn't fit the user or their
   records makes the coach ask kg or lb first. Prompt fingerprint `ab6de9a2788c` → `d9ccb70c8cbf`.

Files: `app/services/assistant.py`, `app/routers/assistant.py`, `tests/coach_cases.json`,
`tests/test_coach_cases.py`, `docs/team/COACH.md`. No contract change: same endpoints, fields and status codes.

## Checks

| Check | Result |
|---|---|
| `pytest` (whole backend) | **325 passed**, 0 xfailed (COACH-01: 320 passed, 3 xfailed) |
| Known gaps from COACH-01 | Arabic food name and partial-failure cases now pass as normal tests; new test for Ollama errors in both languages |
| kg/lb rule with a real model | **Not run** — prompt-only; judged in Eyad's run (cases `ambiguous-weight-unit`, `ambiguous-lift-unit`) |
| Real model, latency, phones | **Not run** — handed to Eyad (model) and Alzoman (phones), see COACH-01 |

## Remaining for COACH-02 (needs a real model)

- Own-user history and logging on a real model, in both languages: Eyad's run of the 24 cases.
- Actual latency and GPU memory for `qwen3:8b` at 16k context on the host PC.
- Whether the model retries in English after the Arabic-name refusal (expected, not yet seen).

## Still English (not changed)

The daily-limit message (Claude only; Ollama has no limit) and voice-message errors. The app may show its own
translation for known ones — Samer to confirm if any need a server-side translation.
