"""Curated exercise library: instructions, rest times, alternatives and the user's rest preference."""

import json

from sqlmodel import select

from app.models.exercise import Exercise
from app.seed import SEED_DIR, seed_catalogue
from tests.conftest import PROFILE


def by_code(client, auth, code):
    return client.get(f"/api/exercises/qr/{code}", headers=auth).json()


def test_every_exercise_has_curated_details():
    rows = json.loads((SEED_DIR / "exercises.json").read_text(encoding="utf-8"))
    for row in rows:
        assert row["pattern"], row["name"]
        assert 2 <= len(row["instructions"]) <= 6, row["name"]
        assert 30 <= row["default_rest_seconds"] <= 180, row["name"]


def test_exercise_shows_instructions_and_rest(client, auth):
    ex = by_code(client, auth, "leg-press")
    assert ex["pattern"] == "squat" and ex["default_rest_seconds"] == 120
    assert any("safety" in step for step in ex["instructions"])


def test_leg_press_alternatives_in_a_gym(client, auth):
    leg_press = by_code(client, auth, "leg-press")
    data = client.get(f"/api/exercises/{leg_press['id']}/alternatives", headers=auth).json()
    alts = data["alternatives"]
    names = [a["exercise"]["name"] for a in alts]
    assert "Leg Press" not in names
    similar = [a for a in alts if a["match"] == "similar"]
    different = [a for a in alts if a["match"] == "different"]
    assert similar and all(a["exercise"]["pattern"] == "squat" for a in similar)
    assert all(a["exercise"]["pattern"] != "squat" for a in different)
    assert all(a["exercise"]["muscle_group"] == "quads" for a in different)
    # a different movement is never presented as a like-for-like swap
    assert all(any("not a like-for-like swap" in d for d in a["differences"]) for a in different)
    # equipment changes are explained (e.g. free weight vs machine)
    barbell = next(a for a in alts if a["exercise"]["name"] in ("Barbell Back Squat", "Goblet Squat"))
    assert any("balance" in d for d in barbell["differences"])


def test_alternatives_follow_the_users_equipment(client, auth):
    client.put("/api/me/profile", json={**PROFILE, "equipment": "bodyweight"}, headers=auth)
    leg_press = by_code(client, auth, "leg-press")
    data = client.get(f"/api/exercises/{leg_press['id']}/alternatives", headers=auth).json()
    assert data["filtered_by_equipment"] and data["equipment"] == "bodyweight"
    assert {a["exercise"]["equipment"] for a in data["alternatives"]} == {"bodyweight"}
    assert data["alternatives"][0]["exercise"]["name"] == "Bodyweight Squat"
    assert any("Body weight only" in d for d in data["alternatives"][0]["differences"])
    everything = client.get(f"/api/exercises/{leg_press['id']}/alternatives?all_equipment=true", headers=auth).json()
    assert len({a["exercise"]["equipment"] for a in everything["alternatives"]}) > 1


def test_only_catalogue_exercises_are_suggested(client, auth, session):
    catalogue_ids = {e.id for e in session.exec(select(Exercise)).all()}
    for code in ("lat-pulldown", "pec-deck", "triceps-pushdown", "plank"):
        ex = by_code(client, auth, code)
        alts = client.get(f"/api/exercises/{ex['id']}/alternatives", headers=auth).json()["alternatives"]
        assert alts, code
        assert {a["exercise"]["id"] for a in alts} <= catalogue_ids


def test_rest_preference(client, auth):
    lat = by_code(client, auth, "lat-pulldown")
    r = client.get(f"/api/exercises/{lat['id']}/rest", headers=auth).json()
    assert r == {"exercise_id": lat["id"], "default_seconds": 120, "preferred_seconds": None, "seconds": 120}
    r = client.put(f"/api/exercises/{lat['id']}/rest", json={"seconds": 75}, headers=auth).json()
    assert r["seconds"] == 75 and r["preferred_seconds"] == 75
    assert client.get(f"/api/exercises/{lat['id']}/rest", headers=auth).json()["seconds"] == 75
    assert client.put(f"/api/exercises/{lat['id']}/rest", json={"seconds": 5}, headers=auth).status_code == 422
    assert client.put(f"/api/exercises/{lat['id']}/rest", json={"seconds": None}, headers=auth).json()["seconds"] == 120


def test_rest_time_for_all_exercises(client, auth):
    lat = by_code(client, auth, "lat-pulldown")
    leg = by_code(client, auth, "leg-press")
    profile = client.get("/api/me/profile", headers=auth).json()
    body = {
        "birth_date": profile["birth_date"], "sex": profile["sex"], "height": profile["height_cm"],
        "weight": profile["weight_kg"], "training_days": profile["training_days"], "rest_seconds": 75,
    }
    r = client.put("/api/me/profile", json=body, headers=auth)
    assert r.status_code == 200 and r.json()["rest_seconds"] == 75
    rest = lambda ex: client.get(f"/api/exercises/{ex['id']}/rest", headers=auth).json()  # noqa: E731
    assert rest(lat)["seconds"] == 75 and rest(leg)["seconds"] == 75
    # a time set for one exercise in the rest timer still wins
    client.put(f"/api/exercises/{lat['id']}/rest", json={"seconds": 150}, headers=auth)
    assert rest(lat)["seconds"] == 150 and rest(leg)["seconds"] == 75
    assert client.put("/api/me/profile", json={**body, "rest_seconds": 5}, headers=auth).status_code == 422
    # back to each exercise's suggested time
    client.put("/api/me/profile", json={**body, "rest_seconds": None}, headers=auth)
    assert rest(leg)["seconds"] == leg["default_rest_seconds"]


def test_routine_uses_exercise_rest_times(client, auth):
    routine = client.get("/api/me/routine", headers=auth).json()
    for day in routine["days"]:
        for x in day["exercises"]:
            ex = client.get(f"/api/exercises/{x['exercise_id']}", headers=auth).json()
            assert x["rest_seconds"] == ex["default_rest_seconds"]


def test_seed_updates_existing_exercises_without_new_ids(session):
    """An older database (no instructions yet) gets them; ids and history stay the same."""
    ex = session.exec(select(Exercise).where(Exercise.qr_code == "leg-press")).one()
    old_id = ex.id
    ex.instructions, ex.pattern, ex.default_rest_seconds = None, None, None
    session.add(ex)
    session.commit()
    seed_catalogue(session)
    ex = session.exec(select(Exercise).where(Exercise.qr_code == "leg-press")).one()
    assert ex.id == old_id and ex.pattern == "squat" and ex.instructions
    assert len(session.exec(select(Exercise)).all()) == 48


def test_every_exercise_has_arabic_text():
    rows = json.loads((SEED_DIR / "exercises.json").read_text(encoding="utf-8"))
    for row in rows:
        assert row["name_ar"] and row["primary_muscles_ar"] and row["aliases_ar"], row["name"]
        assert len(row["instructions_ar"]) == len(row["instructions"]), row["name"]
    assert len({r["name_ar"] for r in rows}) == len(rows), "Arabic names are unique"


def test_exercises_in_the_request_language(client, auth):
    english = by_code(client, auth, "leg-press")
    arabic = client.get("/api/exercises/qr/leg-press", headers={**auth, "Accept-Language": "ar"}).json()
    assert english["name"] == "Leg Press" and arabic["name"] == "جهاز ضغط الأرجل"
    assert arabic["id"] == english["id"] and arabic["qr_code"] == "leg-press", "identity is unchanged"
    assert arabic["instructions"][0].startswith("اجلس") and arabic["primary_muscles"].startswith("الفخذ")
    assert "safety" in " ".join(english["instructions"]), "English is unchanged"


def test_search_finds_exercises_by_their_arabic_names(client, auth):
    found = client.get("/api/exercises?search=بنش", headers=auth).json()
    assert found and found[0]["name"] == "Barbell Bench Press"
    # spelling variants (alef forms) and colloquial aliases also match
    assert client.get("/api/exercises?search=السكوات بالبار", headers=auth).json()[0]["qr_code"] == "barbell-back-squat"
    assert client.get("/api/exercises?search=بنش برس بالبار", headers=auth).json()[0]["qr_code"] == "barbell-bench-press"
    lat = client.get("/api/exercises?search=سحب امامي", headers={**auth, "Accept-Language": "ar"}).json()
    assert lat[0]["name"] == "سحب أمامي (لات بول داون)"


def test_logged_sets_show_the_arabic_name_but_store_the_exercise_id(client, auth):
    leg_press = by_code(client, auth, "leg-press")
    workout = client.post("/api/workouts", json={}, headers=auth).json()
    body = {"exercise_id": leg_press["id"], "reps": 10, "weight": 100, "unit": "kg"}
    added = client.post(f"/api/workouts/{workout['id']}/sets", json=body, headers={**auth, "Accept-Language": "ar"}).json()
    assert added["exercise_name"] == "جهاز ضغط الأرجل"
    english = client.get(f"/api/workouts/{workout['id']}", headers=auth).json()
    assert english["sets"][0]["exercise_name"] == "Leg Press"
