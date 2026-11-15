"""Release tools (BE-04): the smoke check and keeping private URL parts out of the request log."""

import logging

import pytest
from sqlmodel import select

from app.config import get_settings
from app.log_redaction import RedactUrls, redact
from app.models.measurement import BodyMeasurement
from app.models.user import User
from app.pilot_accounts import sync_pilot_accounts
from app.smoke import run_smoke

ACCOUNTS = [("ali@pilot.local", "ali-pass-1"), ("noor@pilot.local", "noor-pass-1")]


@pytest.fixture
def pilot(client, session, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_signup", False)
    sync_pilot_accounts(session, dict(ACCOUNTS))
    return client


def test_smoke_passes_on_a_correct_pilot_server(pilot, session):
    results = run_smoke(pilot, ACCOUNTS)
    assert [c.name for c in results if not c.ok] == []
    assert len(results) >= 10
    assert session.exec(select(BodyMeasurement)).all() == []  # the test record was removed


def test_smoke_reports_open_signup_without_creating_an_account(client, session):
    sync_pilot_accounts(session, dict(ACCOUNTS))  # sign-up left open
    results = {c.name: c for c in run_smoke(client, ACCOUNTS)}
    assert not results["sign-up is closed"].ok and "ALLOW_SIGNUP" in results["sign-up is closed"].detail
    assert len(session.exec(select(User)).all()) == 2


def test_smoke_stops_on_a_wrong_password(pilot):
    results = run_smoke(pilot, [ACCOUNTS[0], ("noor@pilot.local", "wrong-password")])
    assert not results[-1].ok and results[-1].name == "noor@pilot.local can log in"


@pytest.mark.parametrize("url, expected", [
    ("/api/whoop/callback?state=abc&code=XyZ-9_", "/api/whoop/callback?state=[redacted]&code=[redacted]"),
    ("/api/whoop/callback?code=XyZ&scope=read", "/api/whoop/callback?code=[redacted]&scope=read"),
    ("/api/marketing/unsubscribe/Tok_en-123", "/api/marketing/unsubscribe/[redacted]"),
    ("/api/workouts/12?date=2026-11-15", "/api/workouts/12?date=2026-11-15"),
    ("/api/foods/search?q=code", "/api/foods/search?q=code"),
])
def test_redact(url, expected):
    assert redact(url) == expected


def test_access_log_line_is_redacted():
    # the shape of uvicorn's access log call
    record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d',
                               ("1.2.3.4:5", "GET", "/api/whoop/callback?state=s3cr3t&code=c0de", "1.1", 200), None)
    assert RedactUrls().filter(record) is True
    line = record.getMessage()
    assert "s3cr3t" not in line and "c0de" not in line and line.endswith('HTTP/1.1" 200')


def test_filter_is_installed_on_the_access_log():
    import app.main  # noqa: F401  (installs it)

    assert any(isinstance(f, RedactUrls) for f in logging.getLogger("uvicorn.access").filters)
