# WEB-01 — Pilot delivered as a web app

| Field | Value |
|---|---|
| Owner | Alzoman |
| Branch | `alzoman` |
| Date | 2026-11-16 |
| Decision | Alzoman, 2026-11-16: web app only for the pilot, no phone builds. **Needs group confirmation** (it changes confirmed scope, below) |
| Status | Code, tests and CI job written; **not yet run by CI or opened by a person** |

## Scope effect (for Nawaf and Badr)

- Health Connect (Android) and Apple Health can't be read from a browser, so phone steps/sleep sync is out of
  the pilot. WHOOP still works (the server connects to WHOOP directly). Manual sleep entry works.
- Gained: iPhone testers can use the app in Safari, with no Mac or Apple signing.
- No phone code was removed; native builds remain possible later.

## Changes

- `app/web_app.py` + `app/main.py`: the backend serves the real app's web build (`mobile/dist`, from
  `npx expo export -p web`) at `/`. Page addresses (`/sleep`, …) get `index.html`; scripts are served; missing
  files are real 404s; `../` can't leave the folder. Implemented as a "not found" handler limited to GET/HEAD
  outside `/api`, so every API response, including API 404s and other methods, is unchanged. Without a build,
  `/` is still the old simple preview, which is also kept at `/preview`.
- `mobile/src/lib/api.ts` (**Samer's file — tell him**): in an exported web build the app calls the API at the
  page's own address (`window.location.origin`), so it works behind `https` on port 443. Development
  (`expo start --web`), Expo Go and native builds behave exactly as before.
- CI: new **Web app** job — `npm ci`, `npx expo export -p web`, start the real backend, check `/`, a page
  address and an app script are served and `/api/nope` is still a 404.
- Tests: `tests/test_web_app.py`. Docs: INSTALL-TESTERS (web), HOSTING (build step, testers' address),
  RELEASE (web build + browser checks, known issues), SETUP.

## Checks in this session

| Check | Result |
|---|---|
| `compileall app tests` | Pass |
| Address rules run directly (FastAPI stubbed) | 10/10: home, deep links, scripts, missing script 404, `../` blocked, `/api` and non-GET excluded, no build → none |
| Workflow YAML | Parses; 3 jobs |
| `expo export -p web`, backend tests, typecheck/lint of the `api.ts` change | **Not run here** (no npm/PyPI access) — CI on push |
| A person using the web app | **Not done** — first real check is RELEASE.md §4 in phone browsers |

## Known risks

- The web export has never been built for this app; a native-only library could break it. The CI job will show it.
- Screens may have web-specific layout issues; nobody has used the app in a browser end to end.
