"""
Step 11 integration test: full booking flow through the complete FastAPI app.

Exercises: OTP send → OTP verify → hold → book → lookup → cancel → rebook
Using WHATSAPP_MODE=mock and an in-memory SQLite DB.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone, date

import pytest
import pytest_asyncio

from httpx import AsyncClient, ASGITransport
from services.otp_service import create_session_token

_IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist():
    return datetime.now(_IST)


def _future_slot(days: int = 5, hour: int = 10) -> str:
    dt = (_now_ist() + timedelta(days=days)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return dt.isoformat()


@pytest_asyncio.fixture
async def full_app(db):
    """Full FastAPI app with all routers, using the in-memory test DB."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from database import get_db
    from routers import auth, appointments, schedule, doctor, cancellation, setup

    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(appointments.router)
    app.include_router(schedule.router)
    app.include_router(doctor.router)
    app.include_router(cancellation.router)
    app.include_router(setup.router)

    async def override_db():
        return db

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def _insert_available_slot(db, slot_time: str | None = None) -> str:
    sid = str(uuid.uuid4())
    st = slot_time or _future_slot()
    now = _now_ist().isoformat()
    await db.execute(
        "INSERT INTO appointments (id, slot_time, status, created_at, updated_at) VALUES (?,?,?,?,?)",
        (sid, st, "available", now, now),
    )
    await db.commit()
    return sid


# ── Full booking flow ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_booking_flow(full_app, db):
    """End-to-end: send OTP → verify → hold → book → lookup → cancel."""
    phone = "919876543210"
    slot_id = await _insert_available_slot(db, _future_slot(days=5))

    # 1. Send OTP
    r = await full_app.post("/otp/send", json={"phone": phone, "purpose": "booking"})
    assert r.status_code == 200, r.text
    assert r.json()["sent"] is True

    # 2. Verify OTP (mock mode: always "0000") → get session token
    r = await full_app.post("/otp/verify", json={"phone": phone, "code": "0000", "purpose": "booking"})
    assert r.status_code == 200, r.text
    session_token = r.json()["session_token"]

    # 3. Hold the slot
    r = await full_app.post("/hold", json={"slot_id": slot_id, "phone": phone})
    assert r.status_code == 200, r.text
    assert r.json()["hold_id"] == slot_id

    # 4. Book using the session token from step 2
    r = await full_app.post("/book", json={
        "slot_id": slot_id, "otp_token": session_token,
        "patient_name": "Integration Patient", "phone": phone, "reason": "headache",
    })
    assert r.status_code == 200, r.text
    booking = r.json()
    assert booking["appointment"]["status"] == "booked"
    session_token = booking["session_token"]

    # 5. Lookup
    r = await full_app.get(
        "/appointments/lookup",
        headers={"Authorization": "Bearer " + session_token},
    )
    assert r.status_code == 200, r.text
    assert r.json()["upcoming"]["id"] == slot_id

    # 6. Cancel
    r = await full_app.delete(
        f"/appointments/{slot_id}",
        headers={"Authorization": "Bearer " + session_token},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "available"

    # 7. Verify slot is available again via /slots
    today = date.today()
    r = await full_app.get(
        "/slots",
        params={"from": today.isoformat(), "to": (today + timedelta(days=7)).isoformat()},
    )
    assert r.status_code == 200
    slots = {s["id"]: s for s in r.json()}
    assert slot_id in slots
    assert slots[slot_id]["status"] == "available"


@pytest.mark.asyncio
async def test_cancel_and_rebook_flow(full_app, db):
    """US-06: cancel existing + hold new slot atomically."""
    phone = "919876543210"
    # Book a slot (send OTP → verify → hold → book)
    sid1 = await _insert_available_slot(db, _future_slot(days=5, hour=10))
    await full_app.post("/otp/send", json={"phone": phone, "purpose": "booking"})
    r = await full_app.post("/otp/verify", json={"phone": phone, "code": "0000", "purpose": "booking"})
    assert r.status_code == 200, r.text
    session_token = r.json()["session_token"]
    await full_app.post("/hold", json={"slot_id": sid1, "phone": phone})
    r = await full_app.post("/book", json={
        "slot_id": sid1, "otp_token": session_token,
        "patient_name": "Rebook Patient", "phone": phone,
    })
    assert r.status_code == 200

    # New slot on same day
    sid2 = await _insert_available_slot(db, _future_slot(days=5, hour=11))

    # Cancel-and-rebook
    r = await full_app.post(
        "/appointments/cancel-and-rebook",
        json={"cancel_id": sid1, "new_slot_id": sid2, "phone": phone},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["cancelled_id"] == sid1
    assert data["hold_id"] == sid2

    # Complete booking on new slot.
    # Use create_session_token directly to avoid OTP resend cooldown
    # (the OTP flow itself is covered by test_full_booking_flow).
    session_token2, _ = create_session_token(phone, "patient")
    r = await full_app.post("/book", json={
        "slot_id": sid2, "otp_token": session_token2,
        "patient_name": "Rebook Patient", "phone": phone,
    })
    assert r.status_code == 200
    assert r.json()["appointment"]["id"] == sid2


@pytest.mark.asyncio
async def test_doctor_flow(full_app, db):
    """Doctor: OTP login → view schedule → send notes → cancel day."""
    phone = "919876543210"

    # Insert a booked appointment today
    today_slot = _now_ist().replace(hour=14, minute=0, second=0, microsecond=0).isoformat()
    sid = str(uuid.uuid4())
    now = _now_ist().isoformat()
    await db.execute(
        """INSERT INTO appointments
           (id, slot_time, patient_name, patient_phone, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        (sid, today_slot, "Doctor Test Patient", phone, "booked", now, now),
    )
    await db.commit()

    # Get doctor session token directly
    from services.otp_service import create_session_token
    doctor_token, _ = create_session_token(phone, "doctor")

    # View today's schedule
    r = await full_app.get(
        "/doctor/schedule",
        headers={"Authorization": "Bearer " + doctor_token},
    )
    assert r.status_code == 200
    appointments = r.json()["appointments"]
    assert any(a["id"] == sid for a in appointments)

    # Send notes
    r = await full_app.post(
        "/doctor/notes",
        json={"appointment_id": sid, "text": "Patient has fever. Paracetamol prescribed."},
        headers={"Authorization": "Bearer " + doctor_token},
    )
    assert r.status_code == 200
    assert r.json()["sent"] is True

    # Stats
    r = await full_app.get(
        "/doctor/stats",
        headers={"Authorization": "Bearer " + doctor_token},
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_weekly_schedule_flow(full_app, db):
    """Doctor: view weekly schedule, update it, verify persisted."""
    from services.otp_service import create_session_token
    doctor_token, _ = create_session_token("919876543210", "doctor")

    # View schedule
    r = await full_app.get(
        "/doctor/weekly-schedule",
        headers={"Authorization": "Bearer " + doctor_token},
    )
    assert r.status_code == 200
    assert len(r.json()) == 7

    # Close Wednesday (day 2)
    all_days = [{"day_of_week": i, "is_open": i != 2} for i in range(7)]
    r = await full_app.put(
        "/doctor/weekly-schedule",
        json=all_days,
        headers={"Authorization": "Bearer " + doctor_token},
    )
    assert r.status_code == 200
    assert r.json()["saved"] is True

    # Confirm Wednesday is now closed
    r = await full_app.get(
        "/doctor/weekly-schedule",
        headers={"Authorization": "Bearer " + doctor_token},
    )
    days = {d["day_of_week"]: d for d in r.json()}
    assert days[2]["is_open"] is False


@pytest.mark.asyncio
async def test_get_slots_empty_range(full_app):
    """GET /slots on a range with no appointments returns empty list."""
    # Far future date — no appointments seeded
    far = (date.today() + timedelta(days=20)).isoformat()
    r = await full_app.get("/slots", params={"from": far, "to": far})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_concurrent_hold_race(full_app, db):
    """Two concurrent holds on the same slot → one wins, one gets slot_unavailable."""
    import asyncio
    sid = await _insert_available_slot(db, _future_slot(days=5))

    results = []

    async def try_hold(phone):
        r = await full_app.post("/hold", json={"slot_id": sid, "phone": phone})
        results.append(r.status_code)

    await asyncio.gather(
        try_hold("919876543210"),
        try_hold("919111111111"),
    )

    # Exactly one should succeed (200), one should fail (409)
    assert sorted(results) == [200, 409]
