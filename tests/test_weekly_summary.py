import datetime as dt

from sqlmodel import select

from app.models.exercise import Exercise
from app.models.user import User
from app.services.activity import week_start
from tests.conftest import PROFILE, add_sleep, add_workout

TODAY = dt.date.today()
LAST_WEEK = week_start(TODAY) - dt.timedelta(days=7)  # a Monday, fully in the past
WEEK_BEFORE = LAST_WEEK - dt.timedelta(days=7)


def summary(client, auth, week: dt.date | None = None):
    r = client.get("/api/analytics/weekly-summary" + (f"?week={week}" if week else ""), headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def setup_user(client, auth, session) -> User:
    assert client.put("/api/me/profile", json={**PROFILE, "training_days": [0, 3]}, headers=auth).status_code == 200
    user = session.exec(select(User)).one()
    user.created_at = dt.datetime.now(dt.UTC) - dt.timedelta(days=60)
    session.add(user)
    session.commit()
    return user


def test_week_compared_with_the_week_before(client, auth, session):
    user = setup_user(client, auth, session)
    bench = session.exec(select(Exercise).where(Exercise.name == "Barbell Bench Press")).one().id
    add_workout(session, user, WEEK_BEFORE, [(bench, 10, 60)] * 3)
    add_workout(session, user, LAST_WEEK, [(bench, 8, 65)] * 3)  # Monday, planned
    add_workout(session, user, LAST_WEEK + dt.timedelta(days=2), [(bench, 5, 50)])  # Wednesday, not planned
    add_sleep(session, user, LAST_WEEK + dt.timedelta(days=1), 7 * 60, source="whoop")
    add_sleep(session, user, LAST_WEEK + dt.timedelta(days=2), 6 * 60)
    client.post("/api/me/weight", json={"weight": 94, "date": str(LAST_WEEK + dt.timedelta(days=3))}, headers=auth)

    s = summary(client, auth, LAST_WEEK + dt.timedelta(days=4))  # any day in the week
    assert s["week_start"] == str(LAST_WEEK) and not s["current_week"]
    assert (s["planned"], s["completed"], s["completed_on_plan"], s["workouts"]) == (2, 2, 1, 2)
    assert s["previous_completed"] == 1
    assert [(d["planned"], d["trained"]) for d in s["days"][:4]] == [(True, True), (False, False), (False, True), (True, False)]
    assert s["sets"] == 4 and s["volume_kg"] == 3 * 8 * 65 + 5 * 50 and s["previous_volume_kg"] == 1800

    ex = s["exercises"][0]
    assert ex["name"] == "Barbell Bench Press"
    assert (ex["top_set"]["weight_kg"], ex["top_set"]["reps"]) == (65, 8)
    assert (ex["previous_top_set"]["weight_kg"], ex["previous_top_set"]["reps"]) == (60, 10)
    assert ex["best_e1rm_kg"] == 82.3 and ex["previous_e1rm_kg"] == 80.0
    assert s["records"] == ["Barbell Bench Press"] and ex["record"] == "Best estimated 1RM yet"

    sleep = s["sleep"]
    assert sleep["nights_logged"] == 2 and sleep["average_minutes"] == 390
    assert (sleep["from_whoop"], sleep["logged_by_hand"]) == (1, 1)
    assert sleep["previous_average_minutes"] is None  # no nights the week before: no comparison
    assert s["weight"]["latest_kg"] == 94 and s["weight"]["change_kg"] is None
    assert len(s["history"]) == 8 and s["history"][-1] == {"week_start": str(LAST_WEEK), "planned": 2, "completed": 2}
    assert "doesn't say that one caused" in s["notes"][0]


def test_first_time_exercise_is_not_a_record(client, auth, session):
    user = setup_user(client, auth, session)
    add_workout(session, user, LAST_WEEK, [(1, 10, 100)])
    s = summary(client, auth, LAST_WEEK)
    assert s["records"] == [] and s["exercises"][0]["previous_top_set"] is None


def test_empty_week_has_no_made_up_numbers(client, auth, session):
    setup_user(client, auth, session)
    s = summary(client, auth, LAST_WEEK)
    assert s["completed"] == 0 and s["workouts"] == 0 and s["exercises"] == []
    assert s["previous_completed"] is None and s["previous_volume_kg"] is None
    assert s["sleep"] is None and s["weight"] is None


def test_future_week_is_refused(client, auth, session):
    setup_user(client, auth, session)
    r = client.get(f"/api/analytics/weekly-summary?week={TODAY + dt.timedelta(days=8)}", headers=auth)
    assert r.status_code == 422


def test_days_before_sign_up_are_not_planned(client, auth, session):
    assert client.put("/api/me/profile", json={**PROFILE, "training_days": [0, 3]}, headers=auth).status_code == 200
    user = session.exec(select(User)).one()
    user.created_at = dt.datetime.combine(LAST_WEEK + dt.timedelta(days=2), dt.time(12), dt.UTC)  # signed up Wednesday
    session.add(user)
    session.commit()
    s = summary(client, auth, LAST_WEEK)
    assert s["planned"] == 1  # Thursday only; Monday was before sign-up
    assert [d["planned"] for d in s["days"]][:4] == [False, False, False, True]
    assert s["history"][0]["planned"] == 0
