from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The .env next to pyproject.toml is used wherever the server is started from (a .env in the
# current folder, if there is a different one, wins).
PROJECT_DIR = Path(__file__).resolve().parent.parent
PROJECT_ENV = PROJECT_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(PROJECT_ENV, ".env"), extra="ignore")

    database_url: str = "sqlite:///./fitness.db"
    jwt_secret: str = "dev-only-secret-change-me-in-the-env-file"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 30
    usda_api_key: str = "DEMO_KEY"
    off_user_agent: str = "FitnessApp/0.1 (contact@example.com)"
    external_timeout_seconds: float = 8.0
    # Origins allowed to call the API from a browser (the Expo web app runs on another port).
    # Login uses a bearer token, not cookies, so "*" is safe for development.
    cors_origins: list[str] = ["*"]
    # WHOOP (optional): create an app at https://developer.whoop.com and copy its keys here.
    # The redirect URL registered there must be exactly whoop_redirect_uri.
    whoop_client_id: str = ""
    whoop_client_secret: str = ""
    whoop_redirect_uri: str = "http://localhost:8000/api/whoop/callback"
    whoop_base_url: str = "https://api.prod.whoop.com"  # only changed for testing against a fake WHOOP
    # Coach assistant. "auto": Claude when anthropic_api_key is set, otherwise Ollama on this PC.
    assistant_provider: Literal["auto", "claude", "ollama"] = "auto"
    # Claude (paid): an API key from https://console.anthropic.com
    anthropic_api_key: str = ""
    assistant_model: str = "claude-opus-5-5"
    assistant_daily_limit: int = 50  # Claude questions per user per 24 hours, to keep the bill predictable
    # Ollama (free, runs on this PC): https://ollama.com, then `ollama pull <model>`
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:8b"
    ollama_num_ctx: int = 16384  # context size; more fits more data but needs more GPU memory
    ollama_vision_model: str = "qwen3-vl:8b"  # reads gym photos, screenshots, weights and menus
    # Workouts > Photo: the MobileNet trained in ml/machine_classifier (a folder with gym_machines.onnx and
    # labels.txt; relative paths are from the project folder)
    machine_model_dir: str = "ml/machine_classifier/model/machines13_team"
    # Voice messages: speech to text on this PC with Whisper (downloads once, about 500 MB for "small")
    whisper_model: str = "small"  # tiny, base, small, medium, large-v3 (bigger = better and slower)
    whisper_device: str = "cpu"  # "cuda" for an NVIDIA GPU (needs the CUDA libraries)
    whisper_compute_type: str = "int8"  # "float16" on cuda
    whisper_language: str = ""  # e.g. "en" or "ar"; empty = detect automatically
    # Photo matching ("the app learns your machines"): a small image model on the CPU compares a new
    # photo with the user's earlier confirmed photos before asking the vision model.
    # CLIP ViT-B/32 image encoder (OpenAI, MIT licence) as ONNX: 351 MB, downloaded once into models_dir.
    photo_match_model_url: str = (
        "https://clip-as-service.s3.us-east-2.amazonaws.com/models-436c69702d61732d53657276696365/onnx/ViT-B-32/visual.onnx"
    )
    photo_match_model_file: str = "clip-vit-b32-visual.onnx"
    photo_match_threshold: float = 0.90  # cosine similarity a saved photo must reach to count as the same machine
    models_dir: str = "models"  # downloaded models (next to the database)
    photos_dir: str = "data/photos"  # confirmed machine photos; they never leave this server

    @field_validator("whoop_client_id", "whoop_client_secret", "whoop_redirect_uri", "anthropic_api_key")
    @classmethod
    def _strip(cls, v: str) -> str:
        # keys pasted with a stray space or quotes still work
        return v.strip().strip("\"'").strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
