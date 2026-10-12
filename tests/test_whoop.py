"""WHOOP connection and sleep import, against a fake WHOOP server (no real WHOOP account needed)."""

import datetime as dt
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlmodel import select

from app.config import get_settings
from app.main import app
from app.models.sleep import SleepEntry
from app.routers.whoop import get_whoop_http

TODAY = dt.datetime.now(dt.UTC).date()
YESTERDAY = TODAY - dt.timedelta(days=1)
NIGHT_ID = "ecfc6a15-4661-442f-a9a4-f160dd7afae8"
NAP_ID = "7a3f5b61-0c2d-4e7b-9f00-1b2c3d4e5f60"
MIN = 60_000  # milliseconds per minute


def sleep_records():
    return [
        {  # 20:30Z -> 04:15Z, recorded at UTC+3: 23:30 -> 07:15 local
            "id": NIGHT_ID, "cycle_id": 93845, "user_id": 10129,
            "start": f"{YESTERDAY}T20:30:00.000Z", "end": f"{TODAY}T04:15:00.000Z",
            "timezone_offset": "+03:00", "nap": False, "score_state": "SCORED",
            "score": {
                "stage_summary": {
                    "total_in_bed_time_milli": 465 * MIN, "total_awake_time_milli": 30 * MIN,
                    "total_no_data_time_milli": 0, "total_light_sleep_time_milli": 210 * MIN,
                    "total_slow_wave_sleep_time_milli": 105 * MIN, "total_rem_sleep_time_milli": 120 * MIN,
                    "sleep_cycle_count": 4, "disturbance_count": 9,
                },
                "respiratory_rate": 16.1, "sleep_performance_percentage": 91,
                "sleep_consistency_percentage": 80, "sleep_efficiency_percentage": 93.5,
            },
        },
        {  # a nap WHOOP hasn't scored yet
            "id": NAP_ID, "cycle_id": 93846, "user_id": 10129,
            "start": f"{TODAY}T10:00:00.000Z", "end": f"{TODAY}T10:40:00.000Z",
            "timezone_offset": "+03:00", "nap": True, "score_state": "PENDING_SCORE", "score": None,
        },
    ]


class FakeWhoop:
    """Just enough of api.prod.whoop.com for the app's calls."""

    def __init__(self):
        self.valid_tokens = set()
        self.refresh_tokens = set()
        self.calls = []
        self.records = sleep_records()
        self.down = False
        self.counter = 0

    def _issue(self):
        self.counter += 1
        access, refresh = f"at{self.counter}", f"rt{self.counter}"
        self.valid_tokens.add(access)
        self.refresh_tokens.add(refresh)
        return httpx.Response(200, json={"access_token": access, "refresh_token": refresh, "expires_in": 3600, "token_type": "bearer"})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(f"{request.method} {request.url.path}")
        if self.down:
            return httpx.Response(503)
        path = request.url.path
        if path == "/oauth/oauth2/token":
            form = parse_qs(request.content.decode())
            assert form["client_id"] == ["cid"] and form["client_secret"] == ["secret"]
            grant = form["grant_type"][0]
            if grant == "authorization_code" and form["code"] == ["good-code"]:
                assert form["redirect_uri"] == ["http://localhost:8000/api/whoop/callback"]
                return self._issue()
            if grant == "refresh_token" and form["refresh_token"][0] in self.refresh_tokens:
                self.refresh_tokens.discard(form["refresh_token"][0])  # rotating refresh tokens
                return self._issue()
            return httpx.Response(400, json={"error": "invalid_grant"})
        token = request.headers.get("Authorization", "").removeprefix("Bearer ")
        if token not in self.valid_tokens:
            return httpx.Response(401)
        if path == "/developer/v2/user/profile/basic":
            return httpx.Response(200, json={"user_id": 10129, "email": "sam@example.com", "first_name": "Sam", "last_name": "Lee"})
        if path == "/developer/v2/activity/sleep":
            q = request.url.params
            assert q["start"].endswith("Z") and q["end"].endswith("Z") and q["limit"] == "25"
            # one record per page, to exercise pagination
            if q.get("nextToken") == "p2":
                return httpx.Response(200, json={"records": self.records[1:], "next_token": None})
            return httpx.Response(200, json={"records": self.records[:1], "next_token": "p2" if len(self.records) > 1 else None})
        if path == "/developer/v2/recovery":
            return httpx.Response(200, json={"records": [{
                "cycle_id": 93845, "sleep_id": NIGHT_ID, "user_id": 10129, "score_state": "SCORED",
                "score": {"user_calibrating": False, "recovery_score": 78, "resting_heart_rate": 52, "hrv_rmssd_milli": 61.2},
            }], "next_token": None})
        if path == "/developer/v2/user/access" and request.method == "DELETE":
            self.valid_tokens.discard(token)
            return httpx.Response(204)
        return httpx.Response(404)


@pytest.fixture
def fake_whoop(client, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "whoop_client_id", "cid")
    monkeypatch.setattr(settings, "whoop_client_secret", "secret")
    monkeypatch.setattr(settings, "whoop_redirect_uri", "http://localhost:8000/api/whoop/callback")
    fake = FakeWhoop()

    def http():
        with httpx.Client(transport=httpx.MockTransport(fake)) as c:
            yield c

    app.dependency_overrides[get_whoop_http] = http
    return fake


def connect(client, auth) -> str:
    """Run the whole login: get WHOOP's URL, then come back to the callback as WHOOP would."""
    url = client.post("/api/whoop/connect", headers=auth).json()["authorize_url"]
    q = parse_qs(urlparse(url).query)
    assert url.startswith("https://api.prod.whoop.com/oauth/oauth2/auth?")
    assert q["client_id"] == ["cid"] and q["response_type"] == ["code"]
    assert set(q["scope"][0].split()) >= {"offline", "read:sleep", "read:recovery"}
    assert len(q["state"][0]) >= 8
    r = client.get("/api/whoop/callback", params={"state": q["state"][0], "code": "good-code"})
    assert r.status_code == 200, r.text
    return r.text


def entries(session):
    return session.exec(select(SleepEntry).order_by(SleepEntry.bedtime)).all()


def test_not_configured(client, auth):
    status = client.get("/api/whoop", headers=auth).json()
    assert status == {
        "configured": False, "connected": False, "whoop_name": "", "connected_at": None, "last_sync_at": None,
        "redirect_uri": "http://localhost:8000/api/whoop/callback",
    }
    r = client.post("/api/whoop/connect", headers=auth)
    assert r.status_code == 503 and "WHOOP_CLIENT_ID" in r.json()["detail"]


def test_connect_imports_sleep(client, auth, session, fake_whoop):
    page = connect(client, auth)
    assert "WHOOP connected" in page and "Imported 2 nights" in page

    status = client.get("/api/whoop", headers=auth).json()
    assert status["connected"] and status["whoop_name"] == "Sam Lee" and status["last_sync_at"]

    night, nap = entries(session)
    assert night.source == "whoop" and night.external_id == NIGHT_ID
    assert night.bedtime == dt.datetime.combine(YESTERDAY, dt.time(23, 30))  # local clock time (UTC+3)
    assert night.wake_time == dt.datetime.combine(TODAY, dt.time(7, 15))
    assert night.date == TODAY
    assert night.duration_minutes == 435  # time asleep: light + deep + REM
    assert (night.light_minutes, night.deep_minutes, night.rem_minutes, night.awake_minutes) == (210, 105, 120, 30)
    assert night.performance_pct == 91 and night.quality == 5 and night.recovery_score == 78
    assert nap.duration_minutes == 40 and nap.quality is None and nap.recovery_score is None

    listed = client.get("/api/sleep", headers=auth).json()
    assert {e["source"] for e in listed} == {"whoop"}
    assert any(e["rem_minutes"] == 120 for e in listed)


def test_resync_updates_without_duplicates_and_keeps_notes(client, auth, session, fake_whoop):
    connect(client, auth)
    night = entries(session)[0]
    client.patch(f"/api/sleep/{night.id}", json={"notes": "late dinner"}, headers=auth)
    fake_whoop.records[0]["score"]["sleep_performance_percentage"] = 72
    result = client.post("/api/whoop/sync", headers=auth).json()
    assert result["imported"] == 0 and result["updated"] == 2
    session.expire_all()
    night = entries(session)[0]
    assert len(entries(session)) == 2 and night.quality == 4 and night.notes == "late dinner"


def test_whoop_replaces_overlapping_manual_sleep(client, auth, session, fake_whoop):
    manual = {"bedtime": f"{YESTERDAY}T23:00:00", "wake_time": f"{TODAY}T07:00:00", "quality": 2}
    other_night = {"bedtime": f"{YESTERDAY - dt.timedelta(days=1)}T23:00:00", "wake_time": f"{YESTERDAY}T07:00:00"}
    assert client.post("/api/sleep", json=manual, headers=auth).status_code == 201
    assert client.post("/api/sleep", json=other_night, headers=auth).status_code == 201
    connect(client, auth)
    sources = [(e.source, e.date) for e in entries(session)]
    assert ("manual", TODAY) not in sources  # replaced by WHOOP
    assert ("manual", YESTERDAY) in sources  # a night WHOOP doesn't have stays
    # typing in a night WHOOP already has is refused
    assert client.post("/api/sleep", json=manual, headers=auth).status_code == 409


def test_whoop_times_cannot_be_edited(client, auth, session, fake_whoop):
    connect(client, auth)
    night = entries(session)[0]
    r = client.patch(f"/api/sleep/{night.id}", json={"wake_time": f"{TODAY}T09:00:00"}, headers=auth)
    assert r.status_code == 409 and "WHOOP" in r.json()["detail"]
    assert client.patch(f"/api/sleep/{night.id}", json={"quality": 3}, headers=auth).status_code == 200


def test_expired_token_is_refreshed(client, auth, session, fake_whoop):
    from app.models.whoop import WhoopConnection

    connect(client, auth)
    conn = session.exec(select(WhoopConnection)).one()
    conn.token_expires_at = dt.datetime.now(dt.UTC) - dt.timedelta(minutes=1)
    session.add(conn)
    session.commit()
    assert client.post("/api/whoop/sync", headers=auth).status_code == 200
    assert fake_whoop.calls.count("POST /oauth/oauth2/token") == 2  # code exchange + one refresh
    session.refresh(conn)
    assert conn.refresh_token == "rt2"  # the new (rotated) refresh token is kept


def test_revoked_access_disconnects_but_keeps_app_login(client, auth, fake_whoop):
    connect(client, auth)
    fake_whoop.valid_tokens.clear()
    fake_whoop.refresh_tokens.clear()
    r = client.post("/api/whoop/sync", headers=auth)
    assert r.status_code == 409 and "Connect WHOOP again" in r.json()["detail"]
    assert client.get("/api/whoop", headers=auth).json()["connected"] is False
    assert client.get("/api/me", headers=auth).status_code == 200  # still logged in to this app


def test_whoop_down(client, auth, session, fake_whoop):
    connect(client, auth)
    before = len(entries(session))
    fake_whoop.down = True
    r = client.post("/api/whoop/sync", headers=auth)
    assert r.status_code == 502 and "WHOOP answered with an error" in r.json()["detail"]
    assert len(entries(session)) == before
    assert client.get("/api/whoop", headers=auth).json()["connected"] is True


def test_sync_skips_when_recent(client, auth, fake_whoop):
    connect(client, auth)
    calls = len(fake_whoop.calls)
    assert client.post("/api/whoop/sync?stale_minutes=15", headers=auth).json()["skipped"] is True
    assert len(fake_whoop.calls) == calls


def test_callback_rejects_bad_state_and_cancel(client, auth, fake_whoop):
    assert client.get("/api/whoop/callback", params={"state": "nope", "code": "good-code"}).status_code == 400
    url = client.post("/api/whoop/connect", headers=auth).json()["authorize_url"]
    state = parse_qs(urlparse(url).query)["state"][0]
    r = client.get("/api/whoop/callback", params={"state": state, "error": "access_denied"})
    assert "not connected" in r.text
    assert client.get("/api/whoop", headers=auth).json()["connected"] is False
    # the state can't be reused
    assert client.get("/api/whoop/callback", params={"state": state, "code": "good-code"}).status_code == 400


def test_sync_requires_connection(client, auth, fake_whoop):
    assert client.post("/api/whoop/sync", headers=auth).status_code == 409


def test_disconnect_keeps_imported_sleep(client, auth, session, fake_whoop):
    connect(client, auth)
    assert client.delete("/api/whoop", headers=auth).status_code == 204
    assert "DELETE /developer/v2/user/access" in fake_whoop.calls
    assert client.get("/api/whoop", headers=auth).json()["connected"] is False
    assert len(entries(session)) == 2


def test_delete_account_removes_whoop(client, auth, session, fake_whoop):
    from app.models.whoop import WhoopConnection

    connect(client, auth)
    assert client.delete("/api/me", headers=auth).status_code == 204
    assert session.exec(select(WhoopConnection)).all() == []
    assert entries(session) == []


def test_quality_mapping():
    from app.services.whoop import quality_from_performance

    assert [quality_from_performance(p) for p in (None, 95, 85, 84, 70, 69, 50, 49, 30, 29)] == [None, 5, 5, 4, 4, 3, 3, 2, 2, 1]


def test_old_database_gets_new_columns(tmp_path):
    """A database made by the previous version (no WHOOP columns) is upgraded in place."""
    from sqlalchemy import create_engine, inspect, text

    from app.database import add_missing_columns

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE sleepentry (id INTEGER PRIMARY KEY, user_id INTEGER, date DATE, bedtime DATETIME, "
            "wake_time DATETIME, duration_minutes INTEGER, quality INTEGER, notes VARCHAR, source VARCHAR, created_at DATETIME)"
        ))
        conn.execute(text("INSERT INTO sleepentry VALUES (1, 1, '2026-10-01', '2026-09-30 23:00:00', '2026-10-01 07:00:00', 480, 4, '', 'manual', '2026-10-01 07:05:00')"))
    added = add_missing_columns(engine)
    assert "sleepentry.external_id" in added and "sleepentry.rem_minutes" in added
    columns = {c["name"] for c in inspect(engine).get_columns("sleepentry")}
    assert {"recovery_score", "performance_pct"} <= columns
    with engine.connect() as conn:
        assert conn.execute(text("SELECT duration_minutes FROM sleepentry")).scalar() == 480
    assert add_missing_columns(engine) == []  # running again changes nothing


def test_settings_find_the_project_env_and_trim_keys(tmp_path, monkeypatch):
    from pathlib import Path

    from app.config import PROJECT_ENV, Settings

    assert PROJECT_ENV == Path(__file__).resolve().parent.parent / ".env"
    monkeypatch.chdir(tmp_path)  # started from another folder: the project's .env is still the one used
    s = Settings(whoop_client_id=' "abc123" ', whoop_client_secret=" secret\n")
    assert (s.whoop_client_id, s.whoop_client_secret) == ("abc123", "secret")


def test_status_shows_the_redirect_url_to_register(client, auth):
    body = client.get("/api/whoop", headers=auth).json()
    assert body["redirect_uri"].endswith("/api/whoop/callback")
