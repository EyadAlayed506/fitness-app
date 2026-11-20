# Coach handoffs (Nawaf → Alzoman, Eyad) — 2026-11-20

Nawaf's laptop has no dedicated GPU (Intel Iris Xe), so it can't run the server with the coach or a local
model at a useful speed. These two checks are handed over. Background: [COACH-01](COACH-01.md),
[COACH-02](COACH-02.md), [COACH.md](../COACH.md).

## Alzoman — APP-02 phone test

Can you take over the APP-02 phone test that Samer handed to me? It belongs on the PC that will host the server.

**What:** the first run of the app on real phones, in Arabic and English. One PC runs the server and phones on
the same Wi-Fi open it. Full checklist: [APP-02-phone-test.md](APP-02-phone-test.md).

**Steps:**
1. `git switch merged_branch && git pull`
2. `uv sync --locked`, then `uv run python -m app.demo` (creates the demo account)
3. `cd mobile && npm ci && npx expo export -p web && cd ..`
4. `uv run fastapi dev app/main.py --host 0.0.0.0`
5. On each phone, open `http://<PC IPv4 address>:8000`. Use at least one Android phone with Chrome and one
   iPhone with Safari.

**For the coach part:** install [Ollama](https://ollama.com), run `ollama pull qwen3:8b`, and keep
`ASSISTANT_PROVIDER=auto` in `.env`. Voice messages won't work over plain `http`, so skip that check.

**What I need back:**
- The results table at the end of the checklist, one line per phone and language.
- Screenshots of anything wrong. Send me the coach screenshots too, because I'm reviewing the Arabic wording.
- Layout and translation problems go to Samer.

## Eyad — the coach on a real model

Can you run the coach's test cases on a real model? You're the one most likely to have a PC with a GPU.

**Setup:**
1. `git fetch && git switch nawaf/coach-contract-evaluation-baseline`
2. `uv sync --locked`
3. Install [Ollama](https://ollama.com) and run `ollama pull qwen3:8b`. In `.env`, set `ASSISTANT_PROVIDER=ollama`.

**Run** (no server or app needed; the script uses its own throwaway data, never `fitness.db`):

```bash
uv run python -m app.coach_eval
```

It asks the coach 22 cases from `tests/coach_cases.json` in English and Arabic: 44 questions. The 2 failure
cases are tested offline already. A local model can take a minute per question, so leave it running.
`--only <case-id> --lang ar` runs a single case, and `--list` shows the ids.

**What I need back:** the two files it writes to `coach-eval-results/` (a `.json` and a `.md`). They hold
every reply, the tools used, what was logged, seconds per answer, the GPU, the model and the settings. If you
can, also note how much GPU memory Ollama uses while answering (Task Manager → Performance → GPU).

**What I'm especially looking for:**
- Does it reply in Arabic when the question is in Arabic?
- When it's given an Arabic food name, does it retry in English and log the app's own food?
- Does it ask "kg or lb?" for "I weigh 200" and "bench 135"?
