"""Pilot accounts (BE-02): closed sign-up, the tester roster, revoking access, and testers' records staying separate."""

import datetime as dt

import jwt
import pytest
from sqlmodel import select

from app.config import get_settings
from app.models.user import User
from app.models.workout import WorkoutSession
from app.pilot_accounts import main, parse_roster, sync_pilot_accounts
from tests.conftest import PROFILE

ROSTER = {"ali@pilot.local": "ali-pass-1", "noor@pilot.local": "noor-pass-1"}


def login(client, email, password):
    return client.post("/api/auth/login", data={"username": email, "password": password})


def headers_for(client, email, password) -> dict:
    r = login(client, email, password)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def closed_signup(monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_signup", False)


# ---------- closed sign-up ----------

def test_signup_closed_on_the_pilot_server(client, session, closed_signup):
    r = client.post("/api/auth/signup", json={"email": "stranger@example.com", "password": "secret123"})
    assert r.status_code == 403
    assert r.json() == {"detail": "Sign-up is closed for this pilot"}
    assert session.exec(select(User)).all() == []


def test_pilot_accounts_can_log_in_when_signup_is_closed(client, session, closed_signup):
    sync_pilot_accounts(session, ROSTER)
    me = client.get("/api/me", headers=headers_for(client, "ali@pilot.local", "ali-pass-1"))
    assert me.status_code == 200 and me.json()["email"] == "ali@pilot.local"


# ---------- roster parsing ----------

def test_parse_roster():
    roster = parse_roster(" Ali@Pilot.local:ali-pass-1 , noor@pilot.local:has:colons:1,")
    assert roster == {"ali@pilot.local": "ali-pass-1", "noor@pilot.local": "has:colons:1"}


@pytest.mark.parametrize("spec, message", [
    ("", "empty"),
    ("ali@pilot.local", "email:password"),
    ("ali@pilot.local:", "email:password"),
    ("not-an-email:long-enough-1", "not a valid email"),
    ("ali@pilot.local:short", "at least 8"),
    ("ali@pilot.local:pass-one-1,ALI@pilot.local:pass-two-2", "listed twice"),
])
def test_parse_roster_rejects_bad_entries_without_showing_passwords(spec, message):
    with pytest.raises(ValueError) as e:
        parse_roster(spec)
    assert message in str(e.value)
    for secret in ("short", "pass-one-1", "pass-two-2", "long-enough-1"):
        assert secret not in str(e.value)


def test_command_refuses_a_bad_roster_without_printing_it(monkeypatch, capsys):
    monkeypatch.setattr(get_settings(), "pilot_accounts", "ali@pilot.local:tiny")
    assert main([]) == 2
    out = capsys.readouterr()
    assert "at least 8" in out.err
    assert "tiny" not in out.err + out.out


# ---------- sync ----------

def test_sync_creates_accounts_and_is_idempotent(client, session):
    first = sync_pilot_accounts(session, ROSTER)
    assert sorted(first.created) == sorted(ROSTER)
    for email, password in ROSTER.items():
        assert login(client, email, password).status_code == 200

    second = sync_pilot_accounts(session, ROSTER)
    assert sorted(second.unchanged) == sorted(ROSTER)
    assert not (second.created or second.password_changed or second.enabled or second.disabled)


def test_dry_run_changes_nothing(client, session):
    result = sync_pilot_accounts(session, ROSTER, dry_run=True)
    assert sorted(result.created) == sorted(ROSTER)
    assert session.exec(select(User)).all() == []


def test_removed_tester_loses_access_but_keeps_data(client, session):
    sync_pilot_accounts(session, ROSTER)
    ali = headers_for(client, "ali@pilot.local", "ali-pass-1")
    assert client.post("/api/workouts", json={}, headers=ali).status_code == 201

    result = sync_pilot_accounts(session, {"noor@pilot.local": "noor-pass-1"})
    assert result.disabled == ["ali@pilot.local"]
    # the token already on Ali's phone stops working at once
    r = client.get("/api/workouts", headers=ali)
    assert r.status_code == 401 and r.json()["detail"] == "Not logged in or session expired"
    # and Ali can't log in again
    r = login(client, "ali@pilot.local", "ali-pass-1")
    assert r.status_code == 403 and r.json()["detail"] == "This account no longer has access to the pilot"
    # Noor is unaffected
    assert login(client, "noor@pilot.local", "noor-pass-1").status_code == 200
    # nothing was deleted
    ali_user = session.exec(select(User).where(User.email == "ali@pilot.local")).one()
    assert len(session.exec(select(WorkoutSession).where(WorkoutSession.user_id == ali_user.id)).all()) == 1

    # adding Ali back restores access and the old records
    again = sync_pilot_accounts(session, ROSTER)
    assert again.enabled == ["ali@pilot.local"]
    ali = headers_for(client, "ali@pilot.local", "ali-pass-1")
    assert len(client.get("/api/workouts", headers=ali).json()) == 1


def test_password_change_logs_out_old_sessions(client, session):
    sync_pilot_accounts(session, ROSTER)
    old = headers_for(client, "ali@pilot.local", "ali-pass-1")

    result = sync_pilot_accounts(session, {**ROSTER, "ali@pilot.local": "ali-pass-2"})
    assert result.password_changed == ["ali@pilot.local"]
    assert client.get("/api/me", headers=old).status_code == 401
    assert login(client, "ali@pilot.local", "ali-pass-1").status_code == 401
    new = headers_for(client, "ali@pilot.local", "ali-pass-2")
    assert client.get("/api/me", headers=new).status_code == 200


def test_unlisted_signup_accounts_are_disabled(client, session):
    # e.g. an account made while sign-up was still open on the server
    assert client.post("/api/auth/signup", json={"email": "early@example.com", "password": "secret123"}).status_code == 201
    result = sync_pilot_accounts(session, ROSTER)
    assert result.disabled == ["early@example.com"]
    assert login(client, "early@example.com", "secret123").status_code == 403


def test_tokens_from_before_this_change_still_work(client, session):
    """Tokens issued before versions existed have no "ver" claim; users stay logged in after the upgrade."""
    sync_pilot_accounts(session, ROSTER)
    user = session.exec(select(User).where(User.email == "ali@pilot.local")).one()
    s = get_settings()
    legacy = jwt.encode(
        {"sub": str(user.id), "exp": dt.datetime.now(dt.UTC) + dt.timedelta(minutes=5)},
        s.jwt_secret, algorithm=s.jwt_algorithm,
    )
    assert client.get("/api/me", headers={"Authorization": f"Bearer {legacy}"}).status_code == 200


# ---------- testers' records stay separate ----------

def test_testers_cannot_see_or_change_each_others_records(client, session):
    sync_pilot_accounts(session, ROSTER)
    ali = headers_for(client, "ali@pilot.local", "ali-pass-1")
    noor = headers_for(client, "noor@pilot.local", "noor-pass-1")
    for h in (ali, noor):
        assert client.put("/api/me/profile", json=PROFILE, headers=h).status_code == 200

    # Ali records one of each
    workout = client.post("/api/workouts", json={}, headers=ali).json()
    yesterday = dt.date.today() - dt.timedelta(days=1)
    sleep = client.post("/api/sleep", json={
        "bedtime": f"{yesterday - dt.timedelta(days=1)}T23:00:00", "wake_time": f"{yesterday}T07:00:00",
    }, headers=ali)
    assert sleep.status_code == 201, sleep.text
    sleep = sleep.json()
    measurement = client.post("/api/measurements", json={"date": str(yesterday), "waist_cm": 90}, headers=ali).json()
    food = client.post("/api/foods", json={
        "name": "Ali's bar", "serving_size": 40, "serving_unit": "g",
        "calories": 180, "protein_g": 10, "carbs_g": 20, "fat_g": 7,
    }, headers=ali).json()
    food_log = client.post("/api/food-logs", json={"food_id": food["id"], "quantity": 1, "unit": "serving"}, headers=ali)
    assert food_log.status_code == 201, food_log.text
    food_log = food_log.json()

    # Noor's lists are empty
    assert client.get("/api/workouts", headers=noor).json() == []
    assert client.get("/api/sleep", headers=noor).json() == []
    assert client.get("/api/measurements", headers=noor).json() == []
    assert client.get("/api/food-logs", headers=noor).json()["entries"] == []
    assert client.get("/api/foods/mine", headers=noor).json() == []

    # and Ali's records look missing to Noor, whatever she tries
    assert client.get(f"/api/workouts/{workout['id']}", headers=noor).status_code == 404
    assert client.patch(f"/api/workouts/{workout['id']}", json={"notes": "x"}, headers=noor).status_code == 404
    assert client.delete(f"/api/workouts/{workout['id']}", headers=noor).status_code == 404
    assert client.patch(f"/api/sleep/{sleep['id']}", json={"quality": 1}, headers=noor).status_code == 404
    assert client.delete(f"/api/sleep/{sleep['id']}", headers=noor).status_code == 404
    assert client.delete(f"/api/measurements/{measurement['id']}", headers=noor).status_code == 404
    assert client.get(f"/api/foods/{food['id']}", headers=noor).status_code == 404
    assert client.patch(f"/api/food-logs/{food_log['id']}", json={"quantity": 3}, headers=noor).status_code == 404
    assert client.delete(f"/api/food-logs/{food_log['id']}", headers=noor).status_code == 404

    # Ali still has everything, unchanged
    assert client.get(f"/api/workouts/{workout['id']}", headers=ali).status_code == 200
    assert len(client.get("/api/sleep", headers=ali).json()) == 1
    assert len(client.get("/api/measurements", headers=ali).json()) == 1
    day = client.get("/api/food-logs", headers=ali).json()
    assert len(day["entries"]) == 1 and day["entries"][0]["quantity"] == 1
