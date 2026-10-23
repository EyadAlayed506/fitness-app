"""Recognising a machine from a photo with the MobileNet classifier, with a fake model (no ONNX file needed).

FakeVision (a fake Ollama vision model) is used by the gym-scan and snap-and-say tests.
"""

import io
import json

import httpx
import numpy as np
import pytest
from PIL import Image

from app.main import app
from app.routers.exercises import get_machine_recognizer
from app.services.machine_classifier import MACHINE_EXERCISES, MachineClassifier, prepare
from app.services.recognition import image_type

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200  # starts like a real JPEG, but can't be opened
LABELS = ["ab_crunch", "hack_squat", "leg_press", "treadmill"]  # treadmill: no exercise in the catalogue


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


class FakeMachineModel:
    """Answers with the probabilities in `probs` (label -> probability) and records what it was given."""

    def __init__(self):
        self.probs: dict[str, float] = {"leg_press": 1.0}
        self.inputs: list[np.ndarray] = []

    def __call__(self, x: np.ndarray) -> np.ndarray:
        self.inputs.append(x)
        return np.array([[self.probs.get(label, 0.0) for label in LABELS]], dtype=np.float32)


@pytest.fixture
def machine(client, tmp_path):
    fake = FakeMachineModel()
    (tmp_path / "labels.txt").write_text("\n".join(LABELS) + "\n")
    app.dependency_overrides[get_machine_recognizer] = lambda: MachineClassifier(tmp_path, predict=fake)
    return fake


def photo(size=(640, 480), rgb=(120, 120, 120)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, rgb).save(out, format="JPEG")
    return out.getvalue()


def send(client, auth, data=None, name="photo.jpg"):
    return client.post("/api/exercises/recognize", files={"image": (name, data or photo(), "image/jpeg")}, headers=auth)


def test_photo_gives_the_best_guesses_from_the_catalogue(client, auth, machine):
    machine.probs = {"leg_press": 0.85, "hack_squat": 0.1, "ab_crunch": 0.02, "treadmill": 0.03}
    r = send(client, auth)
    assert r.status_code == 200, r.text
    body = r.json()
    # unlikely ones (under 5 %) are left out
    assert [(g["exercise"]["name"], g["confidence"]) for g in body["guesses"]] == [("Leg Press", 0.85), ("Hack Squat", 0.1)]
    assert body["guesses"][0]["exercise"]["instructions"]  # full exercise details for the confirm screen
    assert body["seen"] == "Looks like a leg press machine (85% sure)"
    assert body["model"].startswith("MobileNet")
    assert machine.inputs[0].shape == (1, 224, 224, 3) and machine.inputs[0].dtype == np.float32


def test_unsure_and_machines_without_an_exercise(client, auth, machine):
    machine.probs = {"treadmill": 0.4, "hack_squat": 0.35, "leg_press": 0.25}
    body = send(client, auth).json()
    assert body["seen"] == "Not sure; closest is a treadmill machine (40%)"
    assert [g["exercise"]["name"] for g in body["guesses"]] == ["Hack Squat", "Leg Press"]  # no treadmill exercise


def test_only_photos_are_accepted(client, auth, machine):
    assert send(client, auth, data=b"%PDF-1.7 not a photo", name="doc.pdf").status_code == 415
    r = send(client, auth, data=JPEG)  # looks like a JPEG but isn't one
    assert r.status_code == 415 and "couldn't read" in r.json()["detail"]
    assert machine.inputs == []


def test_model_file_missing(client, auth, tmp_path):
    app.dependency_overrides[get_machine_recognizer] = lambda: MachineClassifier(tmp_path / "nowhere")
    r = send(client, auth)
    assert r.status_code == 503 and "isn't on this PC" in r.json()["detail"]


def test_prepare_crops_the_centre_and_turns_photos_upright():
    tall = io.BytesIO()
    im = Image.new("RGB", (300, 600), (0, 0, 0))
    im.paste((255, 0, 0), (0, 0, 300, 300))  # top half red
    exif = Image.Exif()
    exif[0x0112] = 3  # stored upside down
    im.save(tall, format="JPEG", exif=exif)
    x = prepare(tall.getvalue())
    assert x.shape == (1, 224, 224, 3)
    assert x[0, -1, 112, 0] > 200 and x[0, 0, 112, 0] < 50  # turned upright: the red half is now at the bottom


def test_every_label_of_the_trained_model_has_an_exercise(session):
    from sqlmodel import select

    from app.models.exercise import Exercise

    names = {e.name for e in session.exec(select(Exercise)).all()}
    trained = ["ab_crunch", "arm_curl", "calf_raise", "chest_press", "hack_squat", "hip_abductor", "lat_pulldown",
               "lateral_raise", "leg_curl", "leg_extension", "leg_press", "pec_deck", "seated_row"]
    assert all(any(n in names for n in MACHINE_EXERCISES[label]) for label in trained)


def test_image_type():
    assert image_type(JPEG) == "jpeg"
    assert image_type(b"\x89PNG\r\n\x1a\n...") == "png"
    assert image_type(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "webp"
    assert image_type(b"GIF89a") is None


def test_sets_can_be_marked_as_added_by_photo(client, auth):
    workout = client.post("/api/workouts", json={}, headers=auth).json()
    r = client.post(f"/api/workouts/{workout['id']}/sets", json={"exercise_id": 1, "reps": 10, "added_via": "photo"}, headers=auth)
    assert r.status_code == 201 and r.json()["added_via"] == "photo"
