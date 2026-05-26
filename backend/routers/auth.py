"""
routers/auth.py — OTP send & verify endpoints.

POST /otp/send   — generate + send a 4-digit OTP via WhatsApp
POST /otp/verify — validate OTP (or emergency PIN for doctor_login)
"""

from __future__ import annotations

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

import aiosqlite

from config import get_settings
from database import get_db
from schemas import OtpSendRequest, OtpSendResponse, OtpVerifyRequest, OtpVerifyResponse
from services import otp_service, whatsapp_client

router = APIRouter(tags=["auth"])


@router.post("/otp/send", response_model=OtpSendResponse)
async def otp_send(body: OtpSendRequest, db: aiosqlite.Connection = Depends(get_db)):
    settings = get_settings()

    # Check resend cooldown
    seconds_remaining = await otp_service.check_resend_cooldown(body.phone, body.purpose, db)
    if seconds_remaining > 0:
        raise HTTPException(
            status_code=429,
            detail={"error": "resend_too_soon",
                    "message": f"Please wait {seconds_remaining}s before requesting a new OTP."},
        )

    code, expires_at = await otp_service.generate_otp(body.phone, body.purpose, db)

    # Send via WhatsApp
    sent = await whatsapp_client.send_otp(body.phone, code)
    if not sent:
        raise HTTPException(
            status_code=502,
            detail={"error": "whatsapp_unavailable",
                    "message": "Could not send OTP via WhatsApp. Please try again."},
        )

    return OtpSendResponse(
        sent=True,
        expires_in_seconds=settings.otp_ttl_seconds,
        resend_available_after_seconds=settings.otp_resend_cooldown_seconds,
    )


@router.post("/otp/verify", response_model=OtpVerifyResponse)
async def otp_verify(body: OtpVerifyRequest, db: aiosqlite.Connection = Depends(get_db)):
    settings = get_settings()

    # Emergency PIN path (doctor_login only)
    if body.purpose == "doctor_login":
        # If the code looks like a non-4-digit value OR if bcrypt hash is set,
        # try the emergency PIN first (then fall through to OTP if it fails).
        if settings.doctor_emergency_pin_hash:
            try:
                pin_match = bcrypt.checkpw(
                    body.code.encode(), settings.doctor_emergency_pin_hash.encode()
                )
            except Exception:
                pin_match = False

            if pin_match:
                token, expires_at = otp_service.create_session_token(body.phone, "doctor")
                return OtpVerifyResponse(
                    verified=True, session_token=token, expires_at=expires_at
                )

    # Standard OTP verification
    try:
        await otp_service.verify_otp(body.phone, body.code, body.purpose, db)
    except ValueError as exc:
        code = str(exc)
        messages = {
            "otp_invalid": "Invalid OTP. Please check the code and try again.",
            "otp_expired": "This OTP has expired. Please request a new one.",
            "otp_used": "This OTP has already been used. Please request a new one.",
        }
        raise HTTPException(
            status_code=400,
            detail={"error": code, "message": messages.get(code, "OTP verification failed.")},
        )

    role = "doctor" if body.purpose == "doctor_login" else "patient"
    token, expires_at = otp_service.create_session_token(body.phone, role)
    return OtpVerifyResponse(verified=True, session_token=token, expires_at=expires_at)
