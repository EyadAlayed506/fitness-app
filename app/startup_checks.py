"""Settings that must be right before the server is shared with testers.

ALLOW_SIGNUP=false is what marks the shared pilot server (local development keeps sign-up open). On that
server the app refuses to start with a guessable JWT_SECRET, because anyone who knows the secret can make a
login token for any tester.
"""

import subprocess

from app.config import DEFAULT_JWT_SECRET, PROJECT_DIR, Settings

MIN_SECRET_LENGTH = 32


def pilot_server_problems(s: Settings) -> list[str]:
    """Reasons the shared pilot server must not start. Empty when the settings are safe (or this is a dev machine)."""
    if s.allow_signup:
        return []
    problems = []
    if s.jwt_secret == DEFAULT_JWT_SECRET or s.jwt_secret.startswith("change-me"):
        problems.append("JWT_SECRET is still the example value. Set a long random one in .env")
    elif len(s.jwt_secret) < MIN_SECRET_LENGTH:
        problems.append(f"JWT_SECRET is shorter than {MIN_SECRET_LENGTH} characters")
    if not s.pilot_accounts.strip():
        problems.append("PILOT_ACCOUNTS is empty, so nobody could log in. List the testers in .env")
    return problems


def pilot_server_warnings(s: Settings) -> list[str]:
    """Worth fixing, but not a reason to stop."""
    if s.allow_signup:
        return []
    warnings = []
    if s.jwt_expire_minutes < 60:
        warnings.append(f"Sessions last {s.jwt_expire_minutes} minutes; testers will be logged out often (JWT_EXPIRE_MINUTES)")
    if s.anthropic_api_key and s.assistant_daily_limit <= 0:
        warnings.append("Claude is configured without a daily question limit (ASSISTANT_DAILY_LIMIT)")
    return warnings


def current_commit() -> str:
    """Short git commit of the running code, or "unknown" (e.g. no git on the server)."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=PROJECT_DIR, capture_output=True, text=True, timeout=5, check=True,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"
