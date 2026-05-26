"""
Step 4 tests: OTP service and auth router.

Uses an in-memory DB (from conftest) and WHATSAPP_MODE=mock.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
import pytest
import pytest_asyncio
import aiosqlite

from services import otp_service
from services.otp_service import generate_otp, verify_otp, check_resend_cooldown, create_session_token, verify_session_token

_IST = timezone(timedelta(hours=5, minutes=30))


# ── Unit tests: otp_service ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_otp_returns_4_digit_code(db):
    code, expires_at = await generate_otp("919876543210", "booking", db)
    assert len(code) == 4
    assert code.isdigit()
    # expires_at should be in the future
    exp = datetime.fromisoformat(expires_at)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=_IST)
    assert exp > datetime.now(_IST)


@pytest.mark.asyncio
async def test_verify_otp_happy(db):
    code, _ = await generate_otp("919876543210", "booking", db)
    await verify_otp("919876543210", code, "booking", db)  # Should not raise


@pytest.mark.asyncio
async def test_verify_otp_wrong_code_raises(db):
    code, _ = await generate_otp("919876543210", "booking", db)
    wrong = "0000" if code != "0000" else "1111"
    with pytest.raises(ValueError, match="otp_invalid"):
        await verify_otp("919876543210", wrong, "booking", db)


@pytest.mark.asyncio
async def test_verify_otp_expired_raises(db):
    """Force-insert an expired OTP and verify it fails."""
    import uuid
    now = datetime.now(_IST)
    expired_at = (now - timedelta(seconds=1)).isoformat()
    await db.execute(
        "INSERT INTO otp_tokens (id, phone, code, purpose, expires_at, used, created_at) VALUES (?,?,?,?,?,0,?)",
        (str(uuid.uuid4()), "919999999999", "1234", "booking", expired_at, now.isoformat()),
    )
    await db.commit()
    with pytest.raises(ValueError, match="otp_expired"):
        await verify_otp("919999999999", "1234", "booking", db)


@pytest.mark.asyncio
async def test_verify_otp_used_raises(db):
    code, _ = await generate_otp("919876543210", "booking", db)
    await verify_otp("919876543210", code, "booking", db)   # first use — OK
    with pytest.raises(ValueError):                          # second use — fails
        await verify_otp("919876543210", code, "booking", db)


@pytest.mark.asyncio
async def test_only_latest_otp_valid(db):
    """Generating a second OTP invalidates the first."""
    code1, _ = await generate_otp("919876543210", "booking", db)
    code2, _ = await generate_otp("919876543210", "booking", db)

    # code1 should now be invalid
    with pytest.raises(ValueError, match="otp_invalid"):
        await verify_otp("919876543210", code1, "booking", db)

    # code2 should still work
    await verify_otp("919876543210", code2, "booking", db)


@pytest.mark.asyncio
async def test_resend_cooldown_blocks(db):
    await generate_otp("919876543210", "booking", db)
    remaining = await check_resend_cooldown("919876543210", "booking", db)
    assert remaining > 0  # cooldown active


@pytest.mark.asyncio
async def test_resend_cooldown_cleared_for_new_phone(db):
    remaining = await check_resend_cooldown("910000000000", "booking", db)
    assert remaining == 0


# ── Unit tests: session tokens ────────────────────────────────────────────────

def test_patient_session_token_roundtrip():
    token, expires_at = create_session_token("919876543210", "patient")
    phone = verify_session_token(token, "patient")
    assert phone == "919876543210"


def test_doctor_session_token_roundtrip():
    token, _ = create_session_token("919876543210", "doctor")
    phone = verify_session_token(token, "doctor")
    assert phone == "919876543210"


def test_wrong_role_raises_forbidden():
    token, _ = create_session_token("919876543210", "doctor")
    with pytest.raises(ValueError, match="forbidden"):
        verify_session_token(token, "patient")


def test_tampered_token_raises():
    token, _ = create_session_token("919876543210", "patient")
    tampered = token[:-4] + "xxxx"
    with pytest.raises(ValueError):
        verify_session_token(tampered, "patient")


# ── Integration tests: auth router ───────────────────────────────────────────

@pytest_asyncio.fixture
async def test_app(db):
    """FastAPI test client wired to the in-memory test DB."""
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from httpx import AsyncClient, ASGITransport
    from routers import auth as auth_router
    import database as _db_module

    app = FastAPI()
    app.include_router(auth_router.router)

    # Override DB dependency to use test in-memory DB
    async def override_get_db():
        return db

    from database import get_db
    app.dependency_overrides[get_db] = override_get_db

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


@pytest.mark.asyncio
async def test_otp_send_happy(test_app):
    resp = await test_app.post("/otp/send", json={"phone": "919876543210", "purpose": "booking"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["sent"] is True
    assert data["expires_in_seconds"] > 0


@pytest.mark.asyncio
async def test_otp_send_resend_too_soon(test_app, db):
    # First send
    await test_app.post("/otp/send", json={"phone": "919876543210", "purpose": "booking"})
    # Immediate second send → should be blocked
    resp = await test_app.post("/otp/send", json={"phone": "919876543210", "purpose": "booking"})
    assert resp.status_code == 429
    assert resp.json()["detail"]["error"] == "resend_too_soon"


@pytest.mark.asyncio
async def test_otp_verify_happy(test_app, db):
    # Generate directly to get the code
    code, _ = await generate_otp("919876543210", "booking", db)
    resp = await test_app.post(
        "/otp/verify", json={"phone": "919876543210", "code": code, "purpose": "booking"}
    )
    assert resp.status_code == 200
    assert resp.json()["verified"] is True
    assert "session_token" in resp.json()


@pytest.mark.asyncio
async def test_otp_verify_wrong_code(test_app, db):
    code, _ = await generate_otp("919876543210", "booking", db)
    wrong = "0000" if code != "0000" else "1111"
    resp = await test_app.post(
        "/otp/verify", json={"phone": "919876543210", "code": wrong, "purpose": "booking"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "otp_invalid"


@pytest.mark.asyncio
async def test_otp_verify_expired(test_app, db):
    import uuid
    now = datetime.now(_IST)
    await db.execute(
        "INSERT INTO otp_tokens (id, phone, code, purpose, expires_at, used, created_at) VALUES (?,?,?,?,?,0,?)",
        (str(uuid.uuid4()), "919000000000", "5678", "booking",
         (now - timedelta(seconds=10)).isoformat(), now.isoformat()),
    )
    await db.commit()
    resp = await test_app.post(
        "/otp/verify", json={"phone": "919000000000", "code": "5678", "purpose": "booking"}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error"] == "otp_expired"


@pytest.mark.asyncio
async def test_otp_verify_emergency_pin(test_app):
    """Emergency PIN '9999' should work for doctor_login via bcrypt hash in env."""
    # The hash in .env corresponds to "9999" — but the test env has a different hash.
    # We test the flow by using bcrypt to generate a hash for "1234" and patching settings.
    import bcrypt
    from unittest.mock import patch
    from config import Settings

    test_hash = bcrypt.hashpw(b"1234", bcrypt.gensalt()).decode()

    with patch("routers.auth.get_settings") as mock_settings:
        mock_settings.return_value = Settings(
            doctor_emergency_pin_hash=test_hash,
            session_secret_key="test-secret-key-32chars-padding-ok",
        )
        with patch("services.otp_service.get_settings") as mock_otp_settings:
            mock_otp_settings.return_value = Settings(
                doctor_emergency_pin_hash=test_hash,
                session_secret_key="test-secret-key-32chars-padding-ok",
            )
            resp = await test_app.post(
                "/otp/verify",
                json={"phone": "919876543210", "code": "1234", "purpose": "doctor_login"},
            )
    assert resp.status_code == 200
    assert resp.json()["verified"] is True
