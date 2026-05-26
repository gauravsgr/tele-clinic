"""Step 3 tests: Pydantic v2 schema round-trips."""

import pytest
from schemas import (
    SlotOut, HoldRequest, HoldResponse,
    AppointmentOut, BookRequest, BookResponse,
    CancelRebookRequest, CancelRebookResponse,
    OtpSendRequest, OtpSendResponse, OtpVerifyRequest, OtpVerifyResponse,
    LookupResponse, DoctorAppointmentOut, DoctorScheduleResponse,
    PastStats, FutureStats, StatsResponse,
    NotesRequest, NotesResponse,
    WeeklyDayOut, WeeklyDayIn, WeeklySaveResponse,
    CancelDayRequest, CancelDayResponse,
    CancelSlotsRequest, CancelSlotsResponse,
    GoogleStatusResponse, ErrorResponse,
)


def test_slot_out_roundtrip():
    s = SlotOut(id="abc", slot_time="2026-06-01T10:00:00+05:30", status="available")
    assert s.hold_expires_at is None
    data = s.model_dump()
    s2 = SlotOut(**data)
    assert s2 == s


def test_hold_request_roundtrip():
    h = HoldRequest(slot_id="uuid1", phone="919876543210")
    assert HoldRequest(**h.model_dump()) == h


def test_book_request_optional_reason():
    r = BookRequest(slot_id="u", otp_token="1234", patient_name="Alice", phone="919876543210")
    assert r.reason is None


def test_book_response_nested():
    appt = AppointmentOut(
        id="u", slot_time="2026-06-01T10:00:00+05:30",
        patient_name="Alice", patient_phone="919876543210",
        reason=None, status="booked",
    )
    br = BookResponse(appointment=appt, session_token="tok123")
    assert br.appointment.patient_name == "Alice"


def test_otp_send_request_purpose():
    for p in ("booking", "lookup", "cancel", "doctor_login"):
        r = OtpSendRequest(phone="919876543210", purpose=p)
        assert r.purpose == p


def test_otp_send_request_invalid_purpose():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        OtpSendRequest(phone="919876543210", purpose="invalid_purpose")


def test_weekly_day_out_labels():
    labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    for i, label in enumerate(labels):
        day = WeeklyDayOut(day_of_week=i, label=label, is_open=True, effective_from="2026-06-22")
        assert day.label == label


def test_weekly_day_in_validation():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        WeeklyDayIn(day_of_week=7, is_open=True)  # 7 is out of range
    with pytest.raises(ValidationError):
        WeeklyDayIn(day_of_week=-1, is_open=False)


def test_notes_request_max_length():
    from pydantic import ValidationError
    valid = NotesRequest(appointment_id="u", text="x" * 4096)
    assert len(valid.text) == 4096
    with pytest.raises(ValidationError):
        NotesRequest(appointment_id="u", text="x" * 4097)
    with pytest.raises(ValidationError):
        NotesRequest(appointment_id="u", text="")  # min_length=1


def test_stats_response_roundtrip():
    stats = StatsResponse(
        past=PastStats(
            completed_this_month=10, completed_this_week=3,
            avg_session_duration_minutes=12, patient_cancellations=1,
            doctor_cancellations=0, whatsapp_notes_sent=5,
        ),
        future=FutureStats(
            total_bookings_next_28_days=20, confirmed_this_week=4,
            next_available_slot="2026-06-02T10:00:00+05:30",
            first_fully_booked_day=None, avg_daily_load_forecast=3.5,
        ),
    )
    assert StatsResponse(**stats.model_dump()) == stats


def test_doctor_appointment_out_whatsapp_link():
    d = DoctorAppointmentOut(
        id="u", slot_time="2026-06-01T10:00:00+05:30",
        patient_name="Bob", patient_phone="919876543210",
        reason="fever", status="booked",
        whatsapp_link="whatsapp://send?phone=919876543210",
    )
    assert d.whatsapp_link.startswith("whatsapp://")


def test_google_status_response():
    g = GoogleStatusResponse(connected=True, email="doc@gmail.com")
    assert g.connected is True
    g2 = GoogleStatusResponse(connected=False)
    assert g2.email is None


def test_error_response():
    e = ErrorResponse(error="not_found", message="Appointment not found")
    assert e.error == "not_found"


def test_cancel_rebook_response():
    r = CancelRebookResponse(
        cancelled_id="u1", hold_id="u2",
        hold_expires_at="2026-06-01T10:02:00+05:30",
    )
    assert r.cancelled_id == "u1"
