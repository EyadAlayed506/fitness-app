# HEALTH-04 — Live WHOOP check (real account)

| Field | Value |
|---|---|
| Owner | Badr (health integrations) |
| Branch | `badr/health-whoop-live-check` |
| Base | `origin/merged_branch` @ `a867e91` (PR #2 merged: health contract, steps, Apple Health, PRIVACY.md) |
| Test date | 2026-11-24 |
| Tester | Badr, his own WHOOP account |
| Status | **WHOOP: passed on a real account.** Android and iPhone not tested (no build, see "Not tested") |

## Set-up

| Item | Value |
|---|---|
| Server | Badr's Windows PC, local backend from `merged_branch` (`uv run fastapi run app/main.py`), demo account |
| App | Real app's web build in the browser (`npx expo start`, then `w`: http://localhost:8081) |
| WHOOP | Badr's own WHOOP developer app; scopes `read:profile read:sleep read:recovery offline`; redirect `http://localhost:8000/api/whoop/callback`; privacy policy `PRIVACY.md` on GitHub |
| Secrets | Client ID and secret only in Badr's local `.env` (git-ignored). Not in the repo, chat or this report |

No personal health values are recorded here: only counts and pass/fail.

## Results

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Connect WHOOP (log in, allow) | Card shows connected, first sync runs | **Pass** |
| 2 | First sync | Last 30 days imported | **Pass:** "41 new" sleep entries from the last 30 nights |
| 3 | Sync again right away | Nothing added twice | **Pass:** 0 new, 3 updated (the last few days are re-read because WHOOP re-scores recent nights) |
| 4 | Sleep list | Each night once, with WHOOP detail | **Pass:** each night once; REM, deep, recovery % and sleep performance shown |
| 5 | Disconnect, connect again, sync | Nights not doubled | **Pass** |
| 6 | Connect but press Deny on WHOOP's page | Clear "not connected" message, no crash | **Pass** |

## Observations

- **41 entries for 30 nights.** WHOOP also reports naps, and the app imports each as its own entry, so a
  day with a nap has two entries. This is the open "naps" decision in `docs/team/HEALTH.md` §8 (item 5):
  the sleep chart and the coach add naps into that day's hours; the weekly summary and points use only the
  main sleep. Needs Badr + Nawaf + Samer to choose one rule.
- **"Sleep performance %" comes from WHOOP**, not from the app; the app only shows it. Other sources leave
  it empty.
- **`npm install` reports 20 vulnerabilities (14 moderate, 6 high).** Checked with `npm audit`: the same 20
  exist before the health changes (lockfile at `3ce0645`), all inside Expo's build tools, Expo Router and
  ESLint packages. The suggested fixes downgrade or upgrade Expo across major versions, so **don't run
  `npm audit fix --force`**; they go away with a normal Expo SDK upgrade (Alzoman's call).
- `fastapi dev` restarted in a loop on a project folder inside OneDrive; `fastapi run` (no file watching)
  worked. Likely OneDrive syncing files the app writes on first start. Not investigated further.

## Not tested (and why)

| Area | Why | Needs |
|---|---|---|
| Android Health Connect sleep + steps | No Android phone of Badr's; no native build | A teammate's Android phone + a development/preview build |
| Apple Health sleep + steps | Needs a signed iPhone build | Group decision: Mac + free Apple ID, or $99 + EAS |
| WHOOP token expiry / revoked from WHOOP's side, network failure during sync | Not tried live | Covered by automated tests against a fake WHOOP (`tests/test_whoop.py`) only |
| Hosted server (`https://…ts.net`) | Pilot server not running | The redirect URI must change to the hosted one in WHOOP's dashboard and `.env` |

## Next action

1. Group: decide the naps rule (HEALTH.md §8, item 5).
2. When phone builds exist: run the same checks for Health Connect on a teammate's Android phone and Apple
   Health on Badr's iPhone 15 Pro, and add them to this report.
3. If the hosted pilot server is used: register its callback URL in the WHOOP dashboard.
