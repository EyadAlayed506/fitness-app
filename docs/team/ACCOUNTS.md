# Pilot accounts — runbook

Owner: Alzoman. Applies to the shared pilot server only. Local development is unchanged: sign-up stays
open and `uv run python -m app.demo` still works on your own machine.

## Set up (once, on the server)

1. In the server's `.env` (never committed):

   ```
   ALLOW_SIGNUP=false
   PILOT_ACCOUNTS=ali@example.com:<password>,noor@example.com:<password>,...
   JWT_SECRET=<long random value>
   ```

   - One entry per tester (5–7). Use a real address or any `name@something` form; it is only a login name.
   - Passwords: at least 8 characters, no commas. Generate them, e.g.
     `python -c "import secrets; print(secrets.token_urlsafe(12))"`.
   - Do **not** run `app.demo` on the server: the demo password is public in the repository.

2. Preview, then apply:

   ```
   uv run python -m app.pilot_accounts --dry-run
   uv run python -m app.pilot_accounts
   ```

3. Send each tester their own email and password privately (direct message, not a group chat).
   One account per person, so nobody's records mix.

## Day to day

Edit `PILOT_ACCOUNTS`, then run `uv run python -m app.pilot_accounts` again. No restart needed.

| To… | Do this | Effect |
|---|---|---|
| Add a tester | Add `email:password` | Account created |
| Reset a password | Change that entry's password | New password works; the tester is logged out on every phone |
| Remove a tester | Delete the entry | Logged out at once, can't log in (`403`). **Records are kept** |
| Bring a tester back | Add the entry again | Access restored with all their old records |

Any other account on the server (for example one created while sign-up was open) is disabled the
first time the command runs. The command prints emails only, never passwords.

## What the app sees

| Situation | API answer | App behaviour |
|---|---|---|
| Sign-up attempt on the server | `403 Sign-up is closed for this pilot` | Shows the message |
| Removed tester logs in | `403 This account no longer has access to the pilot` | Shows the message |
| Removed tester, or old password, with the app already open | `401 Not logged in or session expired` | Existing "session expired, log in again" flow |

## Checked by

`tests/test_pilot_accounts.py`: closed sign-up, roster parsing, create/idempotent/dry run, removal
and restore with data kept, password change logs out, tokens from before the upgrade still work, and
two testers cannot read, change or delete each other's workouts, sleep, measurements, custom foods or
food logs. Existing tests (`test_assistant.py`, `test_logging_shortcuts.py`) cover some coach
cross-user cases. Gym photos and WHOOP/Health Connect imports are not yet covered by a two-account test.
