"""
whatsapp_client.py — async WhatsApp message sender.

Template variants (1-of-3 at random) per message type exactly as specified
in instructions.md §WhatsApp Anti-Ban Rules.

WHATSAPP_MODE=mock  → log to data/mock-messages.jsonl, no HTTP call.
WHATSAPP_MODE=real  → POST to WHATSAPP_WORKER_URL/send-message.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

from config import get_settings

_IST = timezone(timedelta(hours=5, minutes=30))
logger = logging.getLogger(__name__)

_MOCK_LOG = Path(__file__).parent.parent / "data" / "mock-messages.jsonl"

# ── Message templates ─────────────────────────────────────────────────────────

_BOOKING_TEMPLATES = [
    "Hi {patient_name}! Your appointment with {doctor_name} is confirmed for {date} at {time} IST. "
    "Please keep WhatsApp open — the doctor will call you directly. See you then! 🩺",

    "Hello {patient_name}, you're all set! {doctor_name} will call you on WhatsApp at {time} on {date}. "
    "No need to do anything — just make sure your phone is reachable.",

    "Confirmed ✅ {patient_name}, your slot with {doctor_name} is locked in for {date} at {time}. "
    "The doctor will reach out directly via WhatsApp video at that time.",
]

_REMINDER_TEMPLATES = [
    "Hi {patient_name}! Just a reminder — your appointment with {doctor_name} is in about 1 hour, "
    "at {time} today. Please keep WhatsApp open and your phone nearby. 📱",

    "Hello {patient_name}, your call with {doctor_name} starts at {time} today. "
    "Make sure you're in a quiet spot with good connectivity — the doctor will call you on WhatsApp shortly.",

    "Quick heads-up, {patient_name}! Your appointment is at {time} today with {doctor_name}. "
    "Stay close to your phone — the WhatsApp call is coming your way soon. 🕐",
]

_CANCELLATION_TEMPLATES = [
    "Hi {patient_name}, we're sorry — your appointment with {doctor_name} on {date} at {time} "
    "has been cancelled. Please rebook at your convenience.",

    "Hello {patient_name}. Unfortunately, your slot with {doctor_name} on {date} at {time} "
    "is no longer available. You can book a new appointment on the same link.",

    "Update for {patient_name}: your appointment with {doctor_name} scheduled for {date} at {time} "
    "has been cancelled. We apologise for any inconvenience — please rebook when ready.",
]


def _pick(templates: list[str]) -> str:
    return random.choice(templates)


# ── Core send ─────────────────────────────────────────────────────────────────

async def send_message(to: str, message: str, *, retries: int = 3) -> bool:
    """Send a WhatsApp message. Returns True on success."""
    settings = get_settings()

    if settings.whatsapp_mode == "mock":
        _MOCK_LOG.parent.mkdir(parents=True, exist_ok=True)
        entry = {"to": to, "message": message,
                 "sent_at": datetime.now(_IST).isoformat()}
        with _MOCK_LOG.open("a") as f:
            f.write(json.dumps(entry) + "\n")
        # print() instead of logger.info() so the message always appears on
        # stdout regardless of uvicorn's logging configuration.
        print(f"[MOCK WhatsApp] → {to}: {message[:80]}", flush=True)
        return True

    url = f"{settings.whatsapp_worker_url}/send-message"
    for attempt in range(1, retries + 1):
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json={"to": to, "message": message})
                if resp.status_code == 200:
                    return True
                logger.warning("Worker returned %s (attempt %d)", resp.status_code, attempt)
        except Exception as exc:
            logger.warning("WhatsApp send failed attempt %d: %s", attempt, exc)
        if attempt < retries:
            await asyncio.sleep(30)

    logger.error("WhatsApp send failed permanently to %s", to)
    return False


# ── Typed helpers ─────────────────────────────────────────────────────────────

async def send_otp(phone: str, code: str) -> bool:
    msg = f"Your TeleClinic OTP is {code}. Valid for 5 minutes. Do not share it with anyone."
    return await send_message(phone, msg)


async def send_booking_confirmation(
    phone: str, patient_name: str, doctor_name: str, date: str, time: str
) -> bool:
    msg = _pick(_BOOKING_TEMPLATES).format(
        patient_name=patient_name, doctor_name=doctor_name, date=date, time=time
    )
    return await send_message(phone, msg)


async def send_reminder(
    phone: str, patient_name: str, doctor_name: str, time: str
) -> bool:
    msg = _pick(_REMINDER_TEMPLATES).format(
        patient_name=patient_name, doctor_name=doctor_name, time=time
    )
    return await send_message(phone, msg)


async def send_cancellation(
    phone: str, patient_name: str, doctor_name: str, date: str, time: str
) -> bool:
    msg = _pick(_CANCELLATION_TEMPLATES).format(
        patient_name=patient_name, doctor_name=doctor_name, date=date, time=time
    )
    return await send_message(phone, msg)


async def send_notes(phone: str, text: str) -> bool:
    return await send_message(phone, text)
