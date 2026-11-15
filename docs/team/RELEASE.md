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

## 3. Build

- [ ] `mobile/eas.json` `preview` profile has `EXPO_PUBLIC_API_URL` = the server address (coordinate with Samer).
- [ ] No keys in `app.json`, `eas.json` or any `EXPO_PUBLIC_*` value.
- [ ] Android: `eas build -p android --profile preview` → APK link.
- [ ] iPhone: only if a signing route exists (DELIVERY-OPTIONS.md §3). Otherwise list it under known issues.

## 4. On real phones (each line: device, Android/iOS version, result)

- [ ] Fresh install → log in → log out → log in again
- [ ] Two testers on two phones: each sees only their own workouts/food/sleep
- [ ] Remove a tester from `PILOT_ACCOUNTS`, run `python -m app.pilot_accounts`: their open app shows
      "session expired" and login is refused; add them back: data is still there
- [ ] Workout: log sets, edit a set, finish, see it in history
- [ ] Food: search, log, edit portion, daily totals
- [ ] Machine photo: recognised or manual choice offered (no forced wrong match)
- [ ] Sleep: Health Connect permission + sync; syncing twice does not double the night
- [ ] Coach: answers from the tester's own records; "saved" only after a real save
- [ ] Restart the server → all of the above still there
- [ ] Language switch / Arabic layout — **not available yet** (see known issues)

## 5. Release record (copy per release)

| Field | Value |
|---|---|
| Release / date | |
| App version, EAS build link | |
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
| Android steps not read (sleep only) | No step counts | Badr |
| Apple Health not implemented; no iPhone signing route | No iPhone build, no Apple Health | Badr + Alzoman |
| Server availability depends on one PC (planned setup) | Down when that PC is off | Host |
| `alzoman` not merged into `merged_branch` | Builds from `merged_branch` lack closed sign-up/accounts | Group |
| Default session 30 min (set 7 days on the server, HOSTING.md §2) | Frequent log-outs if left at default | Alzoman |
