"""
hold_service.py — 2-minute slot hold logic.

All writes use SQLite IMMEDIATE transactions to prevent race conditions.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import aiosqlite

from services.slot_rules import check_booking_window, check_cutoff, check_duplicate_date

_IST = timezone(timedelta(hours=5, minutes=30))
_HOLD_MINUTES = 2


def _now_ist() -> datetime:
    return datetime.now(_IST)


async def place_hold(
    slot_id: str, phone: str, db: aiosqlite.Connection
) -> dict:
    """
    Place a 2-minute hold on a slot.

    Returns {"hold_id": ..., "hold_expires_at": ...}
    Raises ValueError with machine code on any rule violation.
    """
    # First fetch the slot outside the transaction for rule checks
    async with db.execute(
        "SELECT id, slot_time, status FROM appointments WHERE id=?", (slot_id,)
    ) as cur:
        slot = await cur.fetchone()

    if slot is None:
        raise ValueError("not_found")

    if slot["status"] not in ("available",):
        # Also accept held-but-expired slots (expire_holds runs before /slots)
        # For safety, re-check expiry
        if slot["status"] == "held":
            hold_exp = slot["hold_expires_at"] if "hold_expires_at" in slot.keys() else None
            if hold_exp:
                exp_dt = datetime.fromisoformat(hold_exp)
                if exp_dt.tzinfo is None:
                    exp_dt = exp_dt.replace(tzinfo=_IST)
                if _now_ist() < exp_dt:
                    raise ValueError("slot_unavailable")
                # Expired hold — can proceed
            else:
                raise ValueError("slot_unavailable")
        else:
            raise ValueError("slot_unavailable")

    # Business rule checks
    check_booking_window(slot["slot_time"])
    check_cutoff(slot["slot_time"])

    # Duplicate-date check
    duplicate = await check_duplicate_date(phone, slot["slot_time"], db)
    if duplicate:
        raise ValueError(f"duplicate_date:{duplicate['id']}")

    # SQLite IMMEDIATE transaction for the actual update
    now = _now_ist()
    hold_expires_at = now + timedelta(minutes=_HOLD_MINUTES)

    import sqlite3 as _sqlite3
    try:
        await db.execute("BEGIN IMMEDIATE")
    except (_sqlite3.OperationalError, Exception) as lock_exc:
        if "locked" in str(lock_exc).lower() or "cannot start" in str(lock_exc).lower():
            raise ValueError("slot_unavailable")
        raise
    try:
        # Re-check status inside transaction
        async with db.execute(
            "SELECT status, hold_expires_at FROM appointments WHERE id=?", (slot_id,)
        ) as cur:
            row = await cur.fetchone()

        still_ok = row["status"] == "available" or (
            row["status"] == "held"
            and row["hold_expires_at"] is not None
            and datetime.fromisoformat(row["hold_expires_at"]).replace(tzinfo=_IST) <= now
        )
        if not still_ok:
            await db.execute("ROLLBACK")
            raise ValueError("slot_unavailable")

        await db.execute(
            """UPDATE appointments
               SET status='held', hold_expires_at=?, updated_at=?
               WHERE id=?""",
            (hold_expires_at.isoformat(), now.isoformat(), slot_id),
        )
        await db.execute("COMMIT")
    except ValueError:
        try:
            await db.execute("ROLLBACK")
        except Exception:
            pass
        raise

    return {"hold_id": slot_id, "hold_expires_at": hold_expires_at.isoformat()}


async def release_hold(slot_id: str, db: aiosqlite.Connection) -> None:
    """Release a held slot back to available."""
    now = _now_ist()
    await db.execute(
        """UPDATE appointments
           SET status='available', hold_expires_at=NULL, updated_at=?
           WHERE id=? AND status='held'""",
        (now.isoformat(), slot_id),
    )
    await db.commit()


async def expire_holds(db: aiosqlite.Connection) -> int:
    """
    Expire all held slots whose hold_expires_at is in the past.
    Returns the number of slots released.
    """
    now = _now_ist().isoformat()
    async with db.execute(
        """UPDATE appointments
           SET status='available', hold_expires_at=NULL, updated_at=?
           WHERE status='held' AND hold_expires_at < ?
           RETURNING id""",
        (now, now),
    ) as cur:
        rows = await cur.fetchall()
    await db.commit()
    return len(rows)


async def check_hold_valid(slot_id: str, db: aiosqlite.Connection) -> bool:
    """Return True if the slot is held and the hold has not expired."""
    now = _now_ist()
    async with db.execute(
        "SELECT status, hold_expires_at FROM appointments WHERE id=?", (slot_id,)
    ) as cur:
        row = await cur.fetchone()

    if row is None or row["status"] != "held":
        return False
    if row["hold_expires_at"] is None:
        return False
    exp = datetime.fromisoformat(row["hold_expires_at"])
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=_IST)
    return now < exp
