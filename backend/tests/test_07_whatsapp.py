"""Step 7 tests: WhatsApp client in mock mode."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

# Force mock mode for these tests
os.environ["WHATSAPP_MODE"] = "mock"

from services import whatsapp_client
from services.whatsapp_client import (
    _BOOKING_TEMPLATES, _REMINDER_TEMPLATES, _CANCELLATION_TEMPLATES,
    send_booking_confirmation, send_reminder, send_cancellation,
    send_otp, send_notes, send_message,
)

MOCK_LOG = Path(__file__).parent.parent / "data" / "mock-messages.jsonl"

# Clear the mock log before test run
if MOCK_LOG.exists():
    MOCK_LOG.unlink()


def _last_mock_message() -> dict:
    lines = MOCK_LOG.read_text().strip().splitlines()
    return json.loads(lines[-1])


@pytest.mark.asyncio
async def test_send_message_mock_writes_to_log():
    await send_message("919876543210", "Hello test!")
    msg = _last_mock_message()
    assert msg["to"] == "919876543210"
    assert msg["message"] == "Hello test!"
    assert "sent_at" in msg


@pytest.mark.asyncio
async def test_send_otp_contains_code():
    await send_otp("919876543210", "1234")
    msg = _last_mock_message()
    assert "1234" in msg["message"]
    assert "TeleClinic OTP" in msg["message"]


@pytest.mark.asyncio
async def test_send_booking_confirmation_uses_valid_template():
    for _ in range(10):  # run several times to hit different templates
        await send_booking_confirmation(
            "919876543210", "Alice", "Dr. Test", "Monday, 01 June 2026", "10:00 AM IST"
        )
    msg = _last_mock_message()
    # Must contain the placeholder values
    assert "Alice" in msg["message"]
    assert "Dr. Test" in msg["message"]


@pytest.mark.asyncio
async def test_send_booking_confirmation_template_is_one_of_three():
    """Collect 30 messages and verify each is one of the 3 templates (post-formatting)."""
    collected = []
    for _ in range(30):
        await send_booking_confirmation(
            "919876543210", "Bob", "Dr. Sample", "Tuesday, 02 June 2026", "11:00 AM IST"
        )
    lines = MOCK_LOG.read_text().strip().splitlines()
    last_30 = [json.loads(l)["message"] for l in lines[-30:]]
    # Each message should match one of the three patterns
    for msg in last_30:
        matched = any(
            msg == t.format(
                patient_name="Bob", doctor_name="Dr. Sample",
                date="Tuesday, 02 June 2026", time="11:00 AM IST"
            )
            for t in _BOOKING_TEMPLATES
        )
        assert matched, f"Message did not match any template: {msg!r}"


@pytest.mark.asyncio
async def test_send_reminder_uses_valid_template():
    await send_reminder("919876543210", "Charlie", "Dr. Test", "3:00 PM IST")
    msg = _last_mock_message()
    assert "Charlie" in msg["message"]


@pytest.mark.asyncio
async def test_send_cancellation_uses_valid_template():
    from services.whatsapp_client import _CANCELLATION_TEMPLATES
    await send_cancellation(
        "919876543210", "David", "Dr. Test", "Wednesday, 03 June 2026", "2:00 PM IST"
    )
    msg = _last_mock_message()
    assert "David" in msg["message"]
    # Message must match one of the 3 cancellation templates
    matched = any(
        msg["message"] == t.format(
            patient_name="David", doctor_name="Dr. Test",
            date="Wednesday, 03 June 2026", time="2:00 PM IST",
        )
        for t in _CANCELLATION_TEMPLATES
    )
    assert matched, f"Message did not match any cancellation template: {msg['message']!r}"


@pytest.mark.asyncio
async def test_send_notes_passthrough():
    await send_notes("919876543210", "Patient has high BP. Prescribing amlodipine 5mg.")
    msg = _last_mock_message()
    assert "amlodipine" in msg["message"]


@pytest.mark.asyncio
async def test_all_three_booking_templates_reachable():
    """Statistical check: with 100 sends, all 3 templates should appear at least once."""
    seen = set()
    for _ in range(100):
        await send_booking_confirmation(
            "919876543210", "Eve", "Dr. T", "Friday, 05 June 2026", "9:00 AM IST"
        )
    lines = MOCK_LOG.read_text().strip().splitlines()
    last_100 = [json.loads(l)["message"] for l in lines[-100:]]
    for template in _BOOKING_TEMPLATES:
        expected = template.format(
            patient_name="Eve", doctor_name="Dr. T",
            date="Friday, 05 June 2026", time="9:00 AM IST"
        )
        if expected in last_100:
            seen.add(template)
    assert len(seen) == 3, f"Only {len(seen)}/3 booking templates were used in 100 sends"
