"""Recognise a gym machine from a photo with the MobileNet trained in ml/machine_classifier (ONNX, on the processor).

The model sorts a photo into one of its machines (labels.txt next to the .onnx file); each machine maps to an
exercise in the app's catalogue (MACHINE_EXERCISES). It answers in about 20 ms without a graphics card or
Ollama. The user still confirms the guess, as with the vision model it replaces.
"""

import io
import threading
from collections.abc import Callable
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

from app.models.exercise import Exercise
from app.services.recognition import Guess, RecognitionError

MAX_GUESSES = 3
MIN_CONFIDENCE = 0.05
SURE = 0.5  # below this the answer says "not sure"
SIZE = 224  # the model's input; photos are resized so the short side is SIZE / 0.875, then centre-cropped

# model label -> catalogue exercise names, best first (the first one in the catalogue is used)
MACHINE_EXERCISES: dict[str, list[str]] = {
    "ab_crunch": ["Ab Crunch Machine"],
    "arm_curl": ["Biceps Curl Machine"],
    "bench_press": ["Bench Press", "Barbell Bench Press"],
    "cable_crossover": ["Cable Crossover"],
    "calf_raise": ["Seated Calf Raise"],
    "chest_press": ["Chest Press"],
    "hack_squat": ["Hack Squat"],
    "hip_abductor": ["Hip Abduction Machine"],
    "lat_pulldown": ["Lat Pulldown"],
    "lateral_raise": ["Lateral Raise Machine"],
    "leg_curl": ["Seated Leg Curl", "Lying Leg Curl"],
    "leg_extension": ["Leg Extension"],
    "leg_press": ["Leg Press"],
    "pec_deck": ["Pec Deck"],
    "seated_dip": ["Triceps Dip Machine"],
    "seated_row": ["Seated Cable Row", "Chest-Supported Row Machine"],
    "shoulder_press": ["Shoulder Press Machine"],
}


def prepare(image: bytes) -> np.ndarray:
    """A photo as the model's input: upright, RGB, short side 256 px, centre 224x224, NHWC float32 0-255."""
    try:
        im = ImageOps.exif_transpose(Image.open(io.BytesIO(image))).convert("RGB")
    except (OSError, ValueError) as e:
        raise RecognitionError(415, f"The app couldn't read that photo ({e}).")
    s = round(SIZE / 0.875) / min(im.size)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.Resampling.BILINEAR, reducing_gap=None)
    left, top = (im.width - SIZE) // 2, (im.height - SIZE) // 2
    return np.asarray(im.crop((left, top, left + SIZE, top + SIZE)), dtype=np.float32)[None]


class _Session:
    """The ONNX model, loaded once per file (about 0.2 s) and shared by all requests."""

    _lock = threading.Lock()
    _cache: dict[Path, Callable[[np.ndarray], np.ndarray]] = {}

    @classmethod
    def get(cls, path: Path) -> Callable[[np.ndarray], np.ndarray]:
        with cls._lock:
            if path not in cls._cache:
                import onnxruntime as ort

                sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
                name = sess.get_inputs()[0].name
                cls._cache[path] = lambda x: sess.run(None, {name: x})[0]
            return cls._cache[path]


class MachineClassifier:
    """Same shape as recognition.Recognizer (problem / recognize / model), so the routers can use either."""

    def __init__(self, model_dir: Path, predict: Callable[[np.ndarray], np.ndarray] | None = None):
        self.model_dir = model_dir
        self.model = f"MobileNet ({model_dir.name})"
        self._predict = predict  # tests pass a fake; otherwise the ONNX model is loaded on first use

    @property
    def onnx_path(self) -> Path:
        return self.model_dir / "gym_machines.onnx"

    def labels(self) -> list[str]:
        return (self.model_dir / "labels.txt").read_text().split()

    def problem(self) -> str | None:
        if self._predict is None and not (self.onnx_path.exists() and (self.model_dir / "labels.txt").exists()):
            return (f"The machine recognition model isn't on this PC ({self.onnx_path} and labels.txt are missing). "
                    "Export it with ml/machine_classifier/evaluate_export.py, or set MACHINE_MODEL_DIR in .env.")
        return None

    def probabilities(self, image: bytes) -> dict[str, float]:
        predict = self._predict or _Session.get(self.onnx_path)
        p = predict(prepare(image))[0]
        return dict(zip(self.labels(), (float(v) for v in p)))

    def recognize(self, image: bytes, catalogue: list[Exercise]) -> tuple[list[Guess], str]:
        probs = self.probabilities(image)
        by_name = {e.name.lower(): e for e in catalogue}
        guesses: list[Guess] = []
        for label, p in sorted(probs.items(), key=lambda kv: -kv[1]):
            ex = next((by_name[n.lower()] for n in MACHINE_EXERCISES.get(label, []) if n.lower() in by_name), None)
            if ex and p >= MIN_CONFIDENCE and all(g.exercise.id != ex.id for g in guesses):
                guesses.append(Guess(ex, round(p, 2)))
            if len(guesses) == MAX_GUESSES:
                break
        best, p = max(probs.items(), key=lambda kv: kv[1])
        name = best.replace("_", " ")
        seen = f"Looks like a {name} machine ({p:.0%} sure)" if p >= SURE else f"Not sure; closest is a {name} machine ({p:.0%})"
        return guesses, seen
