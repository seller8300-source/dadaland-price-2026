"""Application settings (Pydantic Settings, .env driven).

API secrets are never hardcoded — every credential is read from the
environment. See ``.env.example`` at the repository root of this project.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "DADA NAVER ADS AI CONTROL CENTER"
    environment: str = "local"
    api_prefix: str = "/api/v1"

    # PostgreSQL in every real environment; SQLite is only used by the test suite.
    database_url: str = "postgresql+psycopg://dada:dada@localhost:5432/dada_ads"
    sql_echo: bool = False

    # NAVER Search Ad API — READ ONLY (see services/naver/client.py)
    naver_api_base_url: str = "https://api.searchad.naver.com"
    naver_api_key: str = ""
    naver_secret_key: str = ""
    naver_customer_ids: str = ""  # "1234567:다다그룹,2345678:타임렌탈"
    naver_read_only: bool = True

    # Reporting policy
    ceo_report_min_confidence: int = 70
    default_contribution_margin_rate: float = 0.30

    # Scheduler
    enable_scheduler: bool = False
    daily_report_cron_hour: int = 7
    naver_sync_cron_hour: int = 5

    @property
    def naver_customers(self) -> dict[str, str]:
        """Parse ``naver_customer_ids`` into ``{customer_id: account_name}``."""
        out: dict[str, str] = {}
        for chunk in self.naver_customer_ids.split(","):
            chunk = chunk.strip()
            if not chunk or ":" not in chunk:
                continue
            customer_id, name = chunk.split(":", 1)
            out[customer_id.strip()] = name.strip()
        return out


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
