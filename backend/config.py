"""
config.py — application settings loaded from .env via pydantic-settings.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Doctor identity
    doctor_phone: str = "919876543210"
    doctor_name: str = "Dr. Priya Sharma"

    # WhatsApp worker
    whatsapp_worker_url: str = "http://localhost:3001"
    whatsapp_mode: str = "mock"  # "mock" | "real"

    # Google People API
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:8000/oauth2callback"
    google_refresh_token: str = ""

    # OTP
    otp_ttl_seconds: int = 300
    otp_resend_cooldown_seconds: int = 59

    # Session
    session_inactivity_minutes: int = 10
    session_secret_key: str = "dev-secret-key-change-in-production-32chars-min"

    # Emergency PIN
    doctor_emergency_pin_hash: str = ""

    # Database
    database_path: str = "data/clinic.db"

    # CORS
    cors_origins: str = "http://localhost:5173"


@lru_cache
def get_settings() -> Settings:
    return Settings()
