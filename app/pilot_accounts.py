"""Pilot tester accounts: make the database match the roster in PILOT_ACCOUNTS.

    uv run python -m app.pilot_accounts            # apply
    uv run python -m app.pilot_accounts --dry-run  # only show what would change

PILOT_ACCOUNTS (server .env only, never in git) is "email:password,email:password".
- A listed email without an account gets one.
- A listed account whose password changed gets the new password and is logged out everywhere.
- A listed account that was disabled is enabled again.
- An account that is not listed is disabled and logged out everywhere. Its records are kept, so adding
  it back restores access with all its data. Nothing is ever deleted.
Passwords are never printed.
"""

import argparse
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlmodel import Session, select

from app.models.user import User
from app.security import hash_password, verify_password

MIN_PASSWORD_LENGTH = 8


@dataclass
class SyncResult:
    created: list[str] = field(default_factory=list)
    password_changed: list[str] = field(default_factory=list)
    enabled: list[str] = field(default_factory=list)
    disabled: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)


def parse_roster(spec: str) -> dict[str, str]:
    """Turn "a@x.com:pw1, b@x.com:pw2" into {"a@x.com": "pw1", ...}.

    Raises ValueError naming the bad entry, never its password.
    """
    roster: dict[str, str] = {}
    for i, raw in enumerate(spec.split(","), start=1):
        entry = raw.strip()
        if not entry:
            continue
        email, sep, password = entry.partition(":")
        email = email.strip().lower()
        if not sep or not password:
            raise ValueError(f"Entry {i} ({email or '?'}) needs the form email:password")
        name, at, domain = email.partition("@")
        if not (name and at and domain) or "@" in domain or any(c.isspace() for c in email):
            raise ValueError(f"Entry {i} ({email}) is not a valid email")
        if len(password) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Entry {i} ({email}): password must be at least {MIN_PASSWORD_LENGTH} characters")
        if email in roster:
            raise ValueError(f"Entry {i} ({email}) is listed twice")
        roster[email] = password
    if not roster:
        raise ValueError("PILOT_ACCOUNTS is empty: list at least one email:password")
    return roster


def _log_out_everywhere(user: User) -> None:
    user.token_version = (user.token_version or 0) + 1


def sync_pilot_accounts(session: Session, roster: dict[str, str], dry_run: bool = False) -> SyncResult:
    result = SyncResult()
    now = datetime.now(UTC)
    existing = {u.email.lower(): u for u in session.exec(select(User)).all()}

    for email, password in roster.items():
        user = existing.get(email)
        if user is None:
            result.created.append(email)
            if not dry_run:
                session.add(User(email=email, hashed_password=hash_password(password)))
            continue
        changed = False
        if user.disabled_at is not None:
            result.enabled.append(email)
            changed = True
            if not dry_run:
                user.disabled_at = None
        if not verify_password(password, user.hashed_password):
            result.password_changed.append(email)
            changed = True
            if not dry_run:
                user.hashed_password = hash_password(password)
                _log_out_everywhere(user)
        if changed:
            session.add(user)
        else:
            result.unchanged.append(email)

    for email, user in existing.items():
        if email in roster or user.disabled_at is not None:
            continue
        result.disabled.append(email)
        if not dry_run:
            user.disabled_at = now
            _log_out_everywhere(user)
            session.add(user)

    if dry_run:
        session.rollback()
    else:
        session.commit()
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="show what would change without saving")
    args = parser.parse_args(argv)

    from app.config import get_settings
    from app.database import create_db_and_tables, engine

    try:
        roster = parse_roster(get_settings().pilot_accounts)
    except ValueError as e:
        print(f"PILOT_ACCOUNTS: {e}", file=sys.stderr)
        return 2

    create_db_and_tables()  # also adds the new columns to an older database
    with Session(engine) as session:
        result = sync_pilot_accounts(session, roster, dry_run=args.dry_run)

    prefix = "Would be " if args.dry_run else ""
    for label, emails in [
        ("created", result.created),
        ("given a new password (logged out)", result.password_changed),
        ("enabled again", result.enabled),
        ("disabled (logged out, data kept)", result.disabled),
        ("unchanged", result.unchanged),
    ]:
        if emails:
            print(f"{prefix}{label}: {', '.join(emails)}")
    if not get_settings().allow_signup:
        print("Sign-up is closed (ALLOW_SIGNUP=false).")
    else:
        print("Warning: sign-up is still open. Set ALLOW_SIGNUP=false on the shared server.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
