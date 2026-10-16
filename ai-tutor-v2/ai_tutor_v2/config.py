"""Runtime settings for AI Tutor v2. Secret values are never logged."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SERVICE_ROOT.parent


def _load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        if key and key not in os.environ:
            os.environ[key] = value


def load_env_files() -> None:
    """Fill missing variables from this service's .env, then the repo-root .env."""

    _load_env_file(SERVICE_ROOT / ".env")
    _load_env_file(REPO_ROOT / ".env")
    _load_env_file(REPO_ROOT / ".env.local")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AI_TUTOR_V2_", extra="ignore")

    database_url: str = "postgresql+asyncpg://ai_tutor_v2:ai_tutor_v2@127.0.0.1:5435/ai_tutor_v2"
    cors_origins: str = "http://localhost:3000"
    planner: str = "fake"
    model_timeout_s: float = 25
    model_max_tokens: int = 1200
    lesson_token_budget: int = 6000
    max_beats: int = 6
    tool_timeout_s: float = 2
    rate_limit_per_minute: int = 20
    max_body_bytes: int = 32_768
    max_question_chars: int = 4_000
    heartbeat_interval_s: float = 15
    database_connect_timeout_s: float = 5

    llm_provider: str = Field(default="groq", validation_alias=AliasChoices("LLM_PROVIDER"))
    groq_api_key: str = Field(default="", validation_alias=AliasChoices("GROQ_API_KEY"))
    groq_model: str = Field(
        default="openai/gpt-oss-20b",
        validation_alias=AliasChoices("GROQ_MODEL"),
    )
    openai_api_key: str = Field(default="", validation_alias=AliasChoices("OPENAI_API_KEY"))
    openai_model: str = Field(default="gpt-4.1", validation_alias=AliasChoices("OPENAI_MODEL"))

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def planner_name(self) -> str:
        name = (self.planner or "fake").strip().lower()
        if name not in {"fake", "model"}:
            return "fake"
        return name

    @property
    def migration_url(self) -> str:
        return self.database_url.replace("postgresql+asyncpg", "postgresql+psycopg", 1)


def load_settings() -> Settings:
    load_env_files()
    return Settings()


@lru_cache
def get_settings() -> Settings:
    return load_settings()
