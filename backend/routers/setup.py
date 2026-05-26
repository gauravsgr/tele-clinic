"""
routers/setup.py — Google OAuth setup endpoints.

GET  /setup/google-status  — check connection status
GET  /setup/google-auth    — initiate OAuth flow (302 redirect to Google)
GET  /oauth2callback       — OAuth redirect handler
"""

from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import RedirectResponse

from config import get_settings
from schemas import GoogleStatusResponse
from services.otp_service import verify_session_token

router = APIRouter(tags=["setup"])

# In-memory CSRF nonce store (single-server dev use; production needs Redis/DB)
_csrf_states: set[str] = set()


async def _require_doctor(
    authorization: Optional[str] = Header(None, alias="Authorization"),
) -> str:
    """FastAPI dependency: validate doctor session token, return phone.

    Expects: Authorization: Bearer <session_token>
    """
    token: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer "):]
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"error": "auth_required", "message": "Missing Authorization header."},
        )
    try:
        phone = verify_session_token(token, "doctor")
    except ValueError as exc:
        code = str(exc)
        raise HTTPException(
            status_code=401 if code == "auth_required" else 403,
            detail={"error": code, "message": "Doctor session invalid."},
        )
    return phone


@router.get("/setup/google-status", response_model=GoogleStatusResponse)
async def google_status(_phone: str = Depends(_require_doctor)):
    settings = get_settings()

    if not settings.google_refresh_token:
        return GoogleStatusResponse(connected=False, email=None)

    # Try to get the authenticated user's email
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build

        creds = Credentials(
            token=None,
            refresh_token=settings.google_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.google_client_id,
            client_secret=settings.google_client_secret,
            scopes=["https://www.googleapis.com/auth/contacts"],
        )
        creds.refresh(Request())
        # Get user email from userinfo
        service = build("oauth2", "v2", credentials=creds, cache_discovery=False)
        userinfo = service.userinfo().get().execute()
        return GoogleStatusResponse(connected=True, email=userinfo.get("email"))
    except Exception:
        # Token may be revoked or invalid
        return GoogleStatusResponse(connected=False, email=None)


@router.get("/setup/google-auth")
async def google_auth(_phone: str = Depends(_require_doctor)):
    settings = get_settings()

    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=500,
            detail={"error": "oauth_config_missing",
                    "message": "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured."},
        )

    try:
        from google_auth_oauthlib.flow import Flow

        state = secrets.token_urlsafe(16)
        _csrf_states.add(state)

        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uris": [settings.google_redirect_uri],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=["https://www.googleapis.com/auth/contacts"],
            redirect_uri=settings.google_redirect_uri,
        )
        auth_url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            state=state,
            prompt="consent",
        )
        # Return the URL as JSON so the frontend can do window.location.href = auth_url.
        # A server-side redirect won't work here because the browser's fetch() follows
        # the 307 internally (CORS-opaque) and the frontend never gets a chance to navigate.
        from fastapi.responses import JSONResponse
        return JSONResponse({"auth_url": auth_url})
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": "oauth_config_missing", "message": str(exc)},
        )


@router.get("/oauth2callback")
async def oauth2callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
):
    if error or not code:
        return RedirectResponse(url="http://localhost:5173/doctor?google=error")

    # CSRF check
    if state not in _csrf_states:
        return RedirectResponse(url="http://localhost:5173/doctor?google=error")
    _csrf_states.discard(state)

    settings = get_settings()

    try:
        from google_auth_oauthlib.flow import Flow

        flow = Flow.from_client_config(
            {
                "web": {
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uris": [settings.google_redirect_uri],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            },
            scopes=["https://www.googleapis.com/auth/contacts"],
            redirect_uri=settings.google_redirect_uri,
            state=state,
        )
        flow.fetch_token(code=code)
        refresh_token = flow.credentials.refresh_token

        # Persist refresh token to .env
        _update_env_refresh_token(refresh_token)

        return RedirectResponse(url="http://localhost:5173/doctor?google=connected")
    except Exception as exc:
        return RedirectResponse(url="http://localhost:5173/doctor?google=error")


def _update_env_refresh_token(refresh_token: str) -> None:
    """Write GOOGLE_REFRESH_TOKEN to backend/.env."""
    from pathlib import Path

    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        return

    lines = env_path.read_text().splitlines()
    updated = []
    found = False
    for line in lines:
        if line.startswith("GOOGLE_REFRESH_TOKEN="):
            updated.append(f"GOOGLE_REFRESH_TOKEN={refresh_token}")
            found = True
        else:
            updated.append(line)

    if not found:
        updated.append(f"GOOGLE_REFRESH_TOKEN={refresh_token}")

    env_path.write_text("\n".join(updated) + "\n")

    # Force settings reload
    from config import get_settings
    get_settings.cache_clear()

    import os
    os.environ["GOOGLE_REFRESH_TOKEN"] = refresh_token
