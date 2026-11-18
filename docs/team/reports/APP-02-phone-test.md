# APP-02 — Phone test handoff (Samer → Nawaf)

| Field | Value |
|---|---|
| From / to | Samer → **Nawaf** |
| Date | 2026-11-18 |
| Branch | `samer/app-bilingual-foundation` (PR #1, into `merged_branch`) |
| What | First run of the web app **on real phones**, in Arabic and English, before the server is hosted |
| Done so far | Built-in browser at phone size only; CI green (backend, mobile, web export) |

Nobody has used the app on a real phone yet. This test is the local version of
[RELEASE.md](../RELEASE.md) §4: one PC runs the server, phones on the same Wi‑Fi open it. When the pilot
server is hosted, §4 is repeated there as a short re-check.

## 1. Set up (one PC, ~15 minutes)

Tools: git, [uv](https://docs.astral.sh/uv/), Node.js 22 — see [SETUP.md](../SETUP.md) §1.

```bash
git clone https://github.com/EyadAlayed506/fitness-app.git
cd fitness-app
git switch samer/app-bilingual-foundation
uv sync --locked
uv run python -m app.demo                     # demo account with 10 weeks of data
cd mobile && npm ci && npx expo export -p web && cd ..
uv run fastapi dev app/main.py --host 0.0.0.0
```

- Find the PC's address: `ipconfig` (Windows) → "IPv4 Address", e.g. `192.168.1.20`.
- If Windows asks, allow Python on **private** networks.
- On each phone (same Wi‑Fi): open `http://<that address>:8000`.
- Log in with the demo account from the README (or sign up: sign-up is open on a local server).
- **Coach (optional, your area):** install [Ollama](https://ollama.com), run `ollama pull qwen3:8b`, keep
  `ASSISTANT_PROVIDER=auto` in `.env`. Without it the coach shows its "not ready" card.

**Limit of this setup:** browsers allow the microphone and live camera only on `https`. Over this local
`http` address the coach's **voice message won't work** — that check waits for the hosted server. Picking a
photo from the gallery should still work.

## 2. What to check

Do each in **Arabic and English** (switch on the login screen or in Profile). At least one Android phone
(Chrome) and one iPhone (Safari).

**Arabic layout (new in PR #1)**
- [ ] Whole app reads right to left; back arrows and chevrons point the right way
- [ ] No cut-off or overlapping text (tab bar, buttons, cards, bottom sheets)
- [ ] Numbers are Western digits (0–9), dates Gregorian; weights/units read naturally ("85 كغ")
- [ ] Charts run left to right (decided), with legends and labels around them right to left
- [ ] Switching language changes everything at once, including text from the server (Today suggestions,
      plan day names, Progress insights)

**Journeys (RELEASE.md §4, the parts that work locally)**
- [ ] Log in → log out → log in again; Add to Home Screen works
- [ ] Workout: log sets, edit a set, finish, see it in history; exercise names and how-to in Arabic
- [ ] Exercise search in Arabic ("بنش", "سحب امامي")
- [ ] Food: search (try "موز"), log, edit portion, daily totals
- [ ] Machine photo: picking a photo offers a match or a manual choice (no forced wrong match)
- [ ] Sleep: manual entry works
- [ ] Coach (with Ollama): replies in Arabic when the app is in Arabic; answers from the tester's own
      records; "saved" only after a real save
- [ ] Session expired: on the PC, stop the server, change `JWT_SECRET` in `.env`, start it again → the open
      app goes to the login screen with the note "سُجّل خروجك لأن جلستك انتهت…" and, after logging in,
      the workout and logged sets are still there. Put `JWT_SECRET` back afterwards.

**Wording (your review)**
- [ ] Arabic reads naturally — overall, coach, plan and suggestions. Note anything odd with a screenshot.
      Exercise names → Eyad; sleep and points → Badr (forward to them).

## 3. Report back

Fill in the table below (or comment on PR #1) — one line per phone, plus screenshots of anything wrong.
Samer fixes layout/translation issues on the same branch.

| Phone / browser + version | Language | Result | Problems (screenshot names) |
|---|---|---|---|
| | | | |
| | | | |
