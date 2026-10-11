from datetime import date, timedelta

from tests.conftest import PROFILE, signup_and_login

# ---------- auth & profile ----------

def test_signup_login_and_duplicate(client):
    headers = signup_and_login(client, marketing=True)
    me = client.get("/api/me", headers=headers).json()
    assert me["email"] == "sara@example.com" and me["marketing_opt_in"] and not me["has_profile"]
    r = client.post("/api/auth/signup", json={"email": "SARA@example.com", "password": "another123"})
    assert r.status_code == 409


def test_wrong_password_and_no_token(client):
    signup_and_login(client)
    r = client.post("/api/auth/login", data={"username": "sara@example.com", "password": "wrongpass"})
    assert r.status_code == 401
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer junk"}).status_code == 401


def test_profile_imperial_units(client):
    headers = signup_and_login(client)
    assert client.get("/api/me/plan", headers=headers).status_code == 404
    data = {**PROFILE, "height": 70, "height_unit": "in", "weight": 200, "weight_unit": "lb"}
    r = client.put("/api/me/profile", json=data, headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert round(body["height_cm"], 1) == 177.8
    assert round(body["weight_kg"], 1) == 90.7
    # saving the profile records a weigh-in
    assert len(client.get("/api/me/weight", headers=headers).json()) == 1


def test_profile_validation(client):
    headers = signup_and_login(client)
    r = client.put("/api/me/profile", json={**PROFILE, "height": 50}, headers=headers)
    assert r.status_code == 422
    r = client.put("/api/me/profile", json={**PROFILE, "days_per_week": 9}, headers=headers)
    assert r.status_code == 422


def test_plan(client, auth):
    plan = client.get("/api/me/plan", headers=auth).json()
    assert plan["bmi"] == 29.3 and plan["bmi_category"] == "overweight"
    assert plan["direction"] == "lose"
    assert plan["optimal_weight_kg"] == 71.3
    assert plan["weight_change_kg"] == -23.7
    assert plan["change_to_healthy_range_kg"] == -14.3
    assert [o["option"] for o in plan["options"]] == ["light", "normal", "extreme"]
    selected = [o for o in plan["options"] if o["selected"]]
    assert selected[0]["option"] == "normal"
    assert plan["target_calories"] == selected[0]["calories"]
    assert plan["tdee"] - plan["target_calories"] == 500


def test_projection_and_routine(client, auth):
    proj = client.get("/api/me/plan/projection", headers=auth).json()
    assert [s["name"] for s in proj["series"]] == ["light", "normal", "extreme"]
    assert all(s["data"][0] == 95 for s in proj["series"])
    routine = client.get("/api/me/routine", headers=auth).json()
    assert routine["split"] == "Upper / Lower" and len(routine["days"]) == 4


def test_weigh_in_updates_current_weight(client, auth):
    r = client.post("/api/me/weight", json={"weight": 94}, headers=auth)
    assert r.status_code == 201
    assert client.get("/api/me/profile", headers=auth).json()["weight_kg"] == 94
    # an older weigh-in does not replace the current weight
    old = (date.today() - timedelta(days=30)).isoformat()
    client.post("/api/me/weight", json={"weight": 99, "date": old}, headers=auth)
    assert client.get("/api/me/profile", headers=auth).json()["weight_kg"] == 94
    # same day again replaces the first one
    client.post("/api/me/weight", json={"weight": 200, "unit": "lb"}, headers=auth)
    weights = client.get("/api/me/weight", headers=auth).json()
    assert len(weights) == 2 and weights[0]["weight_kg"] == 90.72


# ---------- marketing ----------

def test_marketing_toggle_and_unsubscribe(client, session):
    from sqlmodel import select

    from app.models.user import User

    headers = signup_and_login(client, marketing=True)
    user = session.exec(select(User)).one()
    r = client.get(f"/api/marketing/unsubscribe/{user.unsubscribe_token}")
    assert r.status_code == 200 and "unsubscribed" in r.text
    assert client.get("/api/me", headers=headers).json()["marketing_opt_in"] is False
    assert client.put("/api/me/marketing", json={"opt_in": True}, headers=headers).json()["marketing_opt_in"]
    assert client.get("/api/marketing/unsubscribe/not-a-token").status_code == 404


# ---------- exercises & workouts ----------

def test_exercise_search_fuzzy(client, auth):
    for query in ["lat pulldown", "lat pull down", "latpulldown", "pulldwn"]:
        results = client.get("/api/exercises", params={"search": query}, headers=auth).json()
        assert results and results[0]["name"] == "Lat Pulldown", query
    chest = client.get("/api/exercises", params={"search": "chest press"}, headers=auth).json()
    assert chest[0]["name"] == "Chest Press"


def test_exercise_qr(client, auth):
    r = client.get("/api/exercises/qr/fitapp://machine/leg-press", headers=auth)
    assert r.status_code == 200 and r.json()["name"] == "Leg Press"
    assert client.get("/api/exercises/qr/leg-press", headers=auth).json()["name"] == "Leg Press"
    assert client.get("/api/exercises/qr/nope", headers=auth).status_code == 404
    png = client.get(f"/api/exercises/{r.json()['id']}/qr.png")
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"


def test_workout_flow(client, auth):
    lat = client.get("/api/exercises/qr/lat-pulldown", headers=auth).json()
    w = client.post("/api/workouts", json={}, headers=auth).json()
    s1 = client.post(f"/api/workouts/{w['id']}/sets", json={"exercise_id": lat["id"], "reps": 10, "weight": 50, "added_via": "qr"}, headers=auth).json()
    s2 = client.post(f"/api/workouts/{w['id']}/sets", json={"exercise_id": lat["id"], "reps": 8, "weight": 120, "unit": "lb", "notes": "hard"}, headers=auth).json()
    assert (s1["set_number"], s2["set_number"]) == (1, 2)
    assert s2["weight_kg"] == 54.43
    r = client.patch(f"/api/workouts/{w['id']}/sets/{s1['id']}", json={"reps": 12}, headers=auth)
    assert r.json()["reps"] == 12 and r.json()["weight_kg"] == 50
    done = client.patch(f"/api/workouts/{w['id']}", json={"finish": True, "notes": "good"}, headers=auth).json()
    assert done["ended_at"] and done["set_count"] == 2
    assert done["volume_kg"] == round(12 * 50 + 8 * 54.43, 1)
    assert len(client.get("/api/workouts", headers=auth).json()) == 1
    # another user cannot see it
    other = signup_and_login(client, email="other@example.com")
    assert client.get(f"/api/workouts/{w['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/workouts/{w['id']}/sets/{s1['id']}", headers=auth).status_code == 204
    assert client.delete(f"/api/workouts/{w['id']}", headers=auth).status_code == 204


# ---------- food ----------

def test_food_search_local_and_online(client, auth):
    r = client.get("/api/foods/search", params={"q": "banan"}, headers=auth).json()
    assert r["local"][0]["name"] == "Banana"
    online = {c["source"]: c for c in r["online"]}
    usda, off = online["usda"], online["off"]
    assert usda["name"] == "Quinoa, cooked" and usda["calories"] == 120 and usda["fiber_g"] == 2.8
    assert off["is_liquid"] and off["sodium_mg"] == 40 and off["brand"] == "Brand A"
    assert off["serving_size"] == 250 and off["serving_unit"] == "ml"

    food = client.post("/api/foods/import", json=usda, headers=auth).json()
    again = client.post("/api/foods/import", json=usda, headers=auth).json()
    assert food["id"] == again["id"]
    # once imported it shows up as a local result, not twice
    r = client.get("/api/foods/search", params={"q": "quinoa"}, headers=auth).json()
    assert any(f["id"] == food["id"] for f in r["local"])
    assert not any(c["source"] == "usda" for c in r["online"])


def test_food_search_when_apis_are_down(client, auth):
    import httpx

    from app.main import app
    from app.routers.foods import get_http_client

    async def failing():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(503))) as c:
            yield c

    app.dependency_overrides[get_http_client] = failing
    r = client.get("/api/foods/search", params={"q": "rice"}, headers=auth).json()
    assert r["local"] and r["online"] == [] and len(r["warnings"]) == 2


def test_manual_food_and_log(client, auth):
    # label: 1 bar = 40 g, 180 kcal, 10 g protein, 20 g carbs, 7 g fat
    bar = client.post("/api/foods", json={
        "name": "Protein bar", "serving_size": 40, "serving_unit": "g",
        "calories": 180, "protein_g": 10, "carbs_g": 20, "fat_g": 7, "sugar_g": 4,
    }, headers=auth).json()
    assert bar["calories"] == 450 and bar["sugar_g"] == 10  # per 100 g
    units = client.get(f"/api/foods/{bar['id']}/units", headers=auth).json()
    assert units[0] == "serving" and "oz" in units and "ml" not in units

    entry = client.post("/api/food-logs", json={"food_id": bar["id"], "quantity": 1, "unit": "serving", "meal": "snack"}, headers=auth).json()
    assert entry["calories"] == 180 and entry["amount_base"] == 40

    bad = client.post("/api/food-logs", json={"food_id": bar["id"], "quantity": 1, "unit": "cup"}, headers=auth)
    assert bad.status_code == 422

    milk = client.get("/api/foods/search", params={"q": "whole milk", "online": False}, headers=auth).json()["local"][0]
    assert milk["is_liquid"]
    m = client.post("/api/food-logs", json={"food_id": milk["id"], "quantity": 1, "unit": "cup", "meal": "breakfast"}, headers=auth).json()
    assert m["amount_base"] == 236.6

    day = client.get("/api/food-logs", headers=auth).json()
    assert len(day["entries"]) == 2
    assert day["totals"]["calories"] == round(180 + 62 * 2.366, 1)
    assert day["target_calories"]

    edited = client.patch(f"/api/food-logs/{entry['id']}", json={"quantity": 2}, headers=auth).json()
    assert edited["calories"] == 360
    # custom foods are private
    other = signup_and_login(client, email="other@example.com")
    assert client.get(f"/api/foods/{bar['id']}", headers=other).status_code == 404
    assert client.delete(f"/api/foods/{bar['id']}", headers=auth).status_code == 409


# ---------- measurements & analytics ----------

def test_measurements_compare(client, auth):
    client.post("/api/measurements", json={"date": "2026-09-05", "waist_cm": 95, "neck_cm": 40, "shoulders_cm": 120}, headers=auth)
    client.post("/api/measurements", json={"date": "2026-10-05", "waist_cm": 91, "neck_cm": 40, "shoulders_cm": 121}, headers=auth)
    r = client.post("/api/measurements", json={"date": "2026-10-06", "arm_cm": 14, "unit": "in"}, headers=auth)
    assert r.json()["arm_cm"] == 35.6
    assert client.post("/api/measurements", json={}, headers=auth).status_code == 422

    cmp = client.get("/api/measurements/compare", headers=auth).json()
    assert cmp["months"] == ["2026-09", "2026-10"]
    rows = {row["field"]: row for row in cmp["rows"]}
    assert rows["waist_cm"]["difference"] == -4
    assert rows["shoulders_cm"]["difference"] == 1
    assert rows["arm_cm"]["first"] is None and rows["arm_cm"]["second"] == 35.6
    assert rows["body_fat_pct"]["difference"] < 0


def test_analytics(client, auth):
    for i, w in enumerate([95, 94.6, 94.1]):
        d = (date.today() - timedelta(days=21 - i * 7)).isoformat()
        client.post("/api/me/weight", json={"weight": w, "date": d}, headers=auth)
    weight = client.get("/api/analytics/weight", headers=auth).json()
    assert weight["series"][0]["data"][-1] == 95  # profile weigh-in is today
    assert weight["target_weight_kg"] == 71.3

    banana = client.get("/api/foods/search", params={"q": "banana", "online": False}, headers=auth).json()["local"][0]
    client.post("/api/food-logs", json={"food_id": banana["id"], "quantity": 200, "unit": "g"}, headers=auth)
    cal = client.get("/api/analytics/calories", headers=auth).json()
    assert len(cal["labels"]) == 14 and cal["series"][0]["data"][-1] == 178

    press = client.get("/api/exercises/qr/chest-press", headers=auth).json()
    w = client.post("/api/workouts", json={}, headers=auth).json()
    client.post(f"/api/workouts/{w['id']}/sets", json={"exercise_id": press["id"], "reps": 10, "weight": 60}, headers=auth)
    prog = client.get(f"/api/analytics/exercise/{press['id']}", headers=auth).json()
    assert prog["series"][0]["data"] == [80.0] and prog["volume"] == [600]
    assert client.get("/api/analytics/exercises", headers=auth).json()[0]["name"] == "Chest Press"
    vol = client.get("/api/analytics/volume", headers=auth).json()
    chest = next(s for s in vol["series"] if s["name"] == "Chest")
    assert chest["data"][-1] == 600


def test_delete_account(client, auth):
    w = client.post("/api/workouts", json={}, headers=auth).json()
    press = client.get("/api/exercises/qr/chest-press", headers=auth).json()
    client.post(f"/api/workouts/{w['id']}/sets", json={"exercise_id": press["id"], "reps": 5}, headers=auth)
    assert client.delete("/api/me", headers=auth).status_code == 204
    assert client.get("/api/me", headers=auth).status_code == 401
    signup_and_login(client)  # the email can be used again
