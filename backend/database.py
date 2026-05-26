"""
database.py — aiosqlite connection pool + schema initialisation.

Usage
-----
FastAPI dependency:

    async def endpoint(db: aiosqlite.Connection = Depends(get_db)):
        ...

Lifespan:

    async with lifespan():
        await init_db()
"""

from __future__ import annotations

import os
from pathlib import Path

import aiosqlite
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

_DB_PATH = Path(__file__).parent / os.getenv("DATABASE_PATH", "data/clinic.db")
_MIGRATION_SQL = Path(__file__).parent / "migrations" / "001_initial_schema.sql"

_db: aiosqlite.Connection | None = None


async def init_db() -> None:
    """Open the shared connection and run the migration SQL idempotently."""
    global _db
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _db = await aiosqlite.connect(str(_DB_PATH))
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA foreign_keys=ON")
    sql = _MIGRATION_SQL.read_text()
    await _db.executescript(sql)
    await _db.commit()

    # Seed weekly_schedule with Mon–Fri open if table is empty
    async with _db.execute("SELECT COUNT(*) FROM weekly_schedule") as cur:
        row = await cur.fetchone()
        if row[0] == 0:
            from datetime import date, timedelta
            effective = (date.today() + timedelta(days=28)).isoformat()
            for dow in range(7):
                is_open = 1 if dow < 5 else 0  # Mon=0..Fri=4 open; Sat=5, Sun=6 closed
                await _db.execute(
                    "INSERT INTO weekly_schedule (day_of_week, is_open, effective_from) VALUES (?,?,?)",
                    (dow, is_open, effective),
                )
            await _db.commit()


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


async def get_db() -> aiosqlite.Connection:  # type: ignore[return]
    """FastAPI dependency — yields the shared connection."""
    if _db is None:
        raise RuntimeError("Database not initialised. Call init_db() in lifespan.")
    return _db


def get_db_sync() -> aiosqlite.Connection:
    """Non-async accessor for scheduler jobs (called from sync context)."""
    if _db is None:
        raise RuntimeError("Database not initialised.")
    return _db
