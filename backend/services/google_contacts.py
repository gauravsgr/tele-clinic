"""
google_contacts.py — Google People API integration.

add_contact()  — add patient to doctor's Google Contacts 5 min before appointment.
wipe_contact() — remove patient from doctor's Google Contacts 30 min after slot start.

Business rules:
- add_contact:  search for phone first; create only if not found;
                store resourceName in appointments.google_contact_resource_name.
- wipe_contact: only delete if google_contact_resource_name IS NOT NULL
                (null = pre-existing contact the app must never touch).
- Both operations are idempotent.
- Google API errors are logged and swallowed (calls can proceed without contact).
"""

from __future__ import annotations

import logging
from typing import Optional

import aiosqlite

from config import get_settings

logger = logging.getLogger(__name__)


def _build_service():
    """Build an authenticated Google People API service object."""
    settings = get_settings()

    if not settings.google_refresh_token:
        raise ValueError("GOOGLE_REFRESH_TOKEN not configured.")

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
    # Refresh to get a valid access token
    creds.refresh(Request())

    service = build("people", "v1", credentials=creds, cache_discovery=False)
    return service


def _phone_to_search(phone_e164: str) -> str:
    """Convert E.164 digits to +E.164 for People API queries."""
    return f"+{phone_e164}"


def _search_contact_by_phone(service, phone_e164: str) -> Optional[str]:
    """
    Search doctor's contacts for the given E.164 phone.
    Returns resourceName if found, else None.
    """
    phone_plus = _phone_to_search(phone_e164)
    # Use searchContacts to find by phone number
    result = service.people().searchContacts(
        query=phone_e164,
        readMask="phoneNumbers,resourceName",
    ).execute()

    for item in result.get("results", []):
        person = item.get("person", {})
        for ph in person.get("phoneNumbers", []):
            value = ph.get("value", "").replace(" ", "").replace("-", "").replace("+", "")
            if value == phone_e164 or ph.get("value", "") == phone_plus:
                return person["resourceName"]
    return None


async def add_contact(
    patient_name: str,
    phone_e164: str,
    appointment_id: str,
    db: aiosqlite.Connection,
) -> None:
    """
    Add patient to doctor's Google Contacts.
    If already in contacts, leave untouched (google_contact_resource_name stays NULL).
    If app creates the contact, store resourceName in DB.
    Idempotent: if google_contact_resource_name already set, skip.
    """
    # Check if already done for this appointment
    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appointment_id,)
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        logger.warning("add_contact: appointment %s not found", appointment_id)
        return

    if row["google_contact_resource_name"]:
        logger.info("add_contact: already done for %s", appointment_id)
        return

    try:
        service = _build_service()
    except ValueError as exc:
        logger.warning("add_contact: Google not configured — %s", exc)
        return
    except Exception as exc:
        logger.error("add_contact: failed to build service — %s", exc)
        return

    try:
        # Check if contact already exists in doctor's address book
        existing = _search_contact_by_phone(service, phone_e164)
        if existing:
            logger.info(
                "add_contact: %s already exists in contacts (%s), not touching",
                phone_e164, existing,
            )
            return  # google_contact_resource_name stays NULL

        # Create the contact
        body = {
            "names": [{"displayName": patient_name, "givenName": patient_name}],
            "phoneNumbers": [{"value": f"+{phone_e164}", "type": "mobile"}],
        }
        created = service.people().createContact(body=body).execute()
        resource_name = created["resourceName"]
        logger.info("add_contact: created %s for appointment %s", resource_name, appointment_id)

        # Store in DB
        await db.execute(
            "UPDATE appointments SET google_contact_resource_name=? WHERE id=?",
            (resource_name, appointment_id),
        )
        await db.commit()

    except Exception as exc:
        logger.error("add_contact: People API error for %s — %s", appointment_id, exc)
        # Log and continue — call proceeds without named contact


async def wipe_contact(appointment_id: str, db: aiosqlite.Connection) -> None:
    """
    Remove patient from doctor's Google Contacts after appointment ends.
    Only acts if google_contact_resource_name IS NOT NULL.
    Clears the field in DB after deleting.
    Idempotent: 404 from Google is treated as success.
    """
    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appointment_id,)
    ) as cur:
        row = await cur.fetchone()

    if row is None:
        logger.warning("wipe_contact: appointment %s not found", appointment_id)
        return

    resource_name = row["google_contact_resource_name"]
    if not resource_name:
        logger.info("wipe_contact: no contact to wipe for %s (pre-existing or not added)", appointment_id)
        return

    try:
        service = _build_service()
    except ValueError as exc:
        logger.warning("wipe_contact: Google not configured — %s", exc)
        return
    except Exception as exc:
        logger.error("wipe_contact: failed to build service — %s", exc)
        return

    try:
        service.people().deleteContact(resourceName=resource_name).execute()
        logger.info("wipe_contact: deleted %s for appointment %s", resource_name, appointment_id)
    except Exception as exc:
        # 404 = already deleted — treat as success
        if "404" in str(exc) or "notFound" in str(exc).lower():
            logger.info("wipe_contact: contact %s already gone", resource_name)
        else:
            logger.error("wipe_contact: People API error — %s", exc)
            return  # Don't clear DB field if delete actually failed

    # Clear the field in DB
    await db.execute(
        "UPDATE appointments SET google_contact_resource_name=NULL WHERE id=?",
        (appointment_id,),
    )
    await db.commit()
