"""
scheduler.py — APScheduler jobs for every booked appointment.

Three DateTrigger jobs per appointment:
  1. reminder_{id}     → slot_time - 60 min  → WhatsApp reminder
  2. contact_add_{id}  → slot_time -  5 min  → Google Contacts add
  3. wipe_{id}         → slot_time + 30 min  → Google Contacts wipe + status='done'

All times are IST-aware.
Job persistence: SQLAlchemyJobStore with the same SQLite DB file so jobs survive restarts.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import aiosqlite

logger = logging.getLogger(__name__)
_IST = timezone(timedelta(hours=5, minutes=30))

_scheduler = None
_APSCHEDULER_TABLE = "apscheduler_jobs"


def _now_ist() -> datetime:
    return datetime.now(_IST)


def _parse_ist(dt_str: str) -> datetime:
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_IST)
    return dt


# ── Job functions (sync wrappers that schedule coroutines) ───────────────────

def _run_async(coro):
    """Run a coroutine from a sync APScheduler job callback."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(coro)
        else:
            loop.run_until_complete(coro)
    except RuntimeError:
        asyncio.run(coro)


def _job_reminder(appointment_id: str, phone: str, patient_name: str, slot_time: str):
    """APScheduler job: send 1-hour WhatsApp reminder."""
    from services import whatsapp_client
    from config import get_settings

    settings = get_settings()
    slot_dt = _parse_ist(slot_time)
    time_str = slot_dt.strftime("%I:%M %p IST").lstrip("0")

    async def _send():
        await whatsapp_client.send_reminder(phone, patient_name, settings.doctor_name, time_str)

    _run_async(_send())


def _job_contact_add(appointment_id: str, phone: str, patient_name: str):
    """APScheduler job: add to Google Contacts 5 min before slot."""
    from services import google_contacts
    import database as _db

    async def _add():
        try:
            db = _db.get_db_sync()
            await google_contacts.add_contact(patient_name, phone, appointment_id, db)
        except Exception as exc:
            logger.error("contact_add job failed for %s: %s", appointment_id, exc)

    _run_async(_add())


def _job_wipe_and_done(appointment_id: str):
    """APScheduler job: wipe Google Contacts + mark status='done'."""
    from services import google_contacts
    import database as _db

    async def _wipe():
        try:
            db = _db.get_db_sync()
            # Only act if appointment is still booked (not cancelled)
            async with db.execute(
                "SELECT status FROM appointments WHERE id=?", (appointment_id,)
            ) as cur:
                row = await cur.fetchone()
            if row is None or row["status"] != "booked":
                logger.info("wipe_done: %s is no longer booked, skipping", appointment_id)
                return
            await google_contacts.wipe_contact(appointment_id, db)
            now = _now_ist().isoformat()
            await db.execute(
                "UPDATE appointments SET status='done', updated_at=? WHERE id=?",
                (now, appointment_id),
            )
            await db.commit()
            logger.info("wipe_done: appointment %s marked done", appointment_id)
        except Exception as exc:
            logger.error("wipe_done job failed for %s: %s", appointment_id, exc)

    _run_async(_wipe())


# ── Scheduler lifecycle ───────────────────────────────────────────────────────

def _get_db_url() -> str:
    import os
    db_path = os.getenv("DATABASE_PATH", "data/clinic.db")
    # Make absolute if relative
    if not db_path.startswith("/") and db_path != ":memory:":
        base = Path(__file__).parent.parent
        db_path = str(base / db_path)
    if db_path == ":memory:":
        return "sqlite:///:memory:"
    return f"sqlite:///{db_path}"


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return

    from apscheduler.schedulers.asyncio import AsyncIOScheduler

    # Try persistent SQLite store first; fall back to in-memory on Python 3.13+
    # where SQLAlchemyJobStore's pickle-based serialisation hits __firstlineno__.
    try:
        from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
        db_url = _get_db_url()
        jobstores = {"default": SQLAlchemyJobStore(url=db_url)}
        _scheduler = AsyncIOScheduler(jobstores=jobstores, timezone=_IST)
        _scheduler.start()
        logger.info("APScheduler started with SQLite job store at %s", db_url)
        return
    except Exception as exc:
        logger.warning(
            "SQLite job store failed (%s); falling back to MemoryJobStore "
            "(jobs will not survive a server restart)", exc
        )

    try:
        from apscheduler.jobstores.memory import MemoryJobStore
        _scheduler = AsyncIOScheduler(
            jobstores={"default": MemoryJobStore()},
            timezone=_IST,
        )
        _scheduler.start()
        logger.info("APScheduler started with in-memory job store")
    except Exception as exc:
        logger.error("Failed to start scheduler: %s", exc)
        _scheduler = None


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None


# ── Job management ────────────────────────────────────────────────────────────

async def register_appointment_jobs(
    appointment_id: str,
    slot_time: str,
    phone: str,
    patient_name: str,
) -> None:
    """Register reminder, contact-add, and wipe+done jobs for a booking."""
    if _scheduler is None:
        logger.warning("Scheduler not started; jobs not registered for %s", appointment_id)
        return

    slot_dt = _parse_ist(slot_time)
    now = _now_ist()

    reminder_dt   = slot_dt - timedelta(minutes=60)
    contact_dt    = slot_dt - timedelta(minutes=5)
    wipe_dt       = slot_dt + timedelta(minutes=30)

    # Reminder job
    if reminder_dt > now:
        _scheduler.add_job(
            _job_reminder,
            trigger="date",
            run_date=reminder_dt,
            id=f"reminder_{appointment_id}",
            replace_existing=True,
            args=[appointment_id, phone, patient_name, slot_time],
        )
        logger.info("Registered reminder job for %s at %s", appointment_id, reminder_dt)
    else:
        logger.info("Skipping reminder job for %s (trigger time in the past)", appointment_id)

    # Contact-add job
    if contact_dt > now:
        _scheduler.add_job(
            _job_contact_add,
            trigger="date",
            run_date=contact_dt,
            id=f"contact_add_{appointment_id}",
            replace_existing=True,
            args=[appointment_id, phone, patient_name],
        )
        logger.info("Registered contact_add job for %s at %s", appointment_id, contact_dt)
    else:
        logger.info("Skipping contact_add job for %s (trigger time in the past)", appointment_id)

    # Wipe+done job — always register if in the future
    if wipe_dt > now:
        _scheduler.add_job(
            _job_wipe_and_done,
            trigger="date",
            run_date=wipe_dt,
            id=f"wipe_{appointment_id}",
            replace_existing=True,
            args=[appointment_id],
        )
        logger.info("Registered wipe job for %s at %s", appointment_id, wipe_dt)
    else:
        logger.info("Skipping wipe job for %s (trigger time in the past)", appointment_id)


async def cancel_appointment_jobs(appointment_id: str) -> None:
    """Remove all scheduler jobs for an appointment (ignore if not found)."""
    if _scheduler is None:
        return

    for prefix in ("reminder", "contact_add", "wipe"):
        job_id = f"{prefix}_{appointment_id}"
        try:
            _scheduler.remove_job(job_id)
            logger.info("Removed job %s", job_id)
        except Exception:
            pass  # Job not found — OK


async def reload_pending_jobs(db: Optional[aiosqlite.Connection] = None) -> None:
    """
    On server restart: re-register jobs for all booked appointments
    whose trigger times are still in the future.
    Called from main.py lifespan.
    """
    if _scheduler is None:
        logger.warning("Scheduler not started; skipping job reload")
        return

    if db is None:
        import database as _db_module
        try:
            db = _db_module.get_db_sync()
        except RuntimeError:
            logger.warning("DB not available for job reload; skipping")
            return

    async with db.execute(
        """SELECT id, slot_time, patient_phone, patient_name
           FROM appointments
           WHERE status='booked'"""
    ) as cur:
        rows = await cur.fetchall()

    count = 0
    now = _now_ist()
    for row in rows:
        slot_dt = _parse_ist(row["slot_time"])
        wipe_dt = slot_dt + timedelta(minutes=30)
        if wipe_dt > now:
            await register_appointment_jobs(
                row["id"], row["slot_time"],
                row["patient_phone"] or "", row["patient_name"] or "",
            )
            count += 1

    logger.info("Reloaded jobs for %d pending appointments", count)
