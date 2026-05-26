"""
Shared pytest fixtures for TeleClinic backend tests.

All tests use a fresh in-memory SQLite database so they don't touch the
real data/clinic.db file.
"""

from __future__ import annotations

import os
import sys
import asyncio
from pathlib import Path

import pytest
import pytest_asyncio

# Ensure the backend package root is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Point tests at a dedicated test DB (in-memory via :memory: flag)
os.environ.setdefault("DATABASE_PATH", ":memory:")
os.environ.setdefault("WHATSAPP_MODE", "mock")
os.environ.setdefault("DOCTOR_PHONE", "919876543210")
os.environ.setdefault("DOCTOR_NAME", "Dr. Test")
os.environ.setdefault("WHATSAPP_WORKER_URL", "http://localhost:3001")
os.environ.setdefault("OTP_TTL_SECONDS", "300")
os.environ.setdefault("OTP_RESEND_COOLDOWN_SECONDS", "59")
os.environ.setdefault("SESSION_INACTIVITY_MINUTES", "10")
os.environ.setdefault("DOCTOR_EMERGENCY_PIN_HASH",
    "$2b$12$eImiTXuWVxfM37uY3Nv.deLXvzQFIfqYmQFqmXkPRFTqkVlJpKqHe")
os.environ.setdefault("SESSION_SECRET_KEY", "test-secret-key-32chars-padding-ok")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:5173")
os.environ.setdefault("GOOGLE_CLIENT_ID", "placeholder.apps.googleusercontent.com")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "placeholder-secret")
os.environ.setdefault("GOOGLE_REDIRECT_URI", "http://localhost:8000/oauth2callback")
os.environ.setdefault("GOOGLE_REFRESH_TOKEN", "")


@pytest_asyncio.fixture
async def db():
    """Fresh in-memory aiosqlite connection with schema applied."""
    import aiosqlite
    from pathlib import Path as _Path

    migration_sql = (_Path(__file__).parent.parent / "migrations" / "001_initial_schema.sql").read_text()

    conn = await aiosqlite.connect(":memory:")
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA foreign_keys=ON")
    await conn.executescript(migration_sql)
    await conn.commit()

    # Seed weekly_schedule
    from datetime import date, timedelta
    effective = (date.today() + timedelta(days=28)).isoformat()
    for dow in range(7):
        is_open = 1 if dow < 5 else 0
        await conn.execute(
            "INSERT INTO weekly_schedule (day_of_week, is_open, effective_from) VALUES (?,?,?)",
            (dow, is_open, effective),
        )
    await conn.commit()

    yield conn
    await conn.close()
