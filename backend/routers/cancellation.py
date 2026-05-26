"""
routers/cancellation.py — Doctor-initiated mass cancellation.

POST /doctor/cancel-day    — cancel all booked slots on a date
POST /doctor/cancel-slots  — cancel specific slots by ID
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, Header, HTTPException

from config import get_settings
from database import get_db
from schemas import (
    CancelDayRequest, CancelDayResponse,
    CancelSlotsRequest, CancelSlotsResponse,
)
from services.otp_service import verify_session_token
from services import whatsapp_client, google_contacts, scheduler

router = APIRouter(tags=["cancellation"])
_IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist() -> datetime:
    return datetime.now(_IST)


async def _require_doctor(
    x_doctor_token: Optional[str] = Header(None, alias="X-Doctor-Token"),
) -> str:
    if not x_doctor_token:
        raise HTTPException(
            status_code=401,
            detail={"error": "auth_required", "message": "Missing X-Doctor-Token."},
        )
    try:
        phone = verify_session_token(x_doctor_token, "doctor")
    except ValueError as exc:
        code = str(exc)
        raise HTTPException(
            status_code=401 if code == "auth_required" else 403,
            detail={"error": code, "message": "Doctor session invalid."},
        )
    return phone


async def _cancel_appointment(appt_id: str, db: aiosqlite.Connection, settings) -> dict | None:
    """
    Cancel a single booked appointment. Returns appointment data before cancel,
    or None if not found / not booked.
    """
    async with db.execute(
        """SELECT id, slot_time, patient_name, patient_phone, status, google_contact_resource_name
           FROM appointments WHERE id=? AND status='booked'""",
        (appt_id,),
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        return None

    now = _now_ist().isoformat()
    await db.execute(
        """UPDATE appointments
           SET status='available', patient_name=NULL, patient_phone=NULL,
               reason=NULL, hold_expires_at=NULL, updated_at=?
           WHERE id=?""",
        (now, appt_id),
    )

    return dict(row)


async def _post_cancel_side_effects(appt_data: dict, settings, db: aiosqlite.Connection):
    """Fire-and-forget side effects after cancellation."""
    appt_id = appt_data["id"]
    patient_phone = appt_data["patient_phone"] or ""
    patient_name  = appt_data["patient_name"] or "Patient"
    slot_time     = appt_data["slot_time"]

    try:
        await scheduler.cancel_appointment_jobs(appt_id)
    except Exception:
        pass

    if appt_data.get("google_contact_resource_name"):
        try:
            await google_contacts.wipe_contact(appt_id, db)
        except Exception:
            pass

    try:
        slot_dt = datetime.fromisoformat(slot_time).replace(tzinfo=_IST)
        date_str = slot_dt.strftime("%A, %d %B %Y")
        time_str = slot_dt.strftime("%I:%M %p IST").lstrip("0")
        await whatsapp_client.send_cancellation(
            patient_phone, patient_name, settings.doctor_name, date_str, time_str
        )
    except Exception:
        pass


# ── POST /doctor/cancel-day ───────────────────────────────────────────────────

@router.post("/doctor/cancel-day", response_model=CancelDayResponse)
async def cancel_day(
    body: CancelDayRequest,
    _phone: str = Depends(_require_doctor),
    db: aiosqlite.Connection = Depends(get_db),
):
    settings = get_settings()

    from_iso = f"{body.date}T00:00:00+05:30"
    to_iso   = f"{body.date}T23:59:59+05:30"

    async with db.execute(
        """SELECT id FROM appointments
           WHERE slot_time >= ? AND slot_time <= ? AND status='booked'""",
        (from_iso, to_iso),
    ) as cur:
        rows = await cur.fetchall()

    if not rows:
        raise HTTPException(
            status_code=404,
            detail={"error": "no_bookings", "message": f"No booked appointments on {body.date}."},
        )

    ids = [r["id"] for r in rows]

    # Collect full data before cancellation
    appt_data_list = []
    for appt_id in ids:
        data = await _cancel_appointment(appt_id, db, settings)
        if data:
            appt_data_list.append(data)

    await db.commit()

    # Side effects
    for appt_data in appt_data_list:
        await _post_cancel_side_effects(appt_data, settings, db)

    return CancelDayResponse(
        cancelled_count=len(appt_data_list),
        date=body.date,
        patients_notified=len(appt_data_list),
    )


# ── POST /doctor/cancel-slots ─────────────────────────────────────────────────

@router.post("/doctor/cancel-slots", response_model=CancelSlotsResponse)
async def cancel_slots(
    body: CancelSlotsRequest,
    _phone: str = Depends(_require_doctor),
    db: aiosqlite.Connection = Depends(get_db),
):
    if not body.slot_ids:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation_error", "message": "slot_ids must not be empty."},
        )

    settings = get_settings()
    cancelled = []
    skipped = []
    appt_data_list = []

    for slot_id in body.slot_ids:
        data = await _cancel_appointment(slot_id, db, settings)
        if data:
            cancelled.append(slot_id)
            appt_data_list.append(data)
        else:
            skipped.append(slot_id)

    await db.commit()

    for appt_data in appt_data_list:
        await _post_cancel_side_effects(appt_data, settings, db)

    return CancelSlotsResponse(cancelled_count=len(cancelled), skipped=skipped)
