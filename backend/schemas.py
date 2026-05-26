"""
schemas.py — Pydantic v2 request/response models.

All shapes match technical-design.md §1 exactly.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional
from pydantic import BaseModel, Field


# ── Error envelope ────────────────────────────────────────────────────────────

class ErrorResponse(BaseModel):
    error: str
    message: str


# ── Slots ─────────────────────────────────────────────────────────────────────

class SlotOut(BaseModel):
    id: str
    slot_time: str          # ISO 8601 +05:30
    status: str             # available | held | booked | done | cancelled
    hold_expires_at: Optional[str] = None


# ── Hold ─────────────────────────────────────────────────────────────────────

class HoldRequest(BaseModel):
    slot_id: str
    phone: str              # E.164 pure digits

class HoldResponse(BaseModel):
    hold_id: str
    hold_expires_at: str    # ISO 8601 +05:30


# ── Appointment ───────────────────────────────────────────────────────────────

class AppointmentOut(BaseModel):
    id: str
    slot_time: str
    patient_name: str
    patient_phone: str
    reason: Optional[str] = None
    status: str


# ── Book ─────────────────────────────────────────────────────────────────────

class BookRequest(BaseModel):
    slot_id: str
    otp_token: str          # session_token returned by POST /otp/verify
    patient_name: str
    phone: str              # E.164 pure digits
    reason: Optional[str] = None

class BookResponse(BaseModel):
    appointment: AppointmentOut
    session_token: str


# ── Cancel-and-rebook (US-06) ─────────────────────────────────────────────────

class CancelRebookRequest(BaseModel):
    cancel_id: str          # existing appointment id
    new_slot_id: str
    phone: str              # E.164 pure digits — must match existing booking

class CancelRebookResponse(BaseModel):
    cancelled_id: str
    hold_id: str
    hold_expires_at: str


# ── Patient cancel ────────────────────────────────────────────────────────────

class CancelResponse(BaseModel):
    id: str
    status: str
    cancelled_at: str       # ISO 8601 +05:30


# ── Lookup ────────────────────────────────────────────────────────────────────

class LookupResponse(BaseModel):
    upcoming: Optional[AppointmentOut] = None
    last_visit: Optional[AppointmentOut] = None


# ── OTP ───────────────────────────────────────────────────────────────────────

OtpPurpose = Literal["booking", "lookup", "cancel", "doctor_login"]

class OtpSendRequest(BaseModel):
    phone: str
    purpose: OtpPurpose

class OtpSendResponse(BaseModel):
    sent: bool
    expires_in_seconds: int
    resend_available_after_seconds: int

class OtpVerifyRequest(BaseModel):
    phone: str
    code: str
    purpose: OtpPurpose

class OtpVerifyResponse(BaseModel):
    verified: bool
    session_token: str
    expires_at: str         # ISO 8601 +05:30


# ── Doctor schedule ───────────────────────────────────────────────────────────

class DoctorAppointmentOut(AppointmentOut):
    whatsapp_link: str      # whatsapp://send?phone=<E.164>

class DoctorScheduleResponse(BaseModel):
    date: str               # YYYY-MM-DD
    appointments: list[DoctorAppointmentOut]
    server_time: str        # ISO 8601 +05:30


# ── Doctor stats ──────────────────────────────────────────────────────────────

class PastStats(BaseModel):
    completed_this_month: int
    completed_this_week: int
    avg_session_duration_minutes: int
    patient_cancellations: int
    doctor_cancellations: int
    whatsapp_notes_sent: int

class FutureStats(BaseModel):
    total_bookings_next_28_days: int
    confirmed_this_week: int
    next_available_slot: Optional[str] = None   # ISO 8601 or null
    first_fully_booked_day: Optional[str] = None
    avg_daily_load_forecast: float

class StatsResponse(BaseModel):
    past: PastStats
    future: FutureStats


# ── Notes ─────────────────────────────────────────────────────────────────────

class NotesRequest(BaseModel):
    appointment_id: str
    text: Annotated[str, Field(min_length=1, max_length=4096)]

class NotesResponse(BaseModel):
    sent: bool
    appointment_id: str
    patient_phone: str


# ── Weekly schedule ───────────────────────────────────────────────────────────

_DAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

class WeeklyDayOut(BaseModel):
    day_of_week: int        # 0=Monday … 6=Sunday
    label: str
    is_open: bool
    effective_from: str     # ISO date

class WeeklyDayIn(BaseModel):
    day_of_week: Annotated[int, Field(ge=0, le=6)]
    is_open: bool

class WeeklySaveResponse(BaseModel):
    saved: bool
    effective_from: str


# ── Doctor cancel-day / cancel-slots ──────────────────────────────────────────

class CancelDayRequest(BaseModel):
    date: str               # YYYY-MM-DD

class CancelDayResponse(BaseModel):
    cancelled_count: int
    date: str
    patients_notified: int

class CancelSlotsRequest(BaseModel):
    slot_ids: list[str]

class CancelSlotsResponse(BaseModel):
    cancelled_count: int
    skipped: list[str]      # ids that were not found or already cancelled


# ── Google OAuth setup ────────────────────────────────────────────────────────

class GoogleStatusResponse(BaseModel):
    connected: bool
    email: Optional[str] = None
