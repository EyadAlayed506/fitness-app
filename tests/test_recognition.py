"""Recognising a machine from a photo, with a fake Ollama vision model (no network, no GPU)."""

import base64
import json

import httpx
import pytest
from sqlmodel import select

from app.main import app
from app.models.exercise import Exercise
from app.routers.exercises import get_recognizer
from app.services.recognition import Recognizer, image_type

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200  # starts like a real JPEG


class FakeVision:
    def __init__(self, answer=None, models=("qwen3-vl:8b",), status=200, down=False):
        self.answer, self.models, self.status, self.down = answer, models, status, down
        self.requests: list[dict] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("refused", request=request)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": m} for m in self.models]})
        self.requests.append(json.loads(request.content))
        if self.status != 200:
            return httpx.Response(self.status, json={"error": "model crashed"})
        content = self.answer if isinstance(self.answer, str) else json.dumps(self.answer)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": content}, "done": True})


@pytest.fixture
def vision(client):
    fake = FakeVision()
    http = httpx.Client(transport=httpx.MockTransport(fake.handler))
    app.dependency_overrides[get_recognizer] = lambda: Recognizer(http, "http://localhost:11434", "qwen3-vl:8b")
    return fake


def ids(session, *names):
    return [session.exec(select(Exercise).where(Exercise.name == n)).one().id for n in names]


def send(client, auth, data=JPEG, name="photo.jpg"):
    return client.post("/api/exercises/recognize", files={"image": (name, data, "image/jpeg")}, headers=auth)


def test_photo_gives_the_best_guesses_from_the_catalogue(client, auth, session, vision):
    leg_press, hack_squat = ids(session, "Leg Press", "Hack Squat")
    vision.answer = {"seen": "a seated leg press machine", "guesses": [
        {"exercise_id": hack_squat, "confidence": 0.2},
        {"exercise_id": leg_press, "confidence": 0.85},
        {"exercise_id": 99999, "confidence": 0.9},  # not in the catalogue: dropped
        {"exercise_id": leg_press, "confidence": 0.5},  # duplicate: dropped
    ]}
    r = send(client, auth)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [g["exercise"]["name"] for g in body["guesses"]] == ["Leg Press", "Hack Squat"]
    assert body["guesses"][0]["confidence"] == 0.85 and body["seen"] == "a seated leg press machine"
    assert body["guesses"][0]["exercise"]["instructions"]  # full exercise details for the confirm screen

    request = vision.requests[0]
    assert request["model"] == "qwen3-vl:8b" and request["format"]["required"] == ["seen", "guesses"]
    message = request["messages"][0]
    assert base64.b64decode(message["images"][0]) == JPEG
    assert f"{leg_press}: Leg Press" in message["content"]  # the model chooses from the app's list


def test_nothing_recognised(client, auth, vision):
    vision.answer = {"seen": "a cat on a sofa", "guesses": []}
    body = send(client, auth).json()
    assert body["guesses"] == [] and body["seen"] == "a cat on a sofa"


def test_only_photos_are_accepted(client, auth, vision):
    r = send(client, auth, data=b"%PDF-1.7 not a photo", name="doc.pdf")
    assert r.status_code == 415
    assert vision.requests == []


def test_ollama_or_model_missing(client, auth, vision):
    vision.down = True
    r = send(client, auth)
    assert r.status_code == 503 and "Ollama isn't running" in r.json()["detail"]
    vision.down, vision.models = False, ("qwen3:8b",)
    r = send(client, auth)
    assert r.status_code == 503 and r.json()["detail"].endswith("ollama pull qwen3-vl:8b")


def test_model_errors_and_unreadable_answers(client, auth, vision):
    vision.status = 500
    assert send(client, auth).status_code == 502
    vision.status, vision.answer = 200, "this is not json"
    r = send(client, auth)
    assert r.status_code == 502 and "couldn't read" in r.json()["detail"]


def test_image_type():
    assert image_type(JPEG) == "jpeg"
    assert image_type(b"\x89PNG\r\n\x1a\n...") == "png"
    assert image_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"
    assert image_type(b"GIF89a") is None


def test_sets_can_be_marked_as_added_by_photo(client, auth):
    workout = client.post("/api/workouts", json={}, headers=auth).json()
    r = client.post(f"/api/workouts/{workout['id']}/sets", json={"exercise_id": 1, "reps": 10, "added_via": "photo"}, headers=auth)
    assert r.status_code == 201 and r.json()["added_via"] == "photo"
