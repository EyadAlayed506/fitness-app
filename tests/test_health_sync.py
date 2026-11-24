"""Daily steps, Apple Health sleep and "source + last sync" (HEALTH-02/03).

The phones read Health Connect / Apple Health and send what they read; these tests cover what the server
does with it. They are synthetic: nothing here proves a real phone reads the data.
"""

import datetime as dt

from sqlmodel import select

from app.models.health import DailySteps, HealthSync
from app.models.sleep import SleepEntry
from tests.conftest import signup_and_login
from tests.test_health_connect import YESTERDAY, night, send
from tests.test_whoop import connect, fake_whoop  # noqa: F401 (fixture)

TODAY = dt.date.today()


def steps(client, auth, *days, source="health_connect", tz=3 * 3600):
    body = {"source": source, "tz_offset_seconds": tz, "days": [{"date": str(d), "steps": n} for d, n in days]}
    return client.post("/api/health/steps", json=body, headers=auth)


def apple(client, auth, *sessions):
    r = client.post("/api/sleep/apple-health", json={"sessions": list(sessions)}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- steps ----------

def test_steps_upload_and_repeat_sync_does_not_inflate(client, auth, session):
    r = steps(client, auth, (YESTERDAY, 8412), (TODAY, 1290))
    assert r.status_code == 200, r.text
    assert r.json() == {"inserted": 2, "updated": 0}

    # Later today: the phone sends the same days again with today's total grown
    r = steps(client, auth, (YESTERDAY, 8412), (TODAY, 5004))
    assert r.json() == {"inserted": 0, "updated": 2}

    rows = session.exec(select(DailySteps).order_by(DailySteps.date)).all()
    assert [(r.date, r.steps) for r in rows] == [(YESTERDAY, 8412), (TODAY, 5004)]  # replaced, not added


def test_missing_day_is_absent_and_zero_is_kept(client, auth):
    two_days_ago = TODAY - dt.timedelta(days=2)
    steps(client, auth, (two_days_ago, 0), (TODAY, 300))  # yesterday has no value: the phone doesn't send it
    days = {d["date"]: d for d in client.get("/api/health/steps?days=3", headers=auth).json()["days"]}
    assert days[str(two_days_ago)]["steps"] == 0  # a real zero stays zero
    assert days[str(YESTERDAY)]["steps"] is None  # missing is null, never 0
    assert days[str(YESTERDAY)]["source"] is None
    assert days[str(TODAY)] == {"date": str(TODAY), "steps": 300, "source": "health_connect"}


def test_two_sources_same_day_are_never_added(client, auth):
    steps(client, auth, (TODAY, 4000), source="health_connect")
    steps(client, auth, (TODAY, 6500), source="apple_health")
    day = client.get("/api/health/steps?days=1", headers=auth).json()["days"][0]
    assert day == {"date": str(TODAY), "steps": 6500, "source": "apple_health"}  # the latest sync, not 10500


def test_steps_validation(client, auth):
    assert steps(client, auth, (TODAY, -5)).status_code == 422
    assert steps(client, auth, (TODAY, 10), source="whoop").status_code == 422  # WHOOP has no steps
    assert steps(client, auth, (TODAY + dt.timedelta(days=2), 10)).status_code == 422  # no future days
    assert steps(client, auth, (TODAY, 10), tz=19 * 3600).status_code == 422
    # the same day twice in one request is ambiguous
    assert steps(client, auth, (TODAY, 10), (TODAY, 20)).status_code == 422
    assert client.post("/api/health/steps", json={"source": "health_connect", "days": []}, headers=auth).json() == {
        "inserted": 0, "updated": 0,
    }


def test_steps_need_login(client):
    assert client.post("/api/health/steps", json={"source": "health_connect", "days": []}).status_code == 401
    assert client.get("/api/health/steps").status_code == 401
    assert client.get("/api/health/connectors").status_code == 401


def test_steps_stay_in_their_own_account(client, session):
    ali = signup_and_login(client, email="ali@example.com")
    noor = signup_and_login(client, email="noor@example.com")
    steps(client, ali, (TODAY, 7000))
    steps(client, noor, (TODAY, 1200))
    assert client.get("/api/health/steps?days=1", headers=ali).json()["days"][0]["steps"] == 7000
    assert client.get("/api/health/steps?days=1", headers=noor).json()["days"][0]["steps"] == 1200
    assert len(session.exec(select(DailySteps)).all()) == 2


# ---------- Apple Health sleep ----------

def test_apple_health_sleep_import_and_repeat(client, auth, session):
    s = night("hk-uuid-1", app="com.apple.health")
    assert apple(client, auth, s)["imported"] == 1
    assert apple(client, auth, s) == {"imported": 0, "updated": 1, "replaced_manual": 0, "skipped": 0}
    rows = session.exec(select(SleepEntry)).all()
    assert len(rows) == 1 and rows[0].source == "apple_health" and rows[0].external_id == "hk-uuid-1"
    assert rows[0].deep_minutes == 100  # stages map the same way as Health Connect's
    assert client.get("/api/sleep", headers=auth).json()[0]["source"] == "apple_health"


def test_apple_and_health_connect_same_night_count_once(client, auth, session):
    send(client, auth, night("hc-1"))
    assert apple(client, auth, night("hk-1", app="com.apple.health"))["skipped"] == 1
    assert len(session.exec(select(SleepEntry)).all()) == 1


def test_apple_health_times_cannot_be_edited(client, auth):
    apple(client, auth, night("hk-1"))
    entry = client.get("/api/sleep", headers=auth).json()[0]
    r = client.patch(f"/api/sleep/{entry['id']}", json={"bedtime": "2026-01-01T22:00:00"}, headers=auth)
    assert r.status_code == 409 and "Apple Health" in r.json()["detail"]


def test_whoop_wins_over_apple_health(client, auth, session, fake_whoop):
    apple(client, auth, night("hk-1"))
    connect(client, auth)  # WHOOP's night overlaps it
    session.expire_all()
    sources = [r.source for r in session.exec(select(SleepEntry)).all()]
    assert "apple_health" not in sources and "whoop" in sources


# ---------- source + last sync ----------

def test_connectors_report_source_and_last_sync(client, auth):
    before = client.get("/api/health/connectors", headers=auth).json()["connectors"]
    by_source = {c["source"]: c for c in before}
    assert set(by_source) == {"health_connect", "apple_health", "whoop"}
    assert all(c["last_sync_at"] is None for c in before)
    assert by_source["whoop"]["connected"] is False and by_source["whoop"]["configured"] is False
    assert by_source["health_connect"]["metrics"] == ["sleep", "steps"]
    assert by_source["whoop"]["metrics"] == ["sleep", "recovery"]

    send(client, auth, night("hc-1"))
    steps(client, auth, (TODAY, 100), source="apple_health")
    after = {c["source"]: c for c in client.get("/api/health/connectors", headers=auth).json()["connectors"]}
    assert after["health_connect"]["last_sync_at"] is not None
    assert after["apple_health"]["last_sync_at"] is not None
    assert after["whoop"]["last_sync_at"] is None


def test_empty_sync_still_counts_as_a_sync(client, auth):
    """A sync that found nothing is still a sync: the screen can say 'synced, no data' instead of 'never'."""
    send(client, auth)
    hc = next(c for c in client.get("/api/health/connectors", headers=auth).json()["connectors"] if c["source"] == "health_connect")
    assert hc["last_sync_at"] is not None


def test_whoop_connector_after_connect(client, auth, fake_whoop):
    connect(client, auth)
    whoop = next(c for c in client.get("/api/health/connectors", headers=auth).json()["connectors"] if c["source"] == "whoop")
    assert whoop["connected"] is True and whoop["configured"] is True and whoop["last_sync_at"] is not None


def test_last_sync_is_per_account(client):
    ali = signup_and_login(client, email="ali@example.com")
    noor = signup_and_login(client, email="noor@example.com")
    steps(client, ali, (TODAY, 10))
    noor_hc = next(c for c in client.get("/api/health/connectors", headers=noor).json()["connectors"] if c["source"] == "health_connect")
    assert noor_hc["last_sync_at"] is None


def test_delete_account_removes_steps_and_sync_records(client, auth, session):
    steps(client, auth, (TODAY, 10))
    assert client.delete("/api/me", headers=auth).status_code == 204
    assert session.exec(select(DailySteps)).all() == []
    assert session.exec(select(HealthSync)).all() == []


def test_weekly_summary_counts_apple_health_nights(client, auth, session):
    from tests.conftest import add_sleep
    from tests.test_weekly_summary import LAST_WEEK, setup_user, summary

    user = setup_user(client, auth, session)
    add_sleep(session, user, LAST_WEEK + dt.timedelta(days=1), 7 * 60, source="apple_health")
    add_sleep(session, user, LAST_WEEK + dt.timedelta(days=2), 6 * 60, source="health_connect")
    sleep = summary(client, auth, LAST_WEEK)["sleep"]
    assert (sleep["from_apple_health"], sleep["from_health_connect"], sleep["logged_by_hand"]) == (1, 1, 0)
