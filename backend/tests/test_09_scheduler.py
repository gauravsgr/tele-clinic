"""
Step 9 tests: APScheduler job registration and cancellation.

Uses a mock in-memory scheduler to avoid SQLite job store complications in tests.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
import pytest_asyncio

_IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist():
    return datetime.now(_IST)


def _future_slot(hours: int = 4) -> str:
    dt = _now_ist() + timedelta(hours=hours)
    return dt.replace(minute=0, second=0, microsecond=0).isoformat()


def _make_mock_scheduler():
    scheduler = MagicMock()
    scheduler.add_job = MagicMock()
    scheduler.remove_job = MagicMock()
    return scheduler


@pytest.mark.asyncio
async def test_register_jobs_future_slot_adds_three_jobs(db):
    """A slot 4h from now → all 3 jobs should be added."""
    slot_time = _future_slot(hours=4)
    appt_id = str(uuid.uuid4())
    mock_sched = _make_mock_scheduler()

    with patch("services.scheduler._scheduler", mock_sched):
        from services.scheduler import register_appointment_jobs
        await register_appointment_jobs(appt_id, slot_time, "919876543210", "Alice")

    calls = [c.kwargs.get("id") or c.args[1] if c.args else None
             for c in mock_sched.add_job.call_args_list]
    # Check by keyword 'id' argument
    added_ids = {c.kwargs.get("id", "") for c in mock_sched.add_job.call_args_list}
    assert f"reminder_{appt_id}" in added_ids
    assert f"contact_add_{appt_id}" in added_ids
    assert f"wipe_{appt_id}" in added_ids


@pytest.mark.asyncio
async def test_register_jobs_skips_reminder_for_near_slot():
    """Slot 30min from now → reminder (which fires at -60min) should be skipped."""
    slot_time = (_now_ist() + timedelta(minutes=30)).isoformat()
    appt_id = str(uuid.uuid4())
    mock_sched = _make_mock_scheduler()

    with patch("services.scheduler._scheduler", mock_sched):
        from services.scheduler import register_appointment_jobs
        await register_appointment_jobs(appt_id, slot_time, "919876543210", "Bob")

    added_ids = {c.kwargs.get("id", "") for c in mock_sched.add_job.call_args_list}
    assert f"reminder_{appt_id}" not in added_ids  # -60min is in the past
    assert f"wipe_{appt_id}" in added_ids           # +30min is still future


@pytest.mark.asyncio
async def test_cancel_jobs_removes_all_three():
    appt_id = str(uuid.uuid4())
    mock_sched = _make_mock_scheduler()

    with patch("services.scheduler._scheduler", mock_sched):
        from services.scheduler import cancel_appointment_jobs
        await cancel_appointment_jobs(appt_id)

    removed = {c.args[0] for c in mock_sched.remove_job.call_args_list}
    assert f"reminder_{appt_id}" in removed
    assert f"contact_add_{appt_id}" in removed
    assert f"wipe_{appt_id}" in removed


@pytest.mark.asyncio
async def test_cancel_jobs_ignores_not_found():
    """remove_job raising an exception should not propagate."""
    appt_id = str(uuid.uuid4())
    mock_sched = _make_mock_scheduler()
    mock_sched.remove_job.side_effect = Exception("Job not found")

    with patch("services.scheduler._scheduler", mock_sched):
        from services.scheduler import cancel_appointment_jobs
        # Should not raise
        await cancel_appointment_jobs(appt_id)


@pytest.mark.asyncio
async def test_reload_pending_jobs_registers_future_appointments(db):
    """reload_pending_jobs should register jobs for booked future appointments."""
    appt_id = str(uuid.uuid4())
    slot_time = _future_slot(hours=4)
    now = _now_ist().isoformat()
    await db.execute(
        """INSERT INTO appointments
           (id, slot_time, patient_name, patient_phone, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        (appt_id, slot_time, "Charlie", "919876543210", "booked", now, now),
    )
    await db.commit()

    mock_sched = _make_mock_scheduler()
    with patch("services.scheduler._scheduler", mock_sched):
        from services.scheduler import reload_pending_jobs
        await reload_pending_jobs(db)

    added_ids = {c.kwargs.get("id", "") for c in mock_sched.add_job.call_args_list}
    # At minimum the wipe job should be added (reminder may be skipped if slot is <1h away)
    assert f"wipe_{appt_id}" in added_ids


@pytest.mark.asyncio
async def test_reload_skips_past_appointments(db):
    """Appointments whose wipe_dt has passed should not get jobs."""
    appt_id = str(uuid.uuid4())
    # Slot was 2 hours ago → wipe_dt (slot + 30min) is in the past
    slot_time = (_now_ist() - timedelta(hours=2)).isoformat()
    now = _now_ist().isoformat()
    await db.execute(
        """INSERT INTO appointments
           (id, slot_time, patient_name, patient_phone, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        (appt_id, slot_time, "Diana", "919876543210", "booked", now, now),
    )
    await db.commit()

    mock_sched = _make_mock_scheduler()
    with patch("services.scheduler._scheduler", mock_sched):
        from services.scheduler import reload_pending_jobs
        await reload_pending_jobs(db)

    added_ids = {c.kwargs.get("id", "") for c in mock_sched.add_job.call_args_list}
    assert f"wipe_{appt_id}" not in added_ids


@pytest.mark.asyncio
async def test_register_jobs_no_scheduler_does_not_raise():
    """When scheduler is None (not started), register should log and return silently."""
    with patch("services.scheduler._scheduler", None):
        from services.scheduler import register_appointment_jobs
        await register_appointment_jobs(str(uuid.uuid4()), _future_slot(), "919876543210", "Eve")
