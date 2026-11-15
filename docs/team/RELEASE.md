# Release checklist and known issues (BE-04)

Owner: Alzoman. Use this for every build handed to testers. Tick only what was actually done; write
"not tested" rather than leaving a box ambiguous. Copy the "Release record" section into
`docs/team/releases/<version>.md` for each release.

## 1. Before building

- [ ] The branch the server runs includes `alzoman` (closed sign-up, accounts, backups) and is green in CI
      (Actions tab: Backend and Mobile jobs both passed for the exact commit).
- [ ] Server `.env` checked against [HOSTING.md](HOSTING.md) §2. The server refuses to start if the secret or
      accounts are missing, so a running server already passed that check.
- [ ] Backup taken: `uv run python -m app.backup create`.
- [ ] Restore rehearsed at least once (HOSTING.md §5) — date: ______.

## 2. Server smoke test (2 minutes, no trace left in testers' data)

On the server: `uv run python -m app.smoke`.
From another network (e.g. a laptop on mobile data): `uv run python -m app.smoke --url https://<host>`
with `SMOKE_ACCOUNTS` set in that laptop's environment.
All checks must say PASS: server up, both testers log in and see their own profile, sign-up closed, fake
token refused, tester 2 can't see or delete tester 1's record, test record removed.

## 3. Build (web only)

- [ ] On the server, from the release commit: `cd mobile`, `npm ci`, `npx expo export -p web` (CI's
      "Web app" job checks this builds and is served).
- [ ] No keys in `app.json` or any `EXPO_PUBLIC_*` value (they end up readable in the web app).
- [ ] `https://<host>/` shows the login screen; `/api/health` shows the release commit.

## 4. In phone browsers (each line: phone, Chrome/Safari version, result)

- [ ] Open the address → log in → log out → log in again; Add to Home Screen works
- [ ] Two testers on two phones: each sees only their own workouts/food/sleep
- [ ] Remove a tester from `PILOT_ACCOUNTS`, run `python -m app.pilot_accounts`: their open app shows
      "session expired" and login is refused; add them back: data is still there
- [ ] Workout: log sets, edit a set, finish, see it in history
- [ ] Food: search, log, edit portion, daily totals
- [ ] Machine photo: picker offers the camera; recognised or manual choice offered (no forced wrong match)
- [ ] Sleep: manual entry works; WHOOP import (if used) does not double a night
- [ ] Coach: answers from the tester's own records; "saved" only after a real save
- [ ] Restart the server → all of the above still there
- [ ] Language switch / Arabic layout — **not available yet** (see known issues)

## 5. Release record (copy per release)

| Field | Value |
|---|---|
| Release / date | |
| Web app built from commit | |
| Server commit (`/api/health`) | |
| Server address | |
| Machine model (`MACHINE_MODEL_DIR`) | default `ml/machine_classifier/model/machines13_yt` — Eyad to confirm |
| Coach provider / model | |
| Evidence retrieval | disabled (MVP) |
| Last backup / last restore rehearsal | |
| Smoke test result | |
| Phone checks (§4) | |
| Known issues | below + new ones |

## Known issues (as of 2026-11-15, branch `alzoman`)

| Issue | Effect for testers | Owner |
|---|---|---|
| Not hosted yet; host PC not chosen | No shared server, no build pointing at one | Group |
| Arabic UI and right-to-left layout not implemented | English only | Samer |
| Coach in Arabic not set up or tested | Coach may answer in English | Nawaf |
| Web-only pilot (decided 2026-11-16): Health Connect and Apple Health can't be read by a web app | No phone steps/sleep sync; manual sleep or WHOOP only | Group to confirm; Badr |
| Web app never yet run by a person (CI only builds and serves it) | Screens may have web-only layout or feature issues | Samer + Alzoman |
| Server availability depends on one PC (planned setup) | Down when that PC is off | Host |
| `alzoman` not merged into `merged_branch` | Builds from `merged_branch` lack closed sign-up/accounts | Group |
| Default session 30 min (set 7 days on the server, HOSTING.md §2) | Frequent log-outs if left at default | Alzoman |
