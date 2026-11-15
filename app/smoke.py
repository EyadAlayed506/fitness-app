"""Check a running server end to end with two tester accounts.

    uv run python -m app.smoke                                   # this PC's server, accounts from PILOT_ACCOUNTS
    uv run python -m app.smoke --url https://<machine>.<tailnet>.ts.net

Accounts: the first two entries of SMOKE_ACCOUNTS if set (same "email:password,email:password" form),
otherwise of PILOT_ACCOUNTS. Put them in the environment or .env, never on the command line.

It leaves no trace in the testers' records: the one body measurement it creates is deleted again, and the sign-up
check uses an email that already exists, so even an open server creates nothing.
Exit code 0 = every check passed.
"""

import argparse
import os
import sys
from dataclasses import dataclass

import httpx

from app.pilot_accounts import parse_roster


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


def run_smoke(client: httpx.Client, accounts: list[tuple[str, str]]) -> list[Check]:
    """client: an httpx.Client pointed at the server (FastAPI's TestClient also works)."""
    results: list[Check] = []

    def check(name: str, ok: bool, detail: str = "") -> bool:
        results.append(Check(name, ok, detail))
        return ok

    r = client.get("/api/health")
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    check("server is up", r.status_code == 200 and body.get("status") == "ok",
          f"HTTP {r.status_code}, version {body.get('version')}, commit {body.get('commit')}")

    if len(accounts) < 2:
        check("two tester accounts given", False, "set SMOKE_ACCOUNTS or PILOT_ACCOUNTS with at least two entries")
        return results

    headers = []
    for email, password in accounts[:2]:
        r = client.post("/api/auth/login", data={"username": email, "password": password})
        if not check(f"{email} can log in", r.status_code == 200, f"HTTP {r.status_code}"):
            return results
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        me = client.get("/api/me", headers=h)
        check(f"{email} sees their own profile", me.status_code == 200 and me.json().get("email") == email)
        headers.append(h)
    a, b = headers

    r = client.post("/api/auth/signup", json={"email": accounts[0][0], "password": "smoke-test-only-1"})
    check("sign-up is closed", r.status_code == 403,
          "open: set ALLOW_SIGNUP=false" if r.status_code == 409 else f"HTTP {r.status_code}")

    r = client.get("/api/me", headers={"Authorization": "Bearer not-a-real-token"})
    check("a fake login token is refused", r.status_code == 401, f"HTTP {r.status_code}")

    # a body measurement has no side effects, so creating and deleting it leaves the account as it was
    r = client.post("/api/measurements", json={"waist_cm": 80}, headers=a)
    if check("tester 1 can save a record", r.status_code == 201, f"HTTP {r.status_code}"):
        mid = r.json()["id"]
        try:
            ids_b = [m["id"] for m in client.get("/api/measurements", headers=b).json()]
            check("tester 2 cannot see it", mid not in ids_b)
            check("tester 2 cannot delete it", client.delete(f"/api/measurements/{mid}", headers=b).status_code == 404)
            ids_a = [m["id"] for m in client.get("/api/measurements", headers=a).json()]
            check("tester 1 still has it", mid in ids_a)
        finally:
            r = client.delete(f"/api/measurements/{mid}", headers=a)
            check("test record removed again", r.status_code == 204, f"HTTP {r.status_code}")
    return results


def accounts_from_env() -> list[tuple[str, str]]:
    from app.config import get_settings

    spec = os.environ.get("SMOKE_ACCOUNTS") or get_settings().pilot_accounts
    return list(parse_roster(spec).items())[:2]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="server address (default: this PC)")
    args = parser.parse_args(argv)
    try:
        accounts = accounts_from_env()
    except ValueError as e:
        print(f"Accounts: {e}", file=sys.stderr)
        return 2
    try:
        with httpx.Client(base_url=args.url.rstrip("/"), timeout=20) as client:
            results = run_smoke(client, accounts)
    except httpx.HTTPError as e:
        print(f"FAIL  could not reach {args.url}: {type(e).__name__}", file=sys.stderr)
        return 1
    for c in results:
        print(f"{'PASS' if c.ok else 'FAIL'}  {c.name}{f'  ({c.detail})' if c.detail else ''}")
    failed = [c for c in results if not c.ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed against {args.url}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
