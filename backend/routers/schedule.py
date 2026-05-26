"""
routers/schedule.py — Doctor weekly availability.

GET /doctor/weekly-schedule   — return 7-day schedule
PUT /doctor/weekly-schedule   — save changes (effective_from = today + 28 days)
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, Header, HTTPException

from database import get_db
from schemas import WeeklyDayOut, WeeklyDayIn, WeeklySaveResponse
from services.otp_service import verify_session_token

router = APIRouter(tags=["schedule"])

_DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


async def _require_doctor(
    x_doctor_token: Optional[str] = Header(None, alias="X-Doctor-Token"),
) -> str:
    if not x_doctor_token:
        raise HTTPException(
            status_code=401,
            detail={"error": "auth_required", "message": "Missing X-Doctor-Token header."},
        )
    try:
        phone = verify_session_token(x_doctor_token, "doctor")
    except ValueError as exc:
        code = str(exc)
        status = 401 if code == "auth_required" else 403
        raise HTTPException(
            status_code=status,
            detail={"error": code, "message": "Doctor session invalid or expired."},
        )
    return phone


@router.get("/doctor/weekly-schedule", response_model=list[WeeklyDayOut])
async def get_weekly_schedule(
    _phone: str = Depends(_require_doctor),
    db: aiosqlite.Connection = Depends(get_db),
):
    async with db.execute(
        "SELECT day_of_week, is_open, effective_from FROM weekly_schedule ORDER BY day_of_week"
    ) as cur:
        rows = await cur.fetchall()

    # If table empty (fresh install), return defaults
    if not rows:
        today = date.today()
        effective = (today + timedelta(days=28)).isoformat()
        return [
            WeeklyDayOut(
                day_of_week=i,
                label=_DAY_LABELS[i],
                is_open=i < 5,
                effective_from=effective,
            )
            for i in range(7)
        ]

    return [
        WeeklyDayOut(
            day_of_week=row["day_of_week"],
            label=_DAY_LABELS[row["day_of_week"]],
            is_open=bool(row["is_open"]),
            effective_from=row["effective_from"],
        )
        for row in rows
    ]


@router.put("/doctor/weekly-schedule", response_model=WeeklySaveResponse)
async def put_weekly_schedule(
    body: list[WeeklyDayIn],
    _phone: str = Depends(_require_doctor),
    db: aiosqlite.Connection = Depends(get_db),
):
    # Validate exactly 7 rows with day_of_week 0–6 all present
    if len(body) != 7:
        raise HTTPException(
            status_code=400,
            detail={"error": "validation_error", "message": "Must supply exactly 7 days."},
        )
    dows = sorted(d.day_of_week for d in body)
    if dows != list(range(7)):
        raise HTTPException(
            status_code=400,
            detail={"error": "validation_error",
                    "message": "Must supply each day_of_week 0–6 exactly once."},
        )

    effective_from = (date.today() + timedelta(days=28)).isoformat()

    for day in body:
        await db.execute(
            """INSERT INTO weekly_schedule (day_of_week, is_open, effective_from)
               VALUES (?, ?, ?)
               ON CONFLICT(day_of_week) DO UPDATE
               SET is_open=excluded.is_open, effective_from=excluded.effective_from""",
            (day.day_of_week, int(day.is_open), effective_from),
        )
    await db.commit()

    return WeeklySaveResponse(saved=True, effective_from=effective_from)
