from datetime import date, datetime, time, timedelta

from sqlmodel import select

from app.models.user import User
from tests.conftest import PROFILE, add_sleep, signup_and_login


def night(days_ago: int, bed: str = "23:30", wake: str = "07:00") -> tuple[str, str]:
    """Local times for a night that ended `days_ago` days before today."""
    wake_day = date.today() - timedelta(days=days_ago)
    bed_time, wake_time = time.fromisoformat(bed), time.fromisoformat(wake)
    bed_day = wake_day - timedelta(days=1) if bed_time > wake_time else wake_day
    return datetime.combine(bed_day, bed_time).isoformat(), datetime.combine(wake_day, wake_time).isoformat()


def test_log_list_update_delete(client, auth):
    bed, wake = night(0)
    r = client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake, "quality": 4, "notes": "woke once"}, headers=auth)
    assert r.status_code == 201, r.text
    entry = r.json()
    assert entry["duration_minutes"] == 450  # 23:30 -> 07:00
    assert entry["date"] == date.today().isoformat()
    assert entry["source"] == "manual"

    # after midnight bedtime: same calendar day
    bed2, wake2 = night(1, "00:45", "06:15")
    second = client.post("/api/sleep", json={"bedtime": bed2, "wake_time": wake2}, headers=auth).json()
    assert second["duration_minutes"] == 330 and second["quality"] is None

    listed = client.get("/api/sleep", headers=auth).json()
    assert [e["id"] for e in listed] == [entry["id"], second["id"]]  # newest first

    new_wake = datetime.fromisoformat(wake).replace(hour=7, minute=30).isoformat()
    updated = client.patch(f"/api/sleep/{entry['id']}", json={"wake_time": new_wake, "quality": 5}, headers=auth).json()
    assert updated["duration_minutes"] == 480 and updated["quality"] == 5

    # null leaves times as they are, and clears the quality
    cleared = client.patch(f"/api/sleep/{entry['id']}", json={"bedtime": None, "quality": None}, headers=auth).json()
    assert cleared["duration_minutes"] == 480 and cleared["quality"] is None

    assert client.delete(f"/api/sleep/{entry['id']}", headers=auth).status_code == 204
    assert len(client.get("/api/sleep", headers=auth).json()) == 1


def test_timezone_is_ignored(client, auth):
    r = client.post("/api/sleep", json={"bedtime": "2026-10-01T23:00:00+03:00", "wake_time": "2026-10-02T07:00:00Z"}, headers=auth)
    assert r.status_code == 201
    assert r.json()["bedtime"].startswith("2026-10-01T23:00") and r.json()["duration_minutes"] == 480


def test_invalid_times(client, auth):
    bed, wake = night(0)
    assert client.post("/api/sleep", json={"bedtime": wake, "wake_time": bed}, headers=auth).status_code == 422
    too_long = (datetime.fromisoformat(bed) - timedelta(hours=14)).isoformat()
    assert client.post("/api/sleep", json={"bedtime": too_long, "wake_time": wake}, headers=auth).status_code == 422
    assert client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake, "quality": 6}, headers=auth).status_code == 422
    entry = client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake}, headers=auth).json()
    r = client.patch(f"/api/sleep/{entry['id']}", json={"bedtime": wake}, headers=auth)
    assert r.status_code == 422 and "after bedtime" in r.json()["detail"]


def test_overlapping_sleep_is_refused(client, auth):
    bed, wake = night(0, "23:00", "07:00")
    first = client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake}, headers=auth).json()
    # the same night again, or one that overlaps it, is refused
    assert client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake}, headers=auth).status_code == 409
    b2, w2 = night(0, "06:00", "09:00")
    r = client.post("/api/sleep", json={"bedtime": b2, "wake_time": w2}, headers=auth)
    assert r.status_code == 409 and "Edit that one" in r.json()["detail"]
    # touching but not overlapping is fine (a nap right after waking would start at 07:00)
    b3, w3 = night(0, "07:00", "07:30")
    assert client.post("/api/sleep", json={"bedtime": b3, "wake_time": w3}, headers=auth).status_code == 201
    # editing an entry doesn't clash with itself, but can't be moved onto another one
    later_wake = datetime.fromisoformat(wake).replace(hour=6, minute=45).isoformat()
    assert client.patch(f"/api/sleep/{first['id']}", json={"wake_time": later_wake}, headers=auth).status_code == 200
    assert client.patch(f"/api/sleep/{first['id']}", json={"wake_time": w3}, headers=auth).status_code == 409


def test_entries_are_private(client, auth):
    bed, wake = night(0)
    entry = client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake}, headers=auth).json()
    other = signup_and_login(client, email="other@example.com")
    assert client.get("/api/sleep", headers=other).json() == []
    assert client.patch(f"/api/sleep/{entry['id']}", json={"quality": 1}, headers=other).status_code == 404
    assert client.delete(f"/api/sleep/{entry['id']}", headers=other).status_code == 404


def test_sleep_analytics(client, auth):
    for days_ago, bed, wake, quality in [(0, "23:00", "07:00", 4), (1, "00:30", "06:00", 2), (9, "22:30", "06:30", 5)]:
        b, w = night(days_ago, bed, wake)
        client.post("/api/sleep", json={"bedtime": b, "wake_time": w, "quality": quality}, headers=auth)
    # an afternoon nap today adds to today's total
    today = date.today()
    nap = {"bedtime": f"{today}T14:00:00", "wake_time": f"{today}T14:30:00"}
    client.post("/api/sleep", json=nap, headers=auth)

    data = client.get("/api/analytics/sleep", headers=auth).json()
    hours = data["series"][0]["data"]
    assert len(data["labels"]) == 14 and data["labels"][-1] == today.isoformat()
    assert hours[-1] == 8.5 and hours[-2] == 5.5 and hours[-10] == 8.0
    assert hours[-3] is None
    assert data["quality"][-1] == 4.0
    assert data["nights_logged_7d"] == 2
    assert data["average_hours_7d"] == 7.0  # (8.5 + 5.5) / 2
    assert data["average_quality_7d"] == 3.0
    assert data["recommended_hours"] == [7, 9]  # the test profile is an adult


def test_recommended_hours_by_age():
    from app.services.calculations import recommended_sleep_hours

    assert recommended_sleep_hours(15) == (8, 10)
    assert recommended_sleep_hours(30) == (7, 9)
    assert recommended_sleep_hours(70) == (7, 8)


def test_delete_account_removes_sleep(client, auth, session):
    from sqlmodel import select

    from app.models.sleep import SleepEntry

    bed, wake = night(0)
    client.post("/api/sleep", json={"bedtime": bed, "wake_time": wake}, headers=auth)
    assert client.delete("/api/me", headers=auth).status_code == 204
    assert session.exec(select(SleepEntry)).all() == []


def test_sleep_goal(client, auth):
    r = client.put("/api/me/sleep-goal", json={"minutes": 480}, headers=auth)
    assert r.json() == {"goal_minutes": 480, "goal_custom": True, "recommended_hours": [7, 9]}
    assert client.get("/api/me/profile", headers=auth).json()["sleep_goal_minutes"] == 480
    # saving the profile keeps the goal
    client.put("/api/me/profile", json=PROFILE, headers=auth)
    assert client.get("/api/analytics/sleep", headers=auth).json()["goal_minutes"] == 480
    assert client.put("/api/me/sleep-goal", json={"minutes": 100}, headers=auth).status_code == 422
    back = client.put("/api/me/sleep-goal", json={"minutes": None}, headers=auth).json()
    assert back == {"goal_minutes": 420, "goal_custom": False, "recommended_hours": [7, 9]}


def test_sleep_dashboard_details(client, auth, session):
    user = session.exec(select(User)).one()
    today = date.today()
    for k in range(1, 4):  # three nights the week before: 6 h
        add_sleep(session, user, today - timedelta(days=7 + k), 6 * 60)
    for k in range(3):  # three nights this week: 8 h, one from WHOOP with stages
        e = add_sleep(session, user, today - timedelta(days=k), 8 * 60, source="whoop" if k == 0 else "manual")
        if k == 0:
            e.light_minutes, e.deep_minutes, e.rem_minutes, e.awake_minutes = 250, 90, 110, 30
            session.add(e)
            session.commit()

    data = client.get("/api/analytics/sleep?days=7", headers=auth).json()
    nights = data["nights"]
    assert len(nights) == 7
    assert nights[-1]["source"] == "whoop" and nights[-1]["stages"] == {"light": 250, "deep": 90, "rem": 110, "awake": 30}
    assert nights[-2]["source"] == "manual" and nights[-2]["stages"] is None  # never invented for manual logs
    assert nights[0] is None  # a night without data is "not logged", not zero
    assert data["average_hours_7d"] == 8.0 and data["average_hours_prev_7d"] == 6.0
    assert data["nights_at_goal_7d"] == 3
    # every night in the helper starts and ends at the same clock time
    assert data["bedtime_spread_minutes"] == 0 and data["wake_spread_minutes"] == 0


def test_comparison_needs_enough_nights(client, auth, session):
    user = session.exec(select(User)).one()
    add_sleep(session, user, date.today(), 8 * 60)
    add_sleep(session, user, date.today() - timedelta(days=8), 6 * 60)
    data = client.get("/api/analytics/sleep", headers=auth).json()
    assert data["average_hours_prev_7d"] is None and data["nights_logged_prev_7d"] == 1
    assert data["bedtime_spread_minutes"] is None  # not enough nights to say
