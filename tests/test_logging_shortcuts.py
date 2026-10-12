"""Endpoints behind the faster logging in the app: last session and best set per exercise, recent and
frequent foods, copying a meal, the plan preview during setup, and the first-week checklist."""

import datetime as dt

from sqlmodel import select

from app.models.user import User, WeightEntry
from app.models.workout import WorkoutSession, WorkoutSet
from tests.conftest import PROFILE, add_workout, signup_and_login


def _user(session, email="sara@example.com") -> User:
    return session.exec(select(User).where(User.email == email)).one()


# ---------- exercise history ----------

def test_exercise_history_last_session_and_best(client, auth, session):
    user = _user(session)
    empty = client.get("/api/exercises/1/history", headers=auth).json()
    assert empty == {"exercise_id": 1, "last": None, "best": None}

    today = dt.date.today()
    add_workout(session, user, today - dt.timedelta(days=7), [(1, 10, 40), (1, 8, 50), (2, 12, 20)])
    newer = add_workout(session, user, today - dt.timedelta(days=3), [(1, 12, 45), (1, 11, 45)])
    # a workout in progress today with a heavy set
    active = WorkoutSession(user_id=user.id, started_at=dt.datetime.now(dt.UTC))
    session.add(active)
    session.commit()
    session.add(WorkoutSet(session_id=active.id, exercise_id=1, set_number=1, reps=5, weight_kg=100))
    session.commit()

    h = client.get("/api/exercises/1/history", params={"exclude_workout_id": active.id}, headers=auth).json()
    assert h["last"]["workout_id"] == newer.id
    assert [(s["reps"], s["weight_kg"]) for s in h["last"]["sets"]] == [(12, 45), (11, 45)]
    # Epley: 40x10 = 53.3, 50x8 = 63.3, 45x12 = 63.0, 45x11 = 61.5 -> 50 kg x 8 is the best
    assert (h["best"]["weight_kg"], h["best"]["reps"], h["best"]["e1rm_kg"]) == (50, 8, 63.33)

    # without leaving out the workout in progress, it is the last session and holds the best set
    h = client.get("/api/exercises/1/history", headers=auth).json()
    assert h["last"]["workout_id"] == active.id
    assert (h["best"]["weight_kg"], h["best"]["reps"]) == (100, 5)

    # other people's workouts never count
    other = signup_and_login(client, email="other@example.com")
    assert client.get("/api/exercises/1/history", headers=other).json()["best"] is None
    assert client.get("/api/exercises/99999/history", headers=auth).status_code == 404


def test_exercise_history_bodyweight_best_is_most_reps(client, auth, session):
    user = _user(session)
    today = dt.date.today()
    add_workout(session, user, today - dt.timedelta(days=5), [(3, 15, 0), (3, 20, 0)])
    add_workout(session, user, today - dt.timedelta(days=2), [(3, 18, 0)])
    h = client.get("/api/exercises/3/history", headers=auth).json()
    assert (h["best"]["reps"], h["best"]["weight_kg"], h["best"]["e1rm_kg"]) == (20, 0, 0)
    assert [s["reps"] for s in h["last"]["sets"]] == [18]


# ---------- recent and frequent foods, copying a meal ----------

def _milk_and_bar(client, auth) -> tuple[dict, dict]:
    milk = client.get("/api/foods/search", params={"q": "whole milk", "online": False}, headers=auth).json()["local"][0]
    bar = client.post("/api/foods", json={
        "name": "Protein bar", "serving_size": 40, "serving_unit": "g",
        "calories": 180, "protein_g": 10, "carbs_g": 20, "fat_g": 7,
    }, headers=auth).json()
    return milk, bar


def test_recent_and_frequent_foods(client, auth):
    assert client.get("/api/food-logs/recent", headers=auth).json() == {"recent": [], "frequent": []}
    milk, bar = _milk_and_bar(client, auth)
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    log = lambda food, qty, unit, meal, day=None: client.post(  # noqa: E731
        "/api/food-logs", json={"food_id": food["id"], "quantity": qty, "unit": unit, "meal": meal, "date": day}, headers=auth
    )
    log(milk, 1, "cup", "breakfast", yesterday)
    log(milk, 250, "ml", "breakfast")
    log(bar, 1, "serving", "snack")

    r = client.get("/api/food-logs/recent", headers=auth).json()
    # newest first: today's entries before yesterday's; the bar was logged after the milk today
    assert [f["food"]["name"] for f in r["recent"]] == ["Protein bar", milk["name"]]
    latest_milk = r["recent"][1]
    assert (latest_milk["quantity"], latest_milk["unit"], latest_milk["meal"], latest_milk["times"]) == (250, "ml", "breakfast", 2)
    # only foods logged at least twice are "frequent"
    assert [f["food"]["name"] for f in r["frequent"]] == [milk["name"]]
    assert len(client.get("/api/food-logs/recent", params={"limit": 1}, headers=auth).json()["recent"]) == 1

    other = signup_and_login(client, email="other@example.com")
    assert client.get("/api/food-logs/recent", headers=other).json() == {"recent": [], "frequent": []}


def test_copy_a_meal_from_another_day(client, auth):
    milk, bar = _milk_and_bar(client, auth)
    today = dt.date.today()
    yesterday = today - dt.timedelta(days=1)
    for food, qty, unit, meal in [(milk, 1, "cup", "breakfast"), (bar, 2, "serving", "breakfast"), (bar, 1, "serving", "snack")]:
        client.post("/api/food-logs", json={"food_id": food["id"], "quantity": qty, "unit": unit, "meal": meal,
                                             "date": yesterday.isoformat()}, headers=auth)

    r = client.post("/api/food-logs/copy", json={"from_date": yesterday.isoformat(), "to_date": today.isoformat(),
                                                 "meal": "breakfast"}, headers=auth)
    assert r.status_code == 201, r.text
    copied = r.json()
    assert [(e["food_name"], e["quantity"], e["unit"], e["meal"], e["date"]) for e in copied] == [
        (milk["name"], 1, "cup", "breakfast", today.isoformat()),
        ("Protein bar", 2, "serving", "breakfast", today.isoformat()),
    ]
    assert copied[1]["calories"] == 360
    day = client.get("/api/food-logs", params={"date": today.isoformat()}, headers=auth).json()
    assert len(day["entries"]) == 2  # the snack stayed behind

    # a whole day, and nothing to copy
    whole = client.post("/api/food-logs/copy", json={"from_date": yesterday.isoformat(),
                                                     "to_date": (today + dt.timedelta(days=1)).isoformat()}, headers=auth)
    assert len(whole.json()) == 3
    nothing = client.post("/api/food-logs/copy", json={"from_date": "2020-01-01", "to_date": today.isoformat()}, headers=auth)
    assert nothing.status_code == 201 and nothing.json() == []
    same = client.post("/api/food-logs/copy", json={"from_date": today.isoformat(), "to_date": today.isoformat()}, headers=auth)
    assert same.status_code == 422
    # only the user's own entries are copied
    other = signup_and_login(client, email="other@example.com")
    r = client.post("/api/food-logs/copy", json={"from_date": yesterday.isoformat(), "to_date": today.isoformat()}, headers=other)
    assert r.json() == []


# ---------- plan preview while setting up ----------

def test_plan_preview_saves_nothing(client):
    headers = signup_and_login(client)
    body = {**PROFILE, "training_days": [1, 3, 5]}
    r = client.post("/api/me/plan/preview", json=body, headers=headers)
    assert r.status_code == 200, r.text
    preview = r.json()
    assert preview["plan"]["target_calories"] > 1200
    assert preview["plan"]["bmi"] == round(95 / 1.8**2, 1)
    assert [d["weekday_index"] for d in preview["routine"]["days"]] == [1, 3, 5]
    # still no profile, and the result matches what saving would give
    assert client.get("/api/me", headers=headers).json()["has_profile"] is False
    assert client.put("/api/me/profile", json=body, headers=headers).status_code == 200
    assert client.get("/api/me/plan", headers=headers).json()["target_calories"] == preview["plan"]["target_calories"]

    # without days chosen yet it still gives the calories
    assert client.post("/api/me/plan/preview", json=PROFILE, headers=headers).status_code == 200
    bad = client.post("/api/me/plan/preview", json={**PROFILE, "height": 40}, headers=headers)
    assert bad.status_code == 422
    assert client.post("/api/me/plan/preview", json=PROFILE).status_code == 401


# ---------- first-week checklist ----------

def test_getting_started(client, auth, session):
    user = _user(session)
    g = client.get("/api/me/getting-started", headers=auth).json()
    assert g["days_since_signup"] == 0
    assert g["first_weigh_in"] == dt.date.today().isoformat()  # from setting up the profile
    assert not any(g[k] for k in ("weighed_in", "logged_food", "finished_workout", "sleep_goal_set"))

    # weighing in again the same day replaces that weigh-in, so it doesn't count yet
    client.post("/api/me/weight", json={"weight": 94.5}, headers=auth)
    assert client.get("/api/me/getting-started", headers=auth).json()["weighed_in"] is False
    session.add(WeightEntry(user_id=user.id, date=dt.date.today() + dt.timedelta(days=1), weight_kg=94))
    session.commit()

    milk = client.get("/api/foods/search", params={"q": "whole milk", "online": False}, headers=auth).json()["local"][0]
    client.post("/api/food-logs", json={"food_id": milk["id"], "quantity": 1, "unit": "cup"}, headers=auth)
    client.put("/api/me/sleep-goal", json={"minutes": 480}, headers=auth)
    # an empty finished workout doesn't count; one with a set does
    empty = client.post("/api/workouts", json={}, headers=auth).json()
    client.patch(f"/api/workouts/{empty['id']}", json={"finish": True}, headers=auth)
    assert client.get("/api/me/getting-started", headers=auth).json()["finished_workout"] is False
    add_workout(session, user, dt.date.today())

    g = client.get("/api/me/getting-started", headers=auth).json()
    assert all(g[k] for k in ("weighed_in", "logged_food", "finished_workout", "sleep_goal_set"))
