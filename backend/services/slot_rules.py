"""
slot_rules.py — booking rule validation (pure functions, IST-aware).

Rules enforced:
1. Booking window: slot must be within 28 days of today (IST).
2. Cut-off: slot must not start within 60 min of now (IST).
3. One appointment per phone per IST calendar date.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone, date
from typing import Optional

import aiosqlite

_IST = timezone(timedelta(hours=5, minutes=30))
_BOOKING_WINDOW_DAYS = 28
_CUTOFF_MINUTES = 60


def _now_ist() -> datetime:
    return datetime.now(_IST)


def _parse_ist(dt_str: str) -> datetime:
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_IST)
    return dt


def check_booking_window(slot_time: str) -> None:
    """Raise ValueError('outside_window') if slot is more than 28 days from today IST."""
    now = _now_ist()
    slot = _parse_ist(slot_time)
    max_dt = now + timedelta(days=_BOOKING_WINDOW_DAYS)
    if slot > max_dt:
        raise ValueError("outside_window")
    if slot < now:
        # Slot is in the past — also invalid
        raise ValueError("cutoff_passed")


def check_cutoff(slot_time: str) -> None:
    """Raise ValueError('cutoff_passed') if slot starts within 60 min of now (IST)."""
    now = _now_ist()
    slot = _parse_ist(slot_time)
    if (slot - now).total_seconds() < _CUTOFF_MINUTES * 60:
        raise ValueError("cutoff_passed")


async def check_duplicate_date(
    phone: str, slot_time: str, db: aiosqlite.Connection, exclude_id: Optional[str] = None
) -> Optional[dict]:
    """
    Return existing booked appointment if same phone already has one on
    the same IST calendar date. Returns None if no duplicate.
    exclude_id: appointment id to exclude from check (for cancel-and-rebook).
    """
    slot_ist = _parse_ist(slot_time)
    target_date = slot_ist.date()

    query = """
        SELECT id, slot_time, patient_name, patient_phone, reason, status
        FROM appointments
        WHERE patient_phone = ?
          AND status = 'booked'
    """
    params: list = [phone]
    if exclude_id:
        query += " AND id != ?"
        params.append(exclude_id)

    async with db.execute(query, params) as cur:
        rows = await cur.fetchall()

    for row in rows:
        existing_dt = _parse_ist(row["slot_time"])
        if existing_dt.date() == target_date:
            return dict(row)

    return None
