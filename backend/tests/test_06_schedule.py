"""Step 6 tests: weekly schedule router."""

from __future__ import annotations

from datetime import date, timedelta

import pytest
import pytest_asyncio

from services.otp_service import create_session_token


@pytest_asyncio.fixture
async def app_client(db):
    from fastapi import FastAPI
    from httpx import AsyncClient, ASGITransport
    from routers import schedule as sched_router
    from database import get_db

    app = FastAPI()
    app.include_router(sched_router.router)

    async def override_db():
        return db

    app.dependency_overrides[get_db] = override_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


def _doctor_token():
    token, _ = create_session_token("919876543210", "doctor")
    return token


@pytest.mark.asyncio
async def test_get_weekly_schedule_returns_7_days(app_client):
    resp = await app_client.get(
        "/doctor/weekly-schedule",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    days = resp.json()
    assert len(days) == 7


@pytest.mark.asyncio
async def test_get_weekly_schedule_correct_labels(app_client):
    resp = await app_client.get(
        "/doctor/weekly-schedule",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    labels = [d["label"] for d in resp.json()]
    expected = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    assert labels == expected


@pytest.mark.asyncio
async def test_get_weekly_schedule_default_open_days(app_client):
    """Mon–Fri should be open, Sat–Sun closed (seeded in conftest)."""
    resp = await app_client.get(
        "/doctor/weekly-schedule",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    days = resp.json()
    for d in days:
        if d["day_of_week"] < 5:
            assert d["is_open"] is True
        else:
            assert d["is_open"] is False


@pytest.mark.asyncio
async def test_get_weekly_schedule_auth_required(app_client):
    resp = await app_client.get("/doctor/weekly-schedule")
    assert resp.status_code == 401
    assert resp.json()["detail"]["error"] == "auth_required"


@pytest.mark.asyncio
async def test_put_weekly_schedule_saves(app_client):
    all_open = [{"day_of_week": i, "is_open": True} for i in range(7)]
    resp = await app_client.put(
        "/doctor/weekly-schedule",
        json=all_open,
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["saved"] is True

    # effective_from should be today + 28 days
    expected_effective = (date.today() + timedelta(days=28)).isoformat()
    assert data["effective_from"] == expected_effective


@pytest.mark.asyncio
async def test_put_weekly_schedule_reflects_in_get(app_client):
    """After saving all days closed, GET should return all closed."""
    all_closed = [{"day_of_week": i, "is_open": False} for i in range(7)]
    await app_client.put(
        "/doctor/weekly-schedule",
        json=all_closed,
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    resp = await app_client.get(
        "/doctor/weekly-schedule",
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert all(not d["is_open"] for d in resp.json())


@pytest.mark.asyncio
async def test_put_weekly_schedule_wrong_count(app_client):
    only_five = [{"day_of_week": i, "is_open": True} for i in range(5)]
    resp = await app_client.put(
        "/doctor/weekly-schedule",
        json=only_five,
        headers={"Authorization": "Bearer " + _doctor_token()},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "validation_error"


@pytest.mark.asyncio
async def test_put_weekly_schedule_auth_required(app_client):
    all_open = [{"day_of_week": i, "is_open": True} for i in range(7)]
    resp = await app_client.put("/doctor/weekly-schedule", json=all_open)
    assert resp.status_code == 401
