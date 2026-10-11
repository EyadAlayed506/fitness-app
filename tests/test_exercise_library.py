"""Curated exercise library: instructions, rest times, alternatives and the user's rest preference."""

import json

from sqlmodel import select

from app.models.exercise import Exercise
from app.seed import SEED_DIR, seed_catalogue
from tests.conftest import PROFILE


def by_code(client, auth, code):
    return client.get(f"/api/exercises/qr/{code}", headers=auth).json()


def test_every_exercise_has_curated_details():
    rows = json.loads((SEED_DIR / "exercises.json").read_text())
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
