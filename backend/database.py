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


async def seed_slots(db: aiosqlite.Connection) -> None:
    """
    Idempotently generate appointment slot records for the next 28 days.

    Called on every server startup so the bookable window always extends 28 days
    ahead, regardless of when the server was last restarted.

    Slot ID = slot_time ISO string (e.g. '2026-05-28T10:00:00+05:30').
    Using the ISO string as the primary key means the frontend can send the same
    value it generates locally (generateMorningSlots / generateEveningSlots) and
    the backend will always find a matching row.

    INSERT OR IGNORE ensures existing slots (with their current status / patient
    data) are left untouched.

    Sessions (must mirror frontend src/utils/date.js):
      Morning  10:00–11:45 IST  (8 slots × 15 min)
      Evening  16:00–18:45 IST  (12 slots × 15 min)
    """
    from datetime import datetime, timedelta, timezone

    IST = timezone(timedelta(hours=5, minutes=30))
    today = datetime.now(IST).date()

    # Load weekly schedule: {day_of_week: is_open}  (0=Monday … 6=Sunday)
    async with db.execute("SELECT day_of_week, is_open FROM weekly_schedule") as cur:
        rows = await cur.fetchall()
    open_days = {r["day_of_week"]: bool(r["is_open"]) for r in rows}
    if not open_days:
        open_days = {i: (i < 5) for i in range(7)}  # fallback: Mon–Fri

    # Build the list of (hour, minute) pairs for each session.
    def _session_times(start_h: int, start_m: int, end_h: int, end_m: int):
        times, h, m = [], start_h, start_m
        while (h, m) <= (end_h, end_m):
            times.append((h, m))
            m += 15
            if m >= 60:
                m -= 60
                h += 1
        return times

    all_times = _session_times(10, 0, 11, 45) + _session_times(16, 0, 18, 45)

    now_ist = datetime.now(IST).isoformat()
    for day_offset in range(29):           # today … today+28 (inclusive)
        d = today + timedelta(days=day_offset)
        if not open_days.get(d.weekday(), False):
            continue
        for h, m in all_times:
            slot_time = f"{d.isoformat()}T{h:02d}:{m:02d}:00+05:30"
            await db.execute(
                """INSERT OR IGNORE INTO appointments
                   (id, slot_time, status, created_at, updated_at)
                   VALUES (?, ?, 'available', ?, ?)""",
                (slot_time, slot_time, now_ist, now_ist),
            )

    await db.commit()
    print("[seed_slots] Slot window refreshed for the next 28 days.", flush=True)


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
