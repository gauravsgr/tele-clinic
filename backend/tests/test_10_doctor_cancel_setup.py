"""
Step 10 tests: doctor router, cancellation router, setup router.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone, date

import pytest
import pytest_asyncio

from services.otp_service import create_session_token

_IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist():
    return datetime.now(_IST)


def _future_slot(days: int = 3, hour: int = 10) -> str:
    dt = (_now_ist() + timedelta(days=days)).replace(
        hour=hour, minute=0, second=0, microsecond=0
    )
    return dt.isoformat()


def _doctor_token():
    token, _ = create_session_token("919876543210", "doctor")
    return token


async def _insert_booked(db, phone="919876543210", slot_time=None, patient_name="Alice"):
    sid = str(uuid.uuid4())
    st = slot_time or _future_slot()
    now = _now_ist().isoformat()
    await db.execute(
        """INSERT INTO appointments
           (id, slot_time, patient_name, patient_phone, status, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        (sid, st, patient_name, phone, "booked", now, now),
    )
    await db.commit()
    return sid


@pytest_asyncio.fixture
async def all_routers_client(db):
    from fastapi import FastAPI
    from httpx import AsyncClient, ASGITransport
    from routers import doctor as doc_router, cancellation as cancel_router, setup as setup_router
    from database import get_db

    app = FastAPI()
    app.include_router(doc_router.router)
    app.include_router(cancel_router.router)
    app.include_router(setup_router.router)

    async def override_db():
        return db

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


# ── Doctor schedule ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_doctor_schedule_auth_required(all_routers_client):
    resp = await all_routers_client.get("/doctor/schedule")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_doctor_schedule_happy(all_routers_client, db):
    resp = await all_routers_client.get(
        "/doctor/schedule",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "date" in data
    assert "appointments" in data
    assert "server_time" in data


@pytest.mark.asyncio
async def test_get_doctor_appointments_specific_date(all_routers_client, db):
    target = (date.today() + timedelta(days=5)).isoformat()
    await _insert_booked(db, slot_time=f"{target}T10:00:00+05:30")

    resp = await all_routers_client.get(
        f"/doctor/appointments?date={target}",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    appointments = resp.json()["appointments"]
    assert len(appointments) >= 1
    assert all(a["slot_time"].startswith(target) for a in appointments)


@pytest.mark.asyncio
async def test_get_doctor_appointments_bad_date(all_routers_client):
    resp = await all_routers_client.get(
        "/doctor/appointments?date=not-a-date",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 400


# ── Doctor stats ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_doctor_stats_happy(all_routers_client):
    resp = await all_routers_client.get(
        "/doctor/stats",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "past" in data
    assert "future" in data
    assert "completed_this_month" in data["past"]
    assert "total_bookings_next_28_days" in data["future"]


@pytest.mark.asyncio
async def test_get_doctor_stats_auth_required(all_routers_client):
    resp = await all_routers_client.get("/doctor/stats")
    assert resp.status_code == 401


# ── Doctor notes ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_post_doctor_notes_happy(all_routers_client, db):
    sid = await _insert_booked(db)
    resp = await all_routers_client.post(
        "/doctor/notes",
        json={"appointment_id": sid, "text": "Prescribing amlodipine 5mg once daily."},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    assert resp.json()["sent"] is True


@pytest.mark.asyncio
async def test_post_doctor_notes_not_found(all_routers_client):
    resp = await all_routers_client.post(
        "/doctor/notes",
        json={"appointment_id": str(uuid.uuid4()), "text": "Notes text here."},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_post_doctor_notes_not_active(all_routers_client, db):
    """Notes on an 'available' (not booked) slot → not_active error."""
    sid = str(uuid.uuid4())
    now = _now_ist().isoformat()
    await db.execute(
        "INSERT INTO appointments (id, slot_time, status, created_at) VALUES (?,?,?,?)",
        (sid, _future_slot(), "available", now),
    )
    await db.commit()
    resp = await all_routers_client.post(
        "/doctor/notes",
        json={"appointment_id": sid, "text": "Some notes."},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "not_active"


@pytest.mark.asyncio
async def test_post_doctor_notes_auth_required(all_routers_client):
    resp = await all_routers_client.post(
        "/doctor/notes",
        json={"appointment_id": str(uuid.uuid4()), "text": "Notes."},
    )
    assert resp.status_code == 401


# ── Cancellation router ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_day_happy(all_routers_client, db):
    target = (date.today() + timedelta(days=5)).isoformat()
    await _insert_booked(db, slot_time=f"{target}T10:00:00+05:30")
    await _insert_booked(db, phone="919111111111", slot_time=f"{target}T10:15:00+05:30",
                         patient_name="Bob")

    resp = await all_routers_client.post(
        "/doctor/cancel-day",
        json={"date": target},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["cancelled_count"] == 2
    assert data["date"] == target


@pytest.mark.asyncio
async def test_cancel_day_no_bookings(all_routers_client):
    resp = await all_routers_client.post(
        "/doctor/cancel-day",
        json={"date": "2030-01-01"},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "no_bookings"


@pytest.mark.asyncio
async def test_cancel_day_auth_required(all_routers_client):
    resp = await all_routers_client.post(
        "/doctor/cancel-day", json={"date": "2026-06-01"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_cancel_slots_happy(all_routers_client, db):
    sid1 = await _insert_booked(db, slot_time=_future_slot(days=5, hour=10))
    sid2 = await _insert_booked(db, phone="919111111111",
                                 slot_time=_future_slot(days=5, hour=11),
                                 patient_name="Bob")

    resp = await all_routers_client.post(
        "/doctor/cancel-slots",
        json={"slot_ids": [sid1, sid2]},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["cancelled_count"] == 2
    assert data["skipped"] == []


@pytest.mark.asyncio
async def test_cancel_slots_skips_not_found(all_routers_client, db):
    sid = await _insert_booked(db)
    fake_id = str(uuid.uuid4())

    resp = await all_routers_client.post(
        "/doctor/cancel-slots",
        json={"slot_ids": [sid, fake_id]},
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["cancelled_count"] == 1
    assert fake_id in data["skipped"]


@pytest.mark.asyncio
async def test_cancel_slots_auth_required(all_routers_client):
    resp = await all_routers_client.post(
        "/doctor/cancel-slots", json={"slot_ids": [str(uuid.uuid4())]}
    )
    assert resp.status_code == 401


# ── Setup router ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_google_status_not_configured(all_routers_client):
    """With no GOOGLE_REFRESH_TOKEN, should return connected=False."""
    resp = await all_routers_client.get(
        "/setup/google-status",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["connected"] is False


@pytest.mark.asyncio
async def test_google_status_auth_required(all_routers_client):
    resp = await all_routers_client.get("/setup/google-status")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_google_auth_missing_config(all_routers_client):
    """With placeholder client_id, should return JSON auth_url or 500."""
    resp = await all_routers_client.get(
        "/setup/google-auth",
        headers={"Authorization": "Bearer " + _doctor_token()},
        follow_redirects=False,
    )
    # 200 with {auth_url} if client_id is configured, 500 if config missing
    assert resp.status_code in (200, 500)


@pytest.mark.asyncio
async def test_oauth2callback_no_code_redirects_to_error(all_routers_client):
    resp = await all_routers_client.get(
        "/oauth2callback?error=access_denied",
        follow_redirects=False,
    )
    assert resp.status_code == 307  # RedirectResponse default
    assert "google=error" in resp.headers["location"]
