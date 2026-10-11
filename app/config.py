from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./fitness.db"
    jwt_secret: str = "dev-only-secret-change-me-in-the-env-file"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 30
    usda_api_key: str = "DEMO_KEY"
    off_user_agent: str = "FitnessApp/0.1 (contact@example.com)"
    external_timeout_seconds: float = 8.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
