"""Sleep from Android Health Connect: the phone sends the sessions it read, the server stores them."""

import datetime as dt

from sqlmodel import select

from app.models.sleep import SleepEntry
from tests.test_whoop import connect, fake_whoop  # noqa: F401 (fixture)

TODAY = dt.datetime.now(dt.UTC).date()
YESTERDAY = TODAY - dt.timedelta(days=1)
PLUS_3 = 3 * 3600


def at(day: dt.date, clock: str) -> str:
    return f"{day}T{clock}Z"


def night(record_id="hc-night-1", stages=True, start="20:30:00", end="04:15:00", app="com.sec.android.app.shealth"):
    """20:30Z -> 04:15Z recorded at UTC+3: 23:30 -> 07:15 local, the same night as the fake WHOOP's."""
    session = {
        "id": record_id, "start_time": at(YESTERDAY, start), "end_time": at(TODAY, end),
        "zone_offset_seconds": PLUS_3, "app": app,
    }
    if stages:
        session["stages"] = [
            {"start_time": at(YESTERDAY, "20:30:00"), "end_time": at(YESTERDAY, "20:50:00"), "stage": 1},  # awake 20
            {"start_time": at(YESTERDAY, "20:50:00"), "end_time": at(YESTERDAY, "23:20:00"), "stage": 4},  # light 150
            {"start_time": at(YESTERDAY, "23:20:00"), "end_time": at(TODAY, "01:00:00"), "stage": 5},  # deep 100
            {"start_time": at(TODAY, "01:00:00"), "end_time": at(TODAY, "02:30:00"), "stage": 6},  # REM 90
            {"start_time": at(TODAY, "02:30:00"), "end_time": at(TODAY, "04:00:00"), "stage": 4},  # light 90
            {"start_time": at(TODAY, "04:00:00"), "end_time": at(TODAY, "04:15:00"), "stage": 3},  # out of bed 15
        ]
    return session


def send(client, auth, *sessions):
    r = client.post("/api/sleep/health-connect", json={"sessions": list(sessions)}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def entries(session):
    session.expire_all()
    return session.exec(select(SleepEntry).order_by(SleepEntry.bedtime)).all()


def test_import_maps_times_and_stages(client, auth, session):
    assert send(client, auth, night()) == {"imported": 1, "updated": 0, "replaced_manual": 0, "skipped": 0}
    (e,) = entries(session)
    assert e.source == "health_connect" and e.external_id == "hc-night-1"
    assert e.bedtime == dt.datetime.combine(YESTERDAY, dt.time(23, 30))  # local clock time (UTC+3)
    assert e.wake_time == dt.datetime.combine(TODAY, dt.time(7, 15)) and e.date == TODAY
    assert e.duration_minutes == 430  # time asleep: light + deep + REM
    assert (e.light_minutes, e.deep_minutes, e.rem_minutes, e.awake_minutes) == (240, 100, 90, 35)
    assert e.quality is None and e.performance_pct is None and e.recovery_score is None

    listed = client.get("/api/sleep", headers=auth).json()
    assert listed[0]["source"] == "health_connect" and listed[0]["rem_minutes"] == 90


def test_session_without_stage_detail(client, auth, session):
    plain = night("plain", stages=False)
    asleep_only = night("asleep-only", stages=False, start="20:30:00", end="04:15:00")
    asleep_only["start_time"] = at(YESTERDAY - dt.timedelta(days=1), "20:30:00")
    asleep_only["end_time"] = at(YESTERDAY, "04:15:00")
    asleep_only["stages"] = [
        {"start_time": at(YESTERDAY - dt.timedelta(days=1), "20:30:00"), "end_time": at(YESTERDAY, "04:00:00"), "stage": 2},
        {"start_time": at(YESTERDAY, "04:00:00"), "end_time": at(YESTERDAY, "04:15:00"), "stage": 1},
    ]
    assert send(client, auth, plain, asleep_only)["imported"] == 2
    first, second = entries(session)
    assert first.duration_minutes == 450 and first.awake_minutes is None  # "sleeping" only: asleep time, no stages
    assert second.duration_minutes == 465 and second.light_minutes is None  # no stages: bedtime to wake-up


def test_resend_updates_without_duplicates_and_keeps_notes(client, auth, session):
    send(client, auth, night())
    e = entries(session)[0]
    assert client.patch(f"/api/sleep/{e.id}", json={"quality": 4, "notes": "late dinner"}, headers=auth).status_code == 200
    changed = night()
    changed["end_time"] = at(TODAY, "04:45:00")
    assert send(client, auth, changed)["updated"] == 1
    (e,) = entries(session)
    assert e.wake_time.time() == dt.time(7, 45) and e.quality == 4 and e.notes == "late dinner"


def test_replaces_overlapping_manual_sleep(client, auth, session):
    manual = {"bedtime": f"{YESTERDAY}T23:00:00", "wake_time": f"{TODAY}T07:00:00", "quality": 2}
    other_night = {"bedtime": f"{YESTERDAY - dt.timedelta(days=1)}T23:00:00", "wake_time": f"{YESTERDAY}T07:00:00"}
    assert client.post("/api/sleep", json=manual, headers=auth).status_code == 201
    assert client.post("/api/sleep", json=other_night, headers=auth).status_code == 201
    assert send(client, auth, night())["replaced_manual"] == 1
    assert [(e.source, e.date) for e in entries(session)] == [("manual", YESTERDAY), ("health_connect", TODAY)]
    # typing in a night Health Connect already has is refused
    assert client.post("/api/sleep", json=manual, headers=auth).status_code == 409


def test_two_apps_writing_the_same_night_count_once(client, auth, session):
    phone = night("from-phone", stages=False, app="com.google.android.apps.wellbeing")
    watch = night("from-watch")
    assert send(client, auth, phone, watch) == {"imported": 1, "updated": 0, "replaced_manual": 0, "skipped": 1}
    (e,) = entries(session)
    assert e.external_id == "from-watch"  # the one with stages is kept
    assert send(client, auth, phone, watch)["skipped"] == 1 and len(entries(session)) == 1


def test_unusable_sessions_are_skipped(client, auth, session):
    backwards = night("backwards", stages=False)
    backwards["end_time"] = backwards["start_time"]
    too_long = night("too-long", stages=False)
    too_long["start_time"] = at(YESTERDAY - dt.timedelta(days=2), "20:00:00")
    assert send(client, auth, backwards, too_long)["skipped"] == 2 and entries(session) == []
    r = client.post("/api/sleep/health-connect", json={"sessions": [{"id": "x", "start_time": "2026-10-10T23:00:00"}]}, headers=auth)
    assert r.status_code == 422  # times must say their time zone


def test_times_cannot_be_edited(client, auth, session):
    send(client, auth, night())
    e = entries(session)[0]
    r = client.patch(f"/api/sleep/{e.id}", json={"wake_time": f"{TODAY}T09:00:00"}, headers=auth)
    assert r.status_code == 409 and "Health Connect" in r.json()["detail"]


def test_whoop_wins_over_health_connect(client, auth, session, fake_whoop):  # noqa: F811
    send(client, auth, night())
    connect(client, auth)  # WHOOP imports the same night and replaces the Health Connect copy
    assert {e.source for e in entries(session)} == {"whoop"}
    # and Health Connect doesn't add it back
    assert send(client, auth, night())["skipped"] == 1
    assert {e.source for e in entries(session)} == {"whoop"}


def test_needs_login(client):
    assert client.post("/api/sleep/health-connect", json={"sessions": []}).status_code == 401
