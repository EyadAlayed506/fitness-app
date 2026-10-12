"""The app learns your machines: compare a new photo with the user's earlier confirmed photos.

A small image model (CLIP ViT-B/32's image encoder, as ONNX, on the CPU) turns each photo into 512 numbers.
Photos of the same machine give similar numbers, so the nearest saved photo above a threshold is a match.
Only when nothing is close enough does the app ask the (much slower) vision model.

The model is downloaded once (351 MB) into models_dir. Photos and their numbers stay on this server.
"""

import base64
import io
import json
import threading
import time
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx
import numpy as np
from PIL import Image, ImageOps

from app.config import get_settings

# CLIP's image preprocessing: 224 x 224, these channel means and standard deviations
SIZE = 224
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
MODEL_SIZE_MB = 351.5
PENDING_HOURS = 24  # an unconfirmed photo is deleted after this


class Embedder(Protocol):
    name: str

    def ready(self) -> bool: ...

    def embed(self, image: bytes) -> list[float]: ...


def load_rgb(image: bytes) -> Image.Image:
    """The photo upright (phones store rotation separately) and in RGB."""
    img = Image.open(io.BytesIO(image))
    img = ImageOps.exif_transpose(img)
    return img.convert("RGB")


def preprocess(image: bytes) -> np.ndarray:
    """1 x 3 x 224 x 224: shortest side to 224, centre crop, scaled like CLIP was trained."""
    img = load_rgb(image)
    w, h = img.size
    scale = SIZE / min(w, h)
    img = img.resize((max(SIZE, round(w * scale)), max(SIZE, round(h * scale))), Image.Resampling.BICUBIC)
    w, h = img.size
    left, top = (w - SIZE) // 2, (h - SIZE) // 2
    img = img.crop((left, top, left + SIZE, top + SIZE))
    x = (np.asarray(img, dtype=np.float32) / 255.0 - MEAN) / STD
    return x.transpose(2, 0, 1)[None, :, :, :].astype(np.float32)


def thumbnail(image: bytes, size: int = 160) -> str:
    """A small JPEG of the photo as a data URI (shown in the list of saved photos)."""
    img = load_rgb(image)
    img.thumbnail((size, size))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(out.getvalue()).decode()


class ClipEmbedder:
    """CLIP ViT-B/32 image encoder via onnxruntime. Loaded on first use (about 5 s), then ~50 ms a photo."""

    name = "clip-vit-b32"

    def __init__(self, model_path: Path):
        self.model_path = model_path
        self._session = None
        self._lock = threading.Lock()

    def ready(self) -> bool:
        return self.model_path.exists()

    def _get_session(self):
        with self._lock:
            if self._session is None:
                import onnxruntime as ort

                options = ort.SessionOptions()
                options.log_severity_level = 3
                self._session = ort.InferenceSession(str(self.model_path), options, providers=["CPUExecutionProvider"])
            return self._session

    def embed(self, image: bytes) -> list[float]:
        session = self._get_session()
        out = session.run(None, {session.get_inputs()[0].name: preprocess(image)})[0][0]
        norm = float(np.linalg.norm(out)) or 1.0
        return [round(float(v) / norm, 6) for v in out]


# ---------- matching ----------

@dataclass
class Candidate:
    key: int  # the saved photo's id
    exercise_id: int
    vector: Sequence[float]


@dataclass
class Match:
    key: int
    exercise_id: int
    similarity: float


def nearest(query: Sequence[float], candidates: list[Candidate]) -> list[Match]:
    """Saved photos by similarity to the query, best first (one per exercise)."""
    if not candidates:
        return []
    q = np.asarray(query, dtype=np.float32)
    m = np.asarray([c.vector for c in candidates], dtype=np.float32)
    sims = m @ q  # vectors are normalised, so this is the cosine similarity
    best: dict[int, Match] = {}
    for c, s in zip(candidates, sims):
        if c.exercise_id not in best or s > best[c.exercise_id].similarity:
            best[c.exercise_id] = Match(c.key, c.exercise_id, round(float(s), 4))
    return sorted(best.values(), key=lambda x: -x.similarity)


# ---------- photos waiting for the user to confirm them ----------

def photos_dir() -> Path:
    return Path(get_settings().photos_dir)


def save_pending(user_id: int, image: bytes, ext: str, embedding: list[float] | None, model: str | None) -> str:
    """Keep the photo until the user says which machine it is. Returns its token."""
    folder = photos_dir() / "pending"
    folder.mkdir(parents=True, exist_ok=True)
    _clean_pending(folder)
    token = uuid.uuid4().hex
    (folder / f"{token}.{ext}").write_bytes(image)
    (folder / f"{token}.json").write_text(json.dumps({"user_id": user_id, "ext": ext, "embedding": embedding, "model": model}))
    return token


def take_pending(user_id: int, token: str) -> tuple[bytes, str, list[float] | None, str | None] | None:
    """The waiting photo for this token (only its owner's), removed from the waiting area."""
    if not token.isalnum():
        return None
    folder = photos_dir() / "pending"
    meta_file = folder / f"{token}.json"
    try:
        meta = json.loads(meta_file.read_text())
    except (OSError, ValueError):
        return None
    if meta.get("user_id") != user_id:
        return None
    image_file = folder / f"{token}.{meta['ext']}"
    try:
        image = image_file.read_bytes()
    except OSError:
        return None
    image_file.unlink(missing_ok=True)
    meta_file.unlink(missing_ok=True)
    return image, meta["ext"], meta.get("embedding"), meta.get("model")


def _clean_pending(folder: Path) -> None:
    cutoff = time.time() - PENDING_HOURS * 3600
    for f in folder.iterdir():
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


def store_photo(user_id: int, image: bytes, ext: str) -> str:
    """Save a confirmed photo; returns its file name (relative to photos_dir)."""
    folder = photos_dir() / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{user_id}/{uuid.uuid4().hex}.{ext}"
    (photos_dir() / name).write_bytes(image)
    return name


def delete_photo_file(name: str) -> None:
    (photos_dir() / name).unlink(missing_ok=True)


# ---------- the model download ----------

class Download:
    """Downloads the model once, in the background, so the first photo doesn't wait minutes."""

    def __init__(self):
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.done_bytes = 0
        self.error: str | None = None

    @property
    def running(self) -> bool:
        return self.thread is not None and self.thread.is_alive()

    def start(self, url: str, target: Path) -> None:
        with self.lock:
            if self.running or target.exists():
                return
            self.error = None
            self.done_bytes = 0
            self.thread = threading.Thread(target=self._run, args=(url, target), daemon=True)
            self.thread.start()

    def _run(self, url: str, target: Path) -> None:
        part = target.with_name(target.name + ".part")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            with httpx.stream("GET", url, timeout=60, follow_redirects=True) as r:
                r.raise_for_status()
                with part.open("wb") as f:
                    for chunk in r.iter_bytes(1 << 20):
                        f.write(chunk)
                        self.done_bytes += len(chunk)
            part.replace(target)
        except Exception as e:  # noqa: BLE001 - shown to the user as the reason
            part.unlink(missing_ok=True)
            self.error = f"Couldn't download the photo model ({e}). Check the internet connection and try again."


download = Download()


def model_path() -> Path:
    s = get_settings()
    return Path(s.models_dir) / s.photo_match_model_file


_embedder: ClipEmbedder | None = None


def get_embedder() -> ClipEmbedder:
    """The app's one image model (tests replace it with a fake)."""
    global _embedder
    if _embedder is None or _embedder.model_path != model_path():
        _embedder = ClipEmbedder(model_path())
    return _embedder


if __name__ == "__main__":  # uv run python -m app.services.photo_match  (download the model now)
    path = model_path()
    if path.exists():
        print(f"Already downloaded: {path}")
    else:
        print(f"Downloading the photo model ({MODEL_SIZE_MB:.0f} MB) to {path} ...")
        download.start(get_settings().photo_match_model_url, path)
        while download.running:
            time.sleep(1)
            print(f"\r{download.done_bytes / 1e6:.0f} MB", end="", flush=True)
        print()
        print(download.error or "Done.")
