"""Gyms, machine settings, photograph-a-gym and the photos that teach the app your machines.

A fake image model (vectors from a photo's average colour), a fake machine classifier and a fake vision
model stand in for the real ones: no download, no GPU, no network.
"""

import io

import httpx
import pytest
from PIL import Image
from sqlmodel import select

from app.config import get_settings
from app.main import app
from app.models.exercise import Exercise
from app.routers.exercises import get_machine_recognizer, get_recognizer
from app.routers.gyms import get_embedder
from app.services import photo_match
from app.services.machine_classifier import MachineClassifier
from app.services.recognition import Recognizer
from tests.conftest import signup_and_login
from tests.test_recognition import FakeVision, machine  # noqa: F401 (machine is a fixture)


def photo(rgb: tuple[int, int, int]) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (64, 48), rgb).save(out, format="JPEG")
    return out.getvalue()


class FakeEmbedder:
    """Photos of the same colour are 'the same machine'."""

    name = "fake-colour"

    def __init__(self, ready=True):
        self.is_ready = ready
        self.calls = 0

    def ready(self) -> bool:
        return self.is_ready

    def embed(self, image: bytes) -> list[float]:
        self.calls += 1
        img = Image.open(io.BytesIO(image)).convert("RGB").resize((1, 1))
        r, g, b = img.getpixel((0, 0))
        v = [r + 1.0, g + 1.0, b + 1.0]
        n = sum(x * x for x in v) ** 0.5
        return [x / n for x in v]


@pytest.fixture(autouse=True)
def folders(tmp_path, monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "photos_dir", str(tmp_path / "photos"))
    monkeypatch.setattr(settings, "models_dir", str(tmp_path / "models"))
    return tmp_path


@pytest.fixture
def embedder(client):
    fake = FakeEmbedder()
    app.dependency_overrides[get_embedder] = lambda: fake
    return fake


@pytest.fixture
def vision(client):
    fake = FakeVision()
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_recognizer] = lambda: Recognizer(http, "http://localhost:11434", "qwen3-vl:8b")
    return fake


def exercise_id(session, name: str) -> int:
    return session.exec(select(Exercise).where(Exercise.name == name)).one().id


def recognize(client, auth, data: bytes, gym_id=None):
    params = {"gym_id": gym_id} if gym_id else {}
    return client.post("/api/photo-memory/recognize", files={"image": ("p.jpg", data, "image/jpeg")}, params=params, headers=auth)


# ---------- gyms ----------

def test_first_gym_takes_earlier_workouts(client, auth, session):
    import datetime as dt

    from app.models.user import User
    from tests.conftest import add_workout

    user = session.exec(select(User).where(User.email == "sara@example.com")).one()
    old = add_workout(session, user, dt.date.today() - dt.timedelta(days=3))  # logged before gyms existed
    gym = client.get("/api/gyms", headers=auth).json()[0]
    assert gym["workouts"] == 1
    assert client.get(f"/api/workouts/{old.id}", headers=auth).json()["gym_id"] == gym["id"]


def test_gyms_default_rename_and_delete(client, auth):
    gyms = client.get("/api/gyms", headers=auth).json()
    assert [(g["name"], g["is_default"]) for g in gyms] == [("My gym", True)]
    home = gyms[0]["id"]
    hotel = client.post("/api/gyms", json={"name": "Hotel gym", "make_default": True}, headers=auth).json()
    names = [(g["name"], g["is_default"]) for g in client.get("/api/gyms", headers=auth).json()]
    assert names == [("Hotel gym", True), ("My gym", False)]  # default first

    # new workouts happen at the default gym; it can be changed
    w = client.post("/api/workouts", json={}, headers=auth).json()
    assert w["gym_id"] == hotel["id"]
    assert client.put(f"/api/workouts/{w['id']}/gym", json={"gym_id": home}, headers=auth).status_code == 200
    assert client.get(f"/api/workouts/{w['id']}", headers=auth).json()["gym_id"] == home

    renamed = client.patch(f"/api/gyms/{hotel['id']}", json={"name": "Hilton gym"}, headers=auth).json()
    assert renamed["name"] == "Hilton gym" and renamed["is_default"]
    assert client.delete(f"/api/gyms/{hotel['id']}", headers=auth).status_code == 204
    gyms = client.get("/api/gyms", headers=auth).json()
    assert [(g["name"], g["is_default"], g["workouts"]) for g in gyms] == [("My gym", True, 1)]
    assert client.delete(f"/api/gyms/{home}", headers=auth).status_code == 409  # never the only gym

    other = signup_and_login(client, email="other@example.com")
    assert client.patch(f"/api/gyms/{home}", json={"name": "x"}, headers=other).status_code == 404
    assert client.put(f"/api/workouts/{w['id']}/gym", json={"gym_id": home}, headers=other).status_code == 404


# ---------- machine settings ----------

def test_machine_settings_per_gym(client, auth, session):
    gym = client.get("/api/gyms", headers=auth).json()[0]["id"]
    hotel = client.post("/api/gyms", json={"name": "Hotel"}, headers=auth).json()["id"]
    leg_press = exercise_id(session, "Leg Press")
    url = f"/api/gyms/{gym}/machines/{leg_press}"
    empty = client.get(url, headers=auth).json()
    assert empty["saved"] is False and empty["seat"] == "" and empty["exercise_name"] == "Leg Press"

    saved = client.put(url, json={"seat": "4", "back_pad": "2", "notes": " feet high "}, headers=auth).json()
    assert (saved["saved"], saved["seat"], saved["back_pad"], saved["notes"]) == (True, "4", "2", "feet high")
    assert client.get(url, headers=auth).json()["seat"] == "4"
    assert client.get(f"/api/gyms/{hotel}/machines/{leg_press}", headers=auth).json()["saved"] is False  # per gym
    assert [m["exercise_name"] for m in client.get(f"/api/gyms/{gym}/machines", headers=auth).json()] == ["Leg Press"]

    # all empty removes them
    cleared = client.put(url, json={"seat": "", "back_pad": "", "notes": ""}, headers=auth).json()
    assert cleared["saved"] is False
    assert client.get(f"/api/gyms/{gym}/machines", headers=auth).json() == []

    other = signup_and_login(client, email="other@example.com")
    assert client.get(url, headers=other).status_code == 404


# ---------- the app learns your machines ----------

def test_photo_memory_learns_a_corrected_machine(client, auth, session, embedder, machine, folders):
    leg_press, hack_squat = exercise_id(session, "Leg Press"), exercise_id(session, "Hack Squat")
    machine.probs = {"hack_squat": 0.7, "leg_press": 0.3}
    red = photo((200, 30, 30))

    # nothing saved yet: the classifier's best guess (wrong here)
    first = recognize(client, auth, red).json()
    assert first["source"] == "model" and first["match"] is None
    assert first["guesses"][0]["exercise"]["id"] == hack_squat
    assert len(machine.inputs) == 1

    # the user corrects it: the photo is remembered as the leg press
    saved = client.post("/api/photo-memory/photos", json={
        "photo_token": first["photo_token"], "exercise_id": leg_press, "corrected": True}, headers=auth)
    assert saved.status_code == 201, saved.text
    body = saved.json()
    assert body["exercise_name"] == "Leg Press" and body["corrected"] and body["matchable"]
    assert body["thumbnail"].startswith("data:image/jpeg;base64,")
    # a token can only be used once
    assert client.post("/api/photo-memory/photos", json={"photo_token": first["photo_token"], "exercise_id": leg_press},
                       headers=auth).status_code == 404

    # the same machine again (slightly different light): matched from memory, the classifier isn't asked
    again = recognize(client, auth, photo((205, 36, 28))).json()
    assert again["source"] == "memory"
    assert again["match"]["exercise"]["id"] == leg_press and again["match"]["similarity"] > 0.99
    assert again["guesses"][0]["exercise"]["id"] == leg_press
    assert len(machine.inputs) == 1

    # a different machine: not close enough, so the classifier is asked
    other = recognize(client, auth, photo((30, 30, 200))).json()
    assert other["source"] == "model" and len(machine.inputs) == 2

    photos = client.get("/api/photo-memory/photos", headers=auth).json()
    assert [p["exercise_name"] for p in photos] == ["Leg Press"]
    files = list((folders / "photos").rglob("*.jpeg"))
    assert any("pending" not in str(f) for f in files)
    assert client.delete(f"/api/photo-memory/photos/{photos[0]['id']}", headers=auth).status_code == 204
    assert client.get("/api/photo-memory/photos", headers=auth).json() == []
    assert not [f for f in (folders / "photos").rglob("*.jpeg") if "pending" not in str(f)]

    # another user can't use someone else's photo or delete it
    stranger = signup_and_login(client, email="other@example.com")
    token = recognize(client, auth, red).json()["photo_token"]
    assert client.post("/api/photo-memory/photos", json={"photo_token": token, "exercise_id": leg_press},
                       headers=stranger).status_code == 404


def test_photos_saved_before_the_model_was_there_are_matched_later(client, auth, session, embedder, machine):
    leg_press = exercise_id(session, "Leg Press")
    machine.probs = {"leg_press": 0.9}
    embedder.is_ready = False
    status = client.get("/api/photo-memory/status", headers=auth).json()
    assert status["ready"] is False and "351 MB" in status["problem"]

    first = recognize(client, auth, photo((20, 160, 40))).json()
    assert first["source"] == "model" and first["memory_ready"] is False
    saved = client.post("/api/photo-memory/photos", json={"photo_token": first["photo_token"], "exercise_id": leg_press},
                        headers=auth).json()
    assert saved["matchable"] is False

    embedder.is_ready = True  # the model has been downloaded since
    again = recognize(client, auth, photo((22, 158, 41))).json()
    assert again["source"] == "memory" and again["match"]["exercise"]["id"] == leg_press
    assert client.get("/api/photo-memory/photos", headers=auth).json()[0]["matchable"] is True


def test_without_the_model_file_the_user_picks_by_hand(client, auth, session, embedder, folders):
    app.dependency_overrides[get_machine_recognizer] = lambda: MachineClassifier(folders / "no-model")
    r = recognize(client, auth, photo((90, 90, 90)))
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "none" and body["guesses"] == [] and "isn't on this PC" in body["problem"]
    # the hand-picked machine is still remembered
    saved = client.post("/api/photo-memory/photos", json={
        "photo_token": body["photo_token"], "exercise_id": exercise_id(session, "Leg Press")}, headers=auth)
    assert saved.status_code == 201
    assert recognize(client, auth, photo((92, 91, 90))).json()["source"] == "memory"
    assert recognize(client, auth, b"not a photo").status_code == 415


def test_model_download_starts_once(client, auth, monkeypatch, embedder):
    embedder.is_ready = False
    started = []
    monkeypatch.setattr(photo_match.download, "start", lambda url, path: started.append((url, path)))
    r = client.post("/api/photo-memory/download", headers=auth)
    assert r.status_code == 200 and len(started) == 1
    assert started[0][0].endswith("/ViT-B-32/visual.onnx")
    embedder.is_ready = True
    client.post("/api/photo-memory/download", headers=auth)
    assert len(started) == 1  # already there: nothing to do


# ---------- photograph a gym ----------

def test_photograph_a_gym_and_build_a_session(client, auth, session, vision):
    gym = client.get("/api/gyms", headers=auth).json()[0]["id"]
    leg_press, chest_press = exercise_id(session, "Leg Press"), exercise_id(session, "Chest Press")
    vision.answer = {
        "seen": "a small hotel gym",
        "machines": [{"exercise_id": leg_press, "confidence": 0.8}, {"exercise_id": chest_press, "confidence": 0.6},
                     {"exercise_id": 99999, "confidence": 0.9}],
        "equipment": [{"key": "dumbbells", "present": True, "confidence": 0.9},
                      {"key": "barbell", "present": False, "confidence": 0.2},
                      {"key": "jacuzzi", "present": True, "confidence": 0.9}],
    }
    scan = client.post(f"/api/gyms/{gym}/scan", files={"image": ("g.jpg", photo((120, 120, 120)), "image/jpeg")}, headers=auth)
    assert scan.status_code == 200, scan.text
    body = scan.json()
    assert [m["exercise"]["id"] for m in body["machines"]] == [leg_press, chest_press]  # unknown ids dropped
    assert [e["key"] for e in body["equipment"]] == ["dumbbells"]  # only known kinds that are there
    assert "pull_up_bar" in body["equipment_choices"]
    prompt = vision.requests[-1]["messages"][0]["content"]
    assert "Leg Press" in prompt and "Dumbbell" not in prompt  # only machines are listed by name

    # the user ticks what's right
    saved = client.put(f"/api/gyms/{gym}/equipment", json={"machines": [leg_press], "equipment": ["dumbbells", "spa"]},
                       headers=auth).json()
    assert saved["machines"] == [leg_press] and saved["equipment"] == ["dumbbells"]

    plan = client.post(f"/api/gyms/{gym}/session", json={}, headers=auth)
    assert plan.status_code == 200, plan.text
    day = plan.json()["day"]
    allowed = set(session.exec(select(Exercise.id).where(
        (Exercise.category == "bodyweight") | (Exercise.id == leg_press)
        | ((Exercise.category == "free weight") & (Exercise.equipment == "home")))).all())
    used = [x["exercise_id"] for x in day["exercises"]]
    assert used and set(used) <= allowed
    pull_ups = set(session.exec(select(Exercise.id).where(Exercise.pattern.in_(["vertical_pull", "horizontal_pull"]),
                                                          Exercise.category == "bodyweight")).all())
    assert not set(used) & pull_ups  # no pull-up bar was ticked
    assert day["title"].endswith("at My gym")

    # bodyweight only (an empty room)
    bare = client.post(f"/api/gyms/{gym}/session", json={"machines": [], "equipment": []}, headers=auth).json()
    cats = {session.get(Exercise, x["exercise_id"]).category for x in bare["day"]["exercises"]}
    assert cats == {"bodyweight"}

    inventory = client.get(f"/api/gyms/{gym}/inventory", headers=auth).json()
    assert leg_press in inventory["from_scan"] and chest_press not in inventory["exercise_ids"]

    vision.down = True
    down = client.post(f"/api/gyms/{gym}/scan", files={"image": ("g.jpg", photo((1, 2, 3)), "image/jpeg")}, headers=auth)
    assert down.status_code == 503 and "Ollama" in down.json()["detail"]


def test_inventory_from_logged_workouts_photos_and_settings(client, auth, session, embedder, vision):
    gym = client.get("/api/gyms", headers=auth).json()[0]["id"]
    leg_press, curl = exercise_id(session, "Leg Press"), exercise_id(session, "Dumbbell Curl")
    w = client.post("/api/workouts", json={}, headers=auth).json()
    client.post(f"/api/workouts/{w['id']}/sets", json={"exercise_id": curl, "reps": 10, "weight": 10}, headers=auth)
    client.put(f"/api/gyms/{gym}/machines/{leg_press}", json={"seat": "3"}, headers=auth)
    inv = client.get(f"/api/gyms/{gym}/inventory", headers=auth).json()
    assert inv["logged"] == [curl] and inv["with_settings"] == [leg_press]
    assert set(inv["exercise_ids"]) == {curl, leg_press}


def test_deleting_the_account_removes_photo_files(client, auth, session, embedder, machine, folders):
    token = recognize(client, auth, photo((10, 200, 10))).json()["photo_token"]
    client.post("/api/photo-memory/photos", json={"photo_token": token, "exercise_id": exercise_id(session, "Leg Press")},
                headers=auth)
    kept = [f for f in (folders / "photos").rglob("*.jpeg") if "pending" not in str(f)]
    assert kept
    assert client.delete("/api/me", headers=auth).status_code == 204
    assert not [f for f in (folders / "photos").rglob("*.jpeg") if "pending" not in str(f)]


def test_pending_photo_metadata_is_per_user(folders):
    token = photo_match.save_pending(1, b"abc", "jpeg", [0.1, 0.2], "m")
    assert photo_match.take_pending(2, token) is None
    assert photo_match.take_pending(1, "../../etc") is None
    image, ext, emb, model = photo_match.take_pending(1, token)
    assert (image, ext, emb, model) == (b"abc", "jpeg", [0.1, 0.2], "m")
    assert photo_match.take_pending(1, token) is None
    assert list((folders / "photos" / "pending").glob("*.json")) == []
