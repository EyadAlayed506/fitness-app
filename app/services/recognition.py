"""Recognise a gym machine or exercise from a photo with a vision model running on this PC (Ollama).

No model is trained: the vision model gets the photo and the app's exercise list and picks up to three
exercises from that list. It can only answer with exercises that exist in the catalogue, and the user
always confirms the guess. The photo isn't stored.
"""

import base64
import json
from dataclasses import dataclass

import httpx

from app.models.exercise import Exercise
from app.services.assistant import ollama_problem

MAX_GUESSES = 3
MIN_CONFIDENCE = 0.05

PROMPT = """You identify gym machines and exercise equipment in photos for a workout app.

Pick the exercises from the list below that match what the photo shows. If a name or label is visible on the machine, use it. A free weight (barbell, dumbbell, kettlebell) or a bench can match several exercises: list the most likely ones.

Answer only with exercises from this list, using their id. Give up to 3 guesses, best first, with your confidence from 0 to 1. If the photo doesn't show gym equipment or nothing on the list matches, return an empty list. In "seen", describe in a few words what is in the photo.

Exercises (id: name - main muscles, equipment):
{catalogue}"""

ANSWER_FORMAT = {
    "type": "object",
    "properties": {
        "seen": {"type": "string"},
        "guesses": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"exercise_id": {"type": "integer"}, "confidence": {"type": "number"}},
                "required": ["exercise_id", "confidence"],
            },
        },
    },
    "required": ["seen", "guesses"],
}


GYM_PROMPT = """You look at a photo of a gym (for example a hotel gym) for a workout app and list the training equipment you can see.

Machines: pick the ones you can see from the list below, using their id, with your confidence from 0 to 1. Only list machines that are really in the photo.

Other equipment: for each of these keys, say whether it is in the photo, with your confidence: {equipment_keys}.

In "seen", describe the room in a few words.

Machines (id: name):
{machines}"""

GYM_FORMAT = {
    "type": "object",
    "properties": {
        "seen": {"type": "string"},
        "machines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"exercise_id": {"type": "integer"}, "confidence": {"type": "number"}},
                "required": ["exercise_id", "confidence"],
            },
        },
        "equipment": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"key": {"type": "string"}, "present": {"type": "boolean"}, "confidence": {"type": "number"}},
                "required": ["key", "present", "confidence"],
            },
        },
    },
    "required": ["seen", "machines", "equipment"],
}


class RecognitionError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


@dataclass
class Guess:
    exercise: Exercise
    confidence: float


def image_type(data: bytes) -> str | None:
    """jpeg / png / webp from the file's first bytes, or None for anything else."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


class Recognizer:
    def __init__(self, http: httpx.Client, url: str, model: str):
        self.http = http
        self.url = url.rstrip("/")
        self.model = model

    def problem(self) -> str | None:
        return ollama_problem(self.http, self.url, self.model)

    def recognize(self, image: bytes, catalogue: list[Exercise]) -> tuple[list[Guess], str]:
        listing = "\n".join(
            f"{e.id}: {e.name} - {e.primary_muscles or e.muscle_group}, {e.category}" for e in catalogue
        )
        answer = self._ask(image, PROMPT.format(catalogue=listing), ANSWER_FORMAT)

        by_id = {e.id: e for e in catalogue}
        guesses: list[Guess] = []
        for g in answer.get("guesses") or []:
            try:
                ex = by_id.get(int(g.get("exercise_id")))
                confidence = max(0.0, min(1.0, float(g.get("confidence", 0))))
            except (TypeError, ValueError, AttributeError):
                continue
            if ex and confidence >= MIN_CONFIDENCE and all(x.exercise.id != ex.id for x in guesses):
                guesses.append(Guess(ex, round(confidence, 2)))  # ids not in the catalogue are dropped
        guesses.sort(key=lambda g: -g.confidence)
        return guesses[:MAX_GUESSES], str(answer.get("seen") or "")[:200]

    def scan_gym(
        self, image: bytes, machines: list[Exercise], equipment_keys: list[str]
    ) -> tuple[list[Guess], dict[str, float], str]:
        """Machines (from the catalogue) and other equipment the vision model sees in a photo of a gym."""
        listing = "\n".join(f"{e.id}: {e.name}" for e in machines)
        answer = self._ask(
            image, GYM_PROMPT.format(machines=listing, equipment_keys=", ".join(equipment_keys)), GYM_FORMAT
        )
        by_id = {e.id: e for e in machines}
        found: list[Guess] = []
        for g in answer.get("machines") or []:
            try:
                ex = by_id.get(int(g.get("exercise_id")))
                confidence = max(0.0, min(1.0, float(g.get("confidence", 0))))
            except (TypeError, ValueError, AttributeError):
                continue
            if ex and confidence >= MIN_CONFIDENCE and all(x.exercise.id != ex.id for x in found):
                found.append(Guess(ex, round(confidence, 2)))
        found.sort(key=lambda g: -g.confidence)
        equipment: dict[str, float] = {}
        for item in answer.get("equipment") or []:
            try:
                key = str(item.get("key"))
                confidence = max(0.0, min(1.0, float(item.get("confidence", 0))))
            except (TypeError, ValueError, AttributeError):
                continue
            if key in equipment_keys and item.get("present") and confidence >= MIN_CONFIDENCE:
                equipment[key] = round(confidence, 2)
        return found, equipment, str(answer.get("seen") or "")[:200]

    def _ask(self, image: bytes, prompt: str, answer_format: dict) -> dict:
        """One question about one photo; the answer as a dict (or RecognitionError)."""
        try:
            r = self.http.post(
                f"{self.url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{
                        "role": "user",
                        "content": prompt,
                        "images": [base64.b64encode(image).decode()],
                    }],
                    "format": answer_format,
                    "stream": False,
                    "options": {"temperature": 0},
                },
                timeout=180,
            )
        except httpx.TimeoutException:
            raise RecognitionError(504, "The vision model took too long. Try again, or type the exercise name.")
        except httpx.HTTPError:
            raise RecognitionError(502, f"Couldn't reach Ollama at {self.url}. Is the Ollama app running?")
        if r.status_code >= 400:
            try:
                detail = r.json().get("error", r.text)
            except ValueError:
                detail = r.text
            raise RecognitionError(502, f"The vision model couldn't look at the photo: {detail}")
        try:
            answer = json.loads(r.json()["message"]["content"])
        except (KeyError, TypeError, ValueError):
            raise RecognitionError(502, "The vision model gave an answer the app couldn't read. Try again.")
        if not isinstance(answer, dict):
            raise RecognitionError(502, "The vision model gave an answer the app couldn't read. Try again.")
        return answer
