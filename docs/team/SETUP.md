# Team setup and checks (Windows and Linux)

Owner: Alzoman (backend/delivery). Status: draft for team review (BE-01).
Base commit when written: `dfd5df0` on `merged_branch`.

This page is for teammates who need to run the app and the same checks CI runs. The root
[README](../../README.md) remains the user-facing guide; this page adds the exact versions and
check commands. No secrets belong here or in git.

## 1. Tools

| Tool | Version | Why |
|---|---|---|
| git | any recent | clone and branches |
| [uv](https://docs.astral.sh/uv/) | recent | installs Python **3.13** (required by `pyproject.toml`) and the locked packages in `uv.lock` |
| Node.js | **22 LTS** (22.6 or newer) | `npm test` uses `node --experimental-strip-types`. The README says "Node 20 or newer"; use 22 to match CI |

You do **not** need a Mac, Xcode, Android Studio, Ollama or a GPU to run the checks.

Install uv: see the README (PowerShell one-liner on Windows, `curl` script on Linux).

## 2. Get the code

Direct collaborator (has push access to `EyadAlayed506/fitness-app`):

```bash
git clone --branch merged_branch https://github.com/EyadAlayed506/fitness-app.git
cd fitness-app
git switch -c alzoman/<task> origin/merged_branch   # one short branch per task
```

No push access yet: fork on GitHub, clone your fork, then
`git remote add upstream https://github.com/EyadAlayed506/fitness-app.git`,
branch from `upstream/merged_branch` and open the PR against `merged_branch`.

## 3. Backend

```bash
uv sync --locked                 # same as CI; fails if uv.lock is stale
uv run python -m app.demo        # optional: local demo account with 10 weeks of data
uv run fastapi dev app/main.py --host 0.0.0.0
```

Settings: copy `.env.example` to `.env`. Keep `.env` out of git (already in `.gitignore`).
For local work the defaults are fine. For anything reachable from the internet see
[CONTRACTS.md](CONTRACTS.md#production-settings) — the defaults are **not** safe there.

## 4. Mobile

```bash
cd mobile
npm ci                           # exact versions from package-lock.json (use instead of npm install)
npx expo start                   # w = browser, or scan the QR code with Expo Go
```

Web app as testers get it: `npx expo export -p web`, then start the backend and open http://localhost:8000
(the backend serves `mobile/dist`; the older simple preview is at `/preview`).

Health Connect, and any future Apple Health code, are native modules: they do **not** run in
Expo Go or the browser. They need a development build (see [DELIVERY-OPTIONS.md](DELIVERY-OPTIONS.md)).

## 5. Checks (what CI runs)

| Where | Command | Result |
|---|---|---|
| repo root | `uv run pytest` | Passed in CI on `alzoman` (2026-11-15). Historical: 236 passed at `5ca0a81` |
| `mobile/` | `npm test` | **72 passed, 0 failed** (Node 22.23.4, Linux) |
| `mobile/` | `npm run lint` | Passed in CI on `alzoman` (2026-11-15) |
| `mobile/` | `npm run typecheck` | Passed in CI on `alzoman` (2026-11-15) |

CI: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs all four on every PR into
`merged_branch` and on every push to `merged_branch` or to `alzoman`. Free on public repositories; no secrets used.

Before asking for review: run the checks for the area you changed. Before merge: CI green.
Do not weaken or delete a failing test to make CI pass; fix the cause or raise it.

## 6. Windows notes

- Run commands in PowerShell or Windows Terminal from the `fitness-app` folder.
- If `uv` or `node` is "not recognised", close and reopen the terminal after installing.
- Allow the Windows firewall prompt for the backend if a phone on the same Wi-Fi must reach it.
- Line endings: if git shows every file changed, run `git config core.autocrlf true` and re-checkout.

## 7. Recording results

Every result you report includes: commit, command, outcome (counts), platform/device, and what
was **not** tested. Mock/sample data must be labelled as such.
