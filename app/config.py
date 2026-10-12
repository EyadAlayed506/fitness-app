from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The .env next to pyproject.toml is used wherever the server is started from (a .env in the
# current folder, if there is a different one, wins).
PROJECT_ENV = Path(__file__).resolve().parent.parent / ".env"


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

    @field_validator("whoop_client_id", "whoop_client_secret", "whoop_redirect_uri", "anthropic_api_key")
    @classmethod
    def _strip(cls, v: str) -> str:
        # keys pasted with a stray space or quotes still work
        return v.strip().strip("\"'").strip()


@lru_cache
def get_settings() -> Settings:
    return Settings()
