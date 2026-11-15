# Hosting the pilot server — runbook (Windows PC + Tailscale Funnel)

Owner: Alzoman. Status: written for BE-03; **not yet carried out on a real machine.**
Why this setup: free, keeps the Ollama coach on a PC with a GPU, stable HTTPS address without buying a
domain. Trade-off: the service is up only while that PC is on. See [DELIVERY-OPTIONS.md](DELIVERY-OPTIONS.md).

## 0. Decide first

- [ ] Which PC (12 GB GPU for Ollama; can stay on, awake and online for the whole pilot)
- [ ] Which branch the server runs (it must include `alzoman`: closed sign-up and tester accounts)
- [ ] Coach: Ollama (free, default) or Claude (paid; group decision, keep `ASSISTANT_DAILY_LIMIT`)

## 1. Install once

1. Git for Windows, uv, and (for the coach) Ollama with `ollama pull qwen3:8b` and `ollama pull qwen3-vl:8b`.
2. `git clone https://github.com/EyadAlayed506/fitness-app.git C:\fitness-server`, then `cd C:\fitness-server`
   and `git switch <branch from step 0>`.
3. `uv sync --locked`
4. Windows power settings: never sleep while plugged in. Pause Windows Update for the pilot weeks.

## 2. Settings (`C:\fitness-server\.env`, never committed, keep a private copy elsewhere)

```
ALLOW_SIGNUP=false
JWT_SECRET=<run: python -c "import secrets; print(secrets.token_urlsafe(48))">
JWT_EXPIRE_MINUTES=10080
PILOT_ACCOUNTS=<tester>:<password>,...        (see ACCOUNTS.md)
DATABASE_URL=sqlite:///./fitness.db
CORS_ORIGINS=["https://<machine>.<tailnet>.ts.net"]
ASSISTANT_PROVIDER=ollama
# WHOOP (Badr): WHOOP_REDIRECT_URI=https://<machine>.<tailnet>.ts.net/api/whoop/callback
```

With `ALLOW_SIGNUP=false` the server **refuses to start** if `JWT_SECRET` is the example value or shorter
than 32 characters, or if `PILOT_ACCOUNTS` is empty. That is deliberate.

Then create the accounts: `uv run python -m app.pilot_accounts --dry-run`, then without `--dry-run`.
**Never** run `python -m app.demo` on this server.

## 3. Run

```
cd C:\fitness-server
uv run fastapi run app/main.py --host 127.0.0.1 --port 8000
```

`127.0.0.1` means only this PC can reach it directly; testers come in through Funnel (next step).
The console/access log shows full request URLs, including WHOOP's one-time OAuth code. Keep raw logs on
this PC; remove such values before pasting logs into chat or an issue.
Check: open `http://127.0.0.1:8000/api/health` → `"status": "ok"` and the commit you expect.

Start automatically: Task Scheduler → Create Task → trigger "At startup", action
`powershell -NoProfile -Command "cd C:\fitness-server; uv run fastapi run app/main.py --host 127.0.0.1 --port 8000"`,
"Run whether user is logged on or not". Reboot once to confirm it comes back.

## 4. Public HTTPS address (Tailscale Funnel)

1. Install Tailscale, sign in (free Personal plan), enable HTTPS and Funnel for the tailnet in the admin console.
2. `tailscale funnel --bg 8000`
3. The command prints `https://<machine>.<tailnet>.ts.net`. Public DNS can take up to ~10 minutes.
4. From a phone on mobile data (not the same Wi-Fi): open `https://<machine>.<tailnet>.ts.net/api/health`.

Funnel has bandwidth limits Tailscale doesn't publish; fine for 5–7 testers, not for video.

## 5. Backups (nightly + before every update)

```
uv run python -m app.backup create --keep 14                 # safe while the server runs
uv run python -m app.backup check backups\fitness-<time>
```

Task Scheduler: daily at 03:00, start in `C:\fitness-server`, same command. Weekly, copy the newest
`backups\fitness-*` folder to a second disk or a teammate (it contains testers' data — private storage only).

**Rehearse a restore before testers start** (on any PC):
```
uv run python -m app.backup restore <backup folder>          # into an empty folder: no --force needed
uv run fastapi run app/main.py --port 8001
```
Log in as two testers and check each sees their own records. Record the result in the release notes.

To restore on the live server: stop the task, `restore <folder> --force` (current data is moved to
`*.before-restore-<time>`, not deleted), start the task, check `/api/health` and log in.

## 6. Updating the server

1. `uv run python -m app.backup create`
2. Stop the task → `git pull` → `uv sync --locked` → start the task.
3. `/api/health` shows the new commit; log in as one tester.
4. Rollback: stop → `git switch --detach <previous commit>` → `uv sync --locked` → start. Restore the
   backup from step 1 only if the update damaged data (new columns added by an update are harmless to keep).

## 7. Mobile build pointing at the server

The app reads `EXPO_PUBLIC_API_URL` at build time. Add it to the `preview` profile in `mobile/eas.json`
(coordinate with Samer — shared file), e.g. `"env": { "EXPO_PUBLIC_API_URL": "https://<machine>.<tailnet>.ts.net" }`,
then `eas build -p android --profile preview`. The URL is public; never put keys in `EXPO_PUBLIC_*`.

## 8. Release record (each build you hand out)

App version + EAS build link, server commit (from `/api/health`), `MACHINE_MODEL_DIR`, coach provider/model,
evidence retrieval: disabled, API URL, last backup + restore rehearsal date, known issues.
