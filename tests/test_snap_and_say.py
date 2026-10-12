"""Snap and say with a fake vision model: screenshot to routine, snap the weight, menu scanner; and insights."""

import datetime as dt

import httpx
import pytest
from sqlmodel import select

from app.main import app
from app.models.exercise import Exercise
from app.models.food import Food
from app.models.user import User
from app.routers.exercises import get_recognizer
from app.services.recognition import Recognizer
from app.services.snap import clean_reps, rank_dishes
from tests.conftest import add_sleep, add_workout, signup_and_login
from tests.test_recognition import JPEG, FakeVision


@pytest.fixture
def vision(client):
    fake = FakeVision()
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_recognizer] = lambda: Recognizer(http, "http://localhost:11434", "qwen3-vl:8b")
    return fake


def ex_id(session, name: str) -> int:
    return session.exec(select(Exercise).where(Exercise.name == name)).one().id


def upload(client, auth, path: str, **params):
    return client.post(path, files={"image": ("p.jpg", JPEG, "image/jpeg")}, params=params, headers=auth)


# ---------- screenshot to routine ----------

def test_clean_reps():
    assert clean_reps("8–12 reps", "10-15") == "8-12"
    assert clean_reps(" 10 ", "10-15") == "10"
    assert clean_reps("45 sec", "10-15") == "45 s"
    assert clean_reps("to failure", "10-15") == "10-15"
    assert clean_reps(None, "8-12") == "8-12"


def test_screenshot_to_routine_and_save_as_plan_day(client, auth, session, vision):
    leg_press, plank = ex_id(session, "Leg Press"), ex_id(session, "Plank")
    vision.answer = {"title": "Leg day burner", "exercises": [
        {"text": "Leg press 4x10", "exercise_id": leg_press, "sets": 4, "reps": "10", "confidence": 0.9},
        {"text": "Bulgarian split squat 3x8-12", "exercise_id": None, "sets": 3, "reps": "8–12 reps", "confidence": 0.3},
        {"text": "Plank 3 x 45 sec", "exercise_id": plank, "sets": 3, "reps": "45 sec", "confidence": 0.8},
        {"text": "Mystery move", "exercise_id": 99999, "sets": 99, "reps": "lots", "confidence": 2},
    ]}
    r = upload(client, auth, "/api/snap/workout-screenshot")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["title"] == "Leg day burner"
    got = [(i["text"], i["exercise"] and i["exercise"]["id"], i["sets"], i["reps"]) for i in body["items"]]
    assert got[0] == ("Leg press 4x10", leg_press, 4, "10")
    assert got[1] == ("Bulgarian split squat 3x8-12", None, 3, "8-12")  # left for the user to pick
    assert got[2] == ("Plank 3 x 45 sec", plank, 3, "45 s")
    assert got[3][1] is None and got[3][2] == 10  # unknown id dropped, sets capped
    assert body["items"][3]["reps"] == client.get("/api/me/routine", headers=auth).json()["reps"]
    assert "Leg Press" in vision.requests[-1]["messages"][0]["content"]

    # save it as a training day (the user picked a squat for the unmatched one)
    routine = client.get("/api/me/routine", headers=auth).json()
    day = routine["days"][0]["weekday_index"]
    squat = ex_id(session, "Goblet Squat")
    body = {"title": "Leg day burner", "exercises": [
        {"exercise_id": leg_press, "sets": 4, "reps": "10"}, {"exercise_id": squat, "sets": 3, "reps": "8-12"},
        {"exercise_id": plank, "sets": 3, "reps": "45 s"}]}
    saved = client.put(f"/api/me/schedule/days/{day}", json=body, headers=auth)
    assert saved.status_code == 200, saved.text
    d = next(x for x in saved.json()["days"] if x["weekday_index"] == day)
    assert d["title"] == "Leg day burner" and d["custom_exercises"] is True
    assert [(x["exercise_id"], x["sets"], x["reps"]) for x in d["exercises"]] == [(leg_press, 4, "10"), (squat, 3, "8-12"), (plank, 3, "45 s")]
    # other days keep their generated exercises; the routine endpoint shows the same
    again = client.get("/api/me/routine", headers=auth).json()
    assert next(x for x in again["days"] if x["weekday_index"] == day)["custom_exercises"] is True
    assert all(not x["custom_exercises"] for x in again["days"] if x["weekday_index"] != day)

    rest_day = next(w for w in range(7) if w not in routine["training_days"])
    assert client.put(f"/api/me/schedule/days/{rest_day}", json=body, headers=auth).status_code == 422
    bad = {**body, "exercises": [{"exercise_id": 99999}]}
    assert client.put(f"/api/me/schedule/days/{day}", json=bad, headers=auth).status_code == 422

    back = client.delete(f"/api/me/schedule/days/{day}", headers=auth).json()
    assert next(x for x in back["days"] if x["weekday_index"] == day)["custom_exercises"] is False


# ---------- snap the weight ----------

def test_snap_the_weight(client, auth, vision):
    vision.answer = {"kind": "pin_stack", "weight": 45, "unit": "lbs", "details": "pin in the plate marked 45", "confidence": 0.8}
    r = upload(client, auth, "/api/snap/weight").json()
    assert (r["kind"], r["weight"], r["unit"], r["confidence"]) == ("pin_stack", 45, "lb", 0.8)
    vision.answer = {"kind": "barbell", "weight": 5000, "unit": "kg", "details": "?", "confidence": 0.9}
    r = upload(client, auth, "/api/snap/weight").json()
    assert r["weight"] is None and r["confidence"] == 0  # not a weight anyone lifts
    vision.answer = {"kind": "teapot", "weight": None, "unit": None, "details": "can't see a weight", "confidence": 0.1}
    r = upload(client, auth, "/api/snap/weight").json()
    assert (r["kind"], r["weight"]) == ("other", None)


# ---------- menu scanner ----------

def test_rank_dishes():
    dishes = [
        {"name": "Burger", "calories": 1100, "protein_g": 45, "carbs_g": 80, "fat_g": 60},
        {"name": "Chicken salad", "calories": 520, "protein_g": 42, "carbs_g": 20, "fat_g": 25},
        {"name": "Soup", "calories": 250, "protein_g": 8, "carbs_g": 30, "fat_g": 9},
    ]
    ranked = rank_dishes(dishes, remaining_kcal=800, remaining_protein=90, daily_target=2400)
    assert [d["name"] for d in ranked] == ["Chicken salad", "Soup", "Burger"]
    assert "more than the 800 left" in ranked[-1]["verdict"]
    assert all(0 <= d["fit"] <= 1 for d in ranked)
    # nothing left today: the lightest fits best
    done = rank_dishes(dishes, remaining_kcal=-100, remaining_protein=0, daily_target=2400)
    assert done[0]["name"] == "Soup" and "at today's target" in done[0]["verdict"]


def test_menu_scanner_ranks_and_logs_a_dish(client, auth, session, vision):
    vision.answer = {"seen": "an Italian menu", "dishes": [
        {"name": "Lasagne", "description": "beef ragu", "calories": 950, "protein_g": 40, "carbs_g": 80, "fat_g": 45},
        {"name": "Grilled chicken salad", "description": "", "calories": 480, "protein_g": 40, "carbs_g": 15, "fat_g": 22},
        {"name": "Mystery", "description": "", "calories": "lots", "protein_g": 1, "carbs_g": 1, "fat_g": 1},
    ]}
    r = upload(client, auth, "/api/snap/menu")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [d["name"] for d in body["dishes"]] == ["Grilled chicken salad", "Lasagne"]  # no calories: left out
    target = client.get("/api/me/plan", headers=auth).json()["target_calories"]
    assert body["remaining_calories"] == round(target)
    assert "estimates" in body["note"]

    entry = client.post("/api/snap/menu/log", json={"name": "Grilled chicken salad", "calories": 480, "protein_g": 40,
                                                    "carbs_g": 15, "fat_g": 22, "meal": "dinner"}, headers=auth)
    assert entry.status_code == 201, entry.text
    e = entry.json()
    assert (e["food_name"], e["meal"], e["quantity"], e["unit"], round(e["calories"]), round(e["protein_g"])) == (
        "Grilled chicken salad", "dinner", 1, "serving", 480, 40)
    food = session.get(Food, e["food_id"])
    assert food.brand == "Menu estimate" and food.owner_id is not None
    # what's left today goes down
    assert upload(client, auth, "/api/snap/menu").json()["remaining_calories"] == round(target - 480)


def test_snap_without_ollama(client, auth, vision):
    vision.down = True
    for path in ("/api/snap/workout-screenshot", "/api/snap/weight", "/api/snap/menu"):
        r = upload(client, auth, path)
        assert r.status_code == 503 and "Ollama" in r.json()["detail"], path
    assert client.post("/api/snap/weight", files={"image": ("x.txt", b"hello", "text/plain")}, headers=auth).status_code == 415


# ---------- personal insights ----------

def test_insights_need_enough_data(client, auth):
    r = client.get("/api/analytics/insights", headers=auth).json()
    assert r["insights"] == []
    assert any(t.startswith("Sleep and strength") for t in r["not_enough"])
    assert "doesn't show that one causes the other" in r["note"]


def test_insights_from_sleep_and_training(client, auth, session):
    user = session.exec(select(User).where(User.email == "sara@example.com")).one()
    user.created_at = dt.datetime.now(dt.UTC) - dt.timedelta(days=70)
    session.add(user)
    session.commit()
    leg_press = ex_id(session, "Leg Press")
    today = dt.date.today()
    # 20 workouts: after 8 h nights the top set is heavier than after 6 h nights
    for k in range(20):
        day = today - dt.timedelta(days=2 + 3 * k)
        rested = k % 2 == 0
        add_sleep(session, user, day, 8 * 60 if rested else 6 * 60)
        add_workout(session, user, day, [(leg_press, 10, (110 if rested else 100) + (k % 3))])
    # nights after training days are longer than after rest days
    for k in range(20):
        add_sleep(session, user, today - dt.timedelta(days=1 + 3 * k), 8 * 60 + 30)  # night after a workout day
        add_sleep(session, user, today - dt.timedelta(days=3 * k + 3) + dt.timedelta(days=0), 7 * 60)

    r = client.get("/api/analytics/insights", headers=auth).json()
    by_id = {i["id"]: i for i in r["insights"]}
    s = by_id["sleep_strength"]
    assert "heavier after nights of" in s["text"] and "(10 vs 10 sessions)" in s["text"]
    assert s["strength"] == "clear"
    assert [g["n"] for g in s["groups"]] == [10, 10]
    assert "longer after training days" in by_id["sleep_after_training"]["text"]
    assert all("causes" in i["caution"] or i["strength"] == "count" for i in r["insights"])

    other = signup_and_login(client, email="other@example.com")
    client.put("/api/me/profile", json={"birth_date": "1990-01-01", "sex": "female", "height": 165, "weight": 60}, headers=other)
    assert client.get("/api/analytics/insights", headers=other).json()["insights"] == []  # only your own data
