"""
routers/appointments.py — Patient-facing appointment endpoints.

GET  /slots                          — list slots in a date range
POST /hold                           — place 2-min hold
POST /book                           — confirm booking after OTP
DELETE /appointments/{id}            — patient cancel
GET  /appointments/lookup            — look up by phone (requires X-Session-Token)
POST /appointments/cancel-and-rebook — atomic cancel + hold (US-06)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone, date

import aiosqlite
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from typing import Optional

from config import get_settings
from database import get_db
from schemas import (
    SlotOut, HoldRequest, HoldResponse,
    BookRequest, BookResponse, AppointmentOut,
    CancelResponse, LookupResponse,
    CancelRebookRequest, CancelRebookResponse,
)
from services import hold_service, slot_rules, otp_service, whatsapp_client, scheduler, google_contacts

router = APIRouter(tags=["appointments"])

_IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist() -> datetime:
    return datetime.now(_IST)


def _parse_ist(dt_str: str) -> datetime:
    dt = datetime.fromisoformat(dt_str)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_IST)
    return dt


async def _require_session(
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
) -> str:
    """FastAPI dependency: validate patient session token, return phone."""
    if not x_session_token:
        raise HTTPException(
            status_code=401,
            detail={"error": "auth_required", "message": "Missing X-Session-Token header."},
        )
    try:
        phone = otp_service.verify_session_token(x_session_token, "patient")
    except ValueError as exc:
        code = str(exc)
        status = 401 if code == "auth_required" else 403
        raise HTTPException(
            status_code=status,
            detail={"error": code, "message": "Session token invalid or expired."},
        )
    return phone


def _row_to_slot(row) -> SlotOut:
    return SlotOut(
        id=row["id"],
        slot_time=row["slot_time"],
        status=row["status"],
        hold_expires_at=row["hold_expires_at"] if row["hold_expires_at"] else None,
    )


def _row_to_appt(row) -> AppointmentOut:
    return AppointmentOut(
        id=row["id"],
        slot_time=row["slot_time"],
        patient_name=row["patient_name"] or "",
        patient_phone=row["patient_phone"] or "",
        reason=row["reason"],
        status=row["status"],
    )


# ── GET /slots ────────────────────────────────────────────────────────────────

@router.get("/slots", response_model=list[SlotOut])
async def get_slots(
    from_: str = Query(alias="from"),
    to: str = Query(),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Validate date format and window
    try:
        from_date = date.fromisoformat(from_)
        to_date = date.fromisoformat(to)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation_error", "message": "Dates must be YYYY-MM-DD."},
        )

    today = _now_ist().date()
    max_date = today + timedelta(days=28)

    if to_date > max_date:
        raise HTTPException(
            status_code=422,
            detail={"error": "window_exceeded",
                    "message": f"Cannot query beyond {max_date.isoformat()}."},
        )

    # Expire stale holds before returning
    await hold_service.expire_holds(db)

    # Query slots in range (inclusive)
    from_iso = f"{from_date.isoformat()}T00:00:00+05:30"
    to_iso   = f"{to_date.isoformat()}T23:59:59+05:30"

    async with db.execute(
        """SELECT id, slot_time, status, hold_expires_at
           FROM appointments
           WHERE slot_time >= ? AND slot_time <= ?
           ORDER BY slot_time""",
        (from_iso, to_iso),
    ) as cur:
        rows = await cur.fetchall()

    return [_row_to_slot(r) for r in rows]


# ── POST /hold ────────────────────────────────────────────────────────────────

@router.post("/hold", response_model=HoldResponse)
async def post_hold(body: HoldRequest, db: aiosqlite.Connection = Depends(get_db)):
    try:
        result = await hold_service.place_hold(body.slot_id, body.phone, db)
    except ValueError as exc:
        code = str(exc)

        # duplicate_date carries the existing appointment id after ":"
        if code.startswith("duplicate_date:"):
            existing_id = code.split(":", 1)[1]
            async with db.execute(
                "SELECT id, slot_time, patient_name, patient_phone, reason, status FROM appointments WHERE id=?",
                (existing_id,),
            ) as cur:
                existing_row = await cur.fetchone()
            existing = _row_to_appt(existing_row).model_dump() if existing_row else None
            raise HTTPException(
                status_code=409,
                detail={"error": "duplicate_date", "message": "One appointment per day.", "existing": existing},
            )

        status_map = {
            "not_found": 404,
            "slot_unavailable": 409,
            "cutoff_passed": 409,
            "outside_window": 409,
        }
        raise HTTPException(
            status_code=status_map.get(code, 409),
            detail={"error": code, "message": f"Cannot place hold: {code}"},
        )

    return HoldResponse(**result)


# ── POST /book ────────────────────────────────────────────────────────────────

@router.post("/book", response_model=BookResponse)
async def post_book(body: BookRequest, db: aiosqlite.Connection = Depends(get_db)):
    # Verify hold is still valid
    if not await hold_service.check_hold_valid(body.slot_id, db):
        raise HTTPException(
            status_code=400,
            detail={"error": "hold_expired", "message": "Your reservation window has closed. Please select a new slot."},
        )

    # Verify OTP
    try:
        await otp_service.verify_otp(body.phone, body.otp_token, "booking", db)
    except ValueError as exc:
        code = str(exc)
        raise HTTPException(
            status_code=400,
            detail={"error": code, "message": f"OTP error: {code}"},
        )

    # Confirm booking in IMMEDIATE transaction
    now = _now_ist()
    appointment_id = body.slot_id  # slot id IS the appointment id

    await db.execute("BEGIN IMMEDIATE")
    try:
        # Re-verify hold inside transaction
        async with db.execute(
            "SELECT status, hold_expires_at, slot_time FROM appointments WHERE id=?",
            (appointment_id,),
        ) as cur:
            row = await cur.fetchone()

        if row is None:
            await db.execute("ROLLBACK")
            raise HTTPException(status_code=404, detail={"error": "not_found"})

        if row["status"] != "held":
            await db.execute("ROLLBACK")
            raise HTTPException(
                status_code=409,
                detail={"error": "slot_unavailable", "message": "Slot is no longer available."},
            )

        exp = datetime.fromisoformat(row["hold_expires_at"])
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=_IST)
        if now > exp:
            await db.execute("ROLLBACK")
            raise HTTPException(
                status_code=400,
                detail={"error": "hold_expired", "message": "Hold expired."},
            )

        slot_time = row["slot_time"]

        await db.execute(
            """UPDATE appointments
               SET status='booked', patient_name=?, patient_phone=?, reason=?,
                   hold_expires_at=NULL, updated_at=?, created_at=?
               WHERE id=?""",
            (body.patient_name, body.phone, body.reason,
             now.isoformat(), now.isoformat(), appointment_id),
        )
        await db.execute("COMMIT")
    except HTTPException:
        try:
            await db.execute("ROLLBACK")
        except Exception:
            pass
        raise

    # Create session token
    session_token, _ = otp_service.create_session_token(body.phone, "patient")

    # Side effects (fire-and-forget; don't fail booking if these error)
    settings = get_settings()
    try:
        slot_dt = _parse_ist(slot_time)
        slot_date_str = slot_dt.strftime("%A, %d %B %Y")   # "Tuesday, 19 May 2026"
        slot_time_str = slot_dt.strftime("%I:%M %p IST").lstrip("0")
        await whatsapp_client.send_booking_confirmation(
            body.phone, body.patient_name, settings.doctor_name, slot_date_str, slot_time_str
        )
    except Exception:
        pass

    try:
        await scheduler.register_appointment_jobs(
            appointment_id, slot_time, body.phone, body.patient_name
        )
    except Exception:
        pass

    appt = AppointmentOut(
        id=appointment_id, slot_time=slot_time,
        patient_name=body.patient_name, patient_phone=body.phone,
        reason=body.reason, status="booked",
    )
    return BookResponse(appointment=appt, session_token=session_token)


# ── DELETE /appointments/{id} ─────────────────────────────────────────────────

@router.delete("/appointments/{appt_id}", response_model=CancelResponse)
async def delete_appointment(
    appt_id: str,
    phone: str = Depends(_require_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT id, slot_time, patient_phone, status, google_contact_resource_name FROM appointments WHERE id=?",
        (appt_id,),
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    if row["patient_phone"] != phone:
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    if row["status"] == "cancelled" or row["status"] == "available":
        raise HTTPException(
            status_code=409,
            detail={"error": "already_cancelled", "message": "Appointment already cancelled."},
        )

    # Check cancellation deadline: before 11:59 PM IST the night before
    slot_dt = _parse_ist(row["slot_time"])
    now = _now_ist()
    deadline = datetime(
        slot_dt.year, slot_dt.month, slot_dt.day,
        23, 59, 0, tzinfo=_IST
    ) - timedelta(days=1)

    if now > deadline:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "cancel_deadline_passed",
                "message": "Cancellations must be made by 11:59 PM the night before your appointment.",
            },
        )

    # Cancel in IMMEDIATE transaction
    cancelled_at = now
    await db.execute("BEGIN IMMEDIATE")
    try:
        await db.execute(
            """UPDATE appointments
               SET status='available', patient_name=NULL, patient_phone=NULL,
                   reason=NULL, hold_expires_at=NULL, updated_at=?
               WHERE id=?""",
            (cancelled_at.isoformat(), appt_id),
        )
        await db.execute("COMMIT")
    except Exception:
        await db.execute("ROLLBACK")
        raise

    # Side effects
    try:
        await scheduler.cancel_appointment_jobs(appt_id)
    except Exception:
        pass

    if row["google_contact_resource_name"]:
        try:
            await google_contacts.wipe_contact(appt_id, db)
        except Exception:
            pass

    settings = get_settings()
    try:
        slot_date_str = slot_dt.strftime("%A, %d %B %Y")
        slot_time_str = slot_dt.strftime("%I:%M %p IST").lstrip("0")
        original_name = row["patient_phone"]  # already wiped; use phone as fallback
        await whatsapp_client.send_cancellation(
            phone, "Patient", settings.doctor_name, slot_date_str, slot_time_str
        )
    except Exception:
        pass

    return CancelResponse(
        id=appt_id, status="available", cancelled_at=cancelled_at.isoformat()
    )


# ── GET /appointments/lookup ──────────────────────────────────────────────────

@router.get("/appointments/lookup", response_model=LookupResponse)
async def lookup_appointments(
    phone_param: Optional[str] = Query(None, alias="phone"),
    session_phone: str = Depends(_require_session),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Session phone must match requested phone
    lookup_phone = phone_param or session_phone
    if lookup_phone != session_phone:
        raise HTTPException(status_code=403, detail={"error": "forbidden"})

    now = _now_ist().isoformat()

    # Upcoming: soonest future booked appointment
    async with db.execute(
        """SELECT id, slot_time, patient_name, patient_phone, reason, status
           FROM appointments
           WHERE patient_phone=? AND status='booked' AND slot_time >= ?
           ORDER BY slot_time ASC LIMIT 1""",
        (session_phone, now),
    ) as cur:
        upcoming_row = await cur.fetchone()

    # Last visit: most recent done appointment
    async with db.execute(
        """SELECT id, slot_time, patient_name, patient_phone, reason, status
           FROM appointments
           WHERE patient_phone=? AND status='done'
           ORDER BY slot_time DESC LIMIT 1""",
        (session_phone,),
    ) as cur:
        last_row = await cur.fetchone()

    return LookupResponse(
        upcoming=_row_to_appt(upcoming_row) if upcoming_row else None,
        last_visit=_row_to_appt(last_row) if last_row else None,
    )


# ── POST /appointments/cancel-and-rebook ──────────────────────────────────────

@router.post("/appointments/cancel-and-rebook", response_model=CancelRebookResponse)
async def cancel_and_rebook(body: CancelRebookRequest, db: aiosqlite.Connection = Depends(get_db)):
    # Fetch existing appointment
    async with db.execute(
        "SELECT id, slot_time, patient_phone, status FROM appointments WHERE id=?",
        (body.cancel_id,),
    ) as cur:
        existing = await cur.fetchone()

    if existing is None:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    if existing["patient_phone"] != body.phone:
        raise HTTPException(status_code=409, detail={"error": "phone_mismatch"})

    if existing["status"] != "booked":
        raise HTTPException(
            status_code=409,
            detail={"error": "cancel_deadline_passed",
                    "message": "Appointment cannot be cancelled."},
        )

    # Check cancel deadline
    slot_dt = _parse_ist(existing["slot_time"])
    now = _now_ist()
    deadline = datetime(
        slot_dt.year, slot_dt.month, slot_dt.day, 23, 59, 0, tzinfo=_IST
    ) - timedelta(days=1)
    if now > deadline:
        raise HTTPException(
            status_code=409,
            detail={"error": "cancel_deadline_passed",
                    "message": "Cancellation deadline has passed."},
        )

    # Fetch new slot
    async with db.execute(
        "SELECT id, slot_time, status FROM appointments WHERE id=?",
        (body.new_slot_id,),
    ) as cur:
        new_slot = await cur.fetchone()

    if new_slot is None:
        raise HTTPException(status_code=404, detail={"error": "not_found"})

    # Validate new slot rules (window + cutoff)
    try:
        slot_rules.check_booking_window(new_slot["slot_time"])
        slot_rules.check_cutoff(new_slot["slot_time"])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail={"error": str(exc)})

    if new_slot["status"] != "available":
        raise HTTPException(
            status_code=409,
            detail={"error": "slot_unavailable", "message": "New slot is not available."},
        )

    # Atomic: cancel existing + hold new
    hold_expires_at = (now + timedelta(minutes=2)).isoformat()

    await db.execute("BEGIN IMMEDIATE")
    try:
        # Re-check new slot inside transaction
        async with db.execute(
            "SELECT status FROM appointments WHERE id=?", (body.new_slot_id,)
        ) as cur:
            check = await cur.fetchone()
        if check is None or check["status"] != "available":
            await db.execute("ROLLBACK")
            raise HTTPException(status_code=409, detail={"error": "slot_unavailable"})

        # Cancel existing
        await db.execute(
            """UPDATE appointments
               SET status='available', patient_name=NULL, patient_phone=NULL,
                   reason=NULL, hold_expires_at=NULL, updated_at=?
               WHERE id=?""",
            (now.isoformat(), body.cancel_id),
        )
        # Hold new
        await db.execute(
            "UPDATE appointments SET status='held', hold_expires_at=?, updated_at=? WHERE id=?",
            (hold_expires_at, now.isoformat(), body.new_slot_id),
        )
        await db.execute("COMMIT")
    except HTTPException:
        try:
            await db.execute("ROLLBACK")
        except Exception:
            pass
        raise

    # Cancel scheduler jobs for old appointment
    try:
        await scheduler.cancel_appointment_jobs(body.cancel_id)
    except Exception:
        pass

    return CancelRebookResponse(
        cancelled_id=body.cancel_id,
        hold_id=body.new_slot_id,
        hold_expires_at=hold_expires_at,
    )
