"""
otp_service.py — OTP generation, verification, and session tokens.

Business rules:
- 4-digit OTP; TTL from OTP_TTL_SECONDS (default 300s).
- Only the most recently issued OTP for a phone+purpose is valid.
- Resend blocked for OTP_RESEND_COOLDOWN_SECONDS (default 59s).
- Session tokens are HMAC-SHA256 signed strings.
  * Patient token expires at min(now + SESSION_INACTIVITY_MINUTES, 11:59 PM IST).
  * Doctor token has no hard expiry (only on page reload / logout).
"""

from __future__ import annotations

import hashlib
import hmac
import random
import uuid
from datetime import datetime, timedelta, timezone, date

import aiosqlite

from config import get_settings

_IST = timezone(timedelta(hours=5, minutes=30))


def _now_ist() -> datetime:
    return datetime.now(_IST)


def _ist_midnight() -> datetime:
    """11:59 PM IST tonight."""
    today = _now_ist().date()
    return datetime(today.year, today.month, today.day, 23, 59, 0, tzinfo=_IST)


# ── OTP helpers ───────────────────────────────────────────────────────────────

def _generate_code() -> str:
    return f"{random.randint(0, 9999):04d}"


async def generate_otp(phone: str, purpose: str, db: aiosqlite.Connection) -> tuple[str, str]:
    """
    Create a new OTP for (phone, purpose).

    Invalidates (marks used) all previous OTPs for the same phone+purpose.
    Returns (code, expires_at_iso).

    Mock mode: always returns '0000' so developers can log in without
    checking log files or the mock-messages.jsonl spool.
    """
    settings = get_settings()
    now = _now_ist()
    expires_at = now + timedelta(seconds=settings.otp_ttl_seconds)

    # Invalidate previous OTPs for this phone+purpose
    await db.execute(
        "UPDATE otp_tokens SET used=1 WHERE phone=? AND purpose=? AND used=0",
        (phone, purpose),
    )

    # In mock mode use a fixed well-known code so developers never need to
    # check log files.  In real mode generate a cryptographically random code.
    code = "0000" if settings.whatsapp_mode == "mock" else _generate_code()
    token_id = str(uuid.uuid4())
    await db.execute(
        """INSERT INTO otp_tokens (id, phone, code, purpose, expires_at, used, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)""",
        (token_id, phone, code, purpose, expires_at.isoformat(), now.isoformat()),
    )
    await db.commit()
    return code, expires_at.isoformat()


async def verify_otp(phone: str, code: str, purpose: str, db: aiosqlite.Connection) -> None:
    """
    Validate OTP.  Raises ValueError with machine code on failure.
    Marks token used=1 on success.
    """
    now = _now_ist()

    async with db.execute(
        """SELECT id, code, expires_at, used
           FROM otp_tokens
           WHERE phone=? AND purpose=? AND used=0
           ORDER BY created_at DESC LIMIT 1""",
        (phone, purpose),
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        raise ValueError("otp_invalid")

    if row["used"]:
        raise ValueError("otp_used")

    # Parse stored expires_at (may or may not have timezone)
    expires_at_str: str = row["expires_at"]
    try:
        expires_dt = datetime.fromisoformat(expires_at_str)
        if expires_dt.tzinfo is None:
            expires_dt = expires_dt.replace(tzinfo=_IST)
    except ValueError:
        raise ValueError("otp_expired")

    if now > expires_dt:
        raise ValueError("otp_expired")

    if row["code"] != code:
        raise ValueError("otp_invalid")

    await db.execute("UPDATE otp_tokens SET used=1 WHERE id=?", (row["id"],))
    await db.commit()


async def check_resend_cooldown(phone: str, purpose: str, db: aiosqlite.Connection) -> int:
    """
    Returns seconds remaining in resend cooldown, or 0 if cooldown cleared.
    """
    settings = get_settings()
    now = _now_ist()

    async with db.execute(
        """SELECT created_at FROM otp_tokens
           WHERE phone=? AND purpose=?
           ORDER BY created_at DESC LIMIT 1""",
        (phone, purpose),
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        return 0

    try:
        created = datetime.fromisoformat(row["created_at"])
        if created.tzinfo is None:
            created = created.replace(tzinfo=_IST)
    except ValueError:
        return 0

    elapsed = (now - created).total_seconds()
    remaining = settings.otp_resend_cooldown_seconds - elapsed
    return max(0, int(remaining))


# ── Session tokens ────────────────────────────────────────────────────────────

def _sign(payload: str) -> str:
    settings = get_settings()
    return hmac.new(
        settings.session_secret_key.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()


def create_session_token(phone: str, role: str) -> tuple[str, str]:
    """
    Create a signed session token.  Returns (token, expires_at_iso).

    * role="patient"  → expires at min(now + 10min, 11:59 PM IST)
    * role="doctor"   → expires far in the future (cleared on page reload)
    """
    settings = get_settings()
    now = _now_ist()

    if role == "patient":
        inactivity_expiry = now + timedelta(minutes=settings.session_inactivity_minutes)
        eod_expiry = _ist_midnight()
        expires_at = min(inactivity_expiry, eod_expiry)
    else:
        # Doctor: 24h from now; frontend clears on page reload anyway
        expires_at = now + timedelta(hours=24)

    payload = f"{phone}:{role}:{expires_at.isoformat()}"
    sig = _sign(payload)
    token = f"{payload}:{sig}"
    return token, expires_at.isoformat()


def verify_session_token(token: str, expected_role: str) -> str:
    """
    Verify token, check expiry and role.
    Returns phone on success, raises ValueError with code on failure.
    """
    try:
        parts = token.rsplit(":", 1)
        if len(parts) != 2:
            raise ValueError("auth_required")
        payload, sig = parts
        expected_sig = _sign(payload)
        if not hmac.compare_digest(sig, expected_sig):
            raise ValueError("auth_required")

        p_parts = payload.split(":", 2)
        if len(p_parts) != 3:
            raise ValueError("auth_required")
        phone, role, expires_at_str = p_parts

        if role != expected_role:
            raise ValueError("forbidden")

        expires_at = datetime.fromisoformat(expires_at_str)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=_IST)
        if _now_ist() > expires_at:
            raise ValueError("auth_required")

        return phone
    except ValueError:
        raise
    except Exception:
        raise ValueError("auth_required")
