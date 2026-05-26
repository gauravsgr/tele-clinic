"""
Step 8 tests: google_contacts service with mocked Google People API.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch, AsyncMock

import pytest
import pytest_asyncio

_IST = timezone(timedelta(hours=5, minutes=30))


def _now():
    return datetime.now(_IST).isoformat()


async def _insert_appointment(db, appt_id: str, resource_name: str | None = None):
    await db.execute(
        """INSERT INTO appointments
           (id, slot_time, patient_name, patient_phone, status,
            google_contact_resource_name, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (appt_id, "2026-06-10T10:00:00+05:30",
         "Test Patient", "919876543210", "booked",
         resource_name, _now(), _now()),
    )
    await db.commit()


def _make_mock_service(existing_resource_name=None):
    """Build a mock Google People API service."""
    service = MagicMock()

    # searchContacts response
    if existing_resource_name:
        search_result = {
            "results": [{
                "person": {
                    "resourceName": existing_resource_name,
                    "phoneNumbers": [{"value": "+919876543210"}],
                }
            }]
        }
    else:
        search_result = {"results": []}

    service.people().searchContacts().execute.return_value = search_result

    # createContact response
    service.people().createContact().execute.return_value = {
        "resourceName": "people/c99999999"
    }

    # deleteContact response — returns empty dict on success
    service.people().deleteContact().execute.return_value = {}

    return service


# ── add_contact tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_add_contact_creates_and_stores(db):
    """When contact doesn't exist, creates it and stores resourceName."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id)

    mock_service = _make_mock_service(existing_resource_name=None)

    with patch("services.google_contacts._build_service", return_value=mock_service):
        from services.google_contacts import add_contact
        await add_contact("Test Patient", "919876543210", appt_id, db)

    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appt_id,)
    ) as cur:
        row = await cur.fetchone()

    assert row["google_contact_resource_name"] == "people/c99999999"


@pytest.mark.asyncio
async def test_add_contact_skips_existing_in_address_book(db):
    """When contact already exists in doctor's address book, doesn't create and leaves NULL."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id)

    mock_service = _make_mock_service(existing_resource_name="people/c11111111")

    with patch("services.google_contacts._build_service", return_value=mock_service):
        from services.google_contacts import add_contact
        await add_contact("Test Patient", "919876543210", appt_id, db)

    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appt_id,)
    ) as cur:
        row = await cur.fetchone()

    # Should remain NULL — pre-existing contact, not our contact
    assert row["google_contact_resource_name"] is None


@pytest.mark.asyncio
async def test_add_contact_idempotent(db):
    """If google_contact_resource_name already set, skips without calling API."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id, resource_name="people/c12345678")

    mock_service = _make_mock_service()

    with patch("services.google_contacts._build_service", return_value=mock_service) as mock_build:
        from services.google_contacts import add_contact
        await add_contact("Test Patient", "919876543210", appt_id, db)

    # _build_service should not even be called
    mock_build.assert_not_called()


@pytest.mark.asyncio
async def test_add_contact_no_google_refresh_token(db):
    """If GOOGLE_REFRESH_TOKEN not set, gracefully skips."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id)

    with patch("services.google_contacts._build_service", side_effect=ValueError("GOOGLE_REFRESH_TOKEN not configured.")):
        from services.google_contacts import add_contact
        # Should not raise
        await add_contact("Test Patient", "919876543210", appt_id, db)

    # DB should be unchanged
    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appt_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row["google_contact_resource_name"] is None


# ── wipe_contact tests ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_wipe_contact_deletes_and_clears(db):
    """When resource_name is set, deletes and clears the field."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id, resource_name="people/c12345678")

    mock_service = _make_mock_service()

    with patch("services.google_contacts._build_service", return_value=mock_service):
        from services.google_contacts import wipe_contact
        await wipe_contact(appt_id, db)

    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appt_id,)
    ) as cur:
        row = await cur.fetchone()

    assert row["google_contact_resource_name"] is None


@pytest.mark.asyncio
async def test_wipe_contact_skips_null_resource_name(db):
    """When resource_name is NULL, does nothing."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id, resource_name=None)

    with patch("services.google_contacts._build_service") as mock_build:
        from services.google_contacts import wipe_contact
        await wipe_contact(appt_id, db)

    mock_build.assert_not_called()


@pytest.mark.asyncio
async def test_wipe_contact_404_treated_as_success(db):
    """404 from Google (contact already deleted) is treated as success."""
    appt_id = str(uuid.uuid4())
    await _insert_appointment(db, appt_id, resource_name="people/c12345678")

    mock_service = MagicMock()
    mock_service.people().deleteContact().execute.side_effect = Exception("404 notFound")

    with patch("services.google_contacts._build_service", return_value=mock_service):
        from services.google_contacts import wipe_contact
        await wipe_contact(appt_id, db)

    # Field should be cleared even though delete raised 404
    async with db.execute(
        "SELECT google_contact_resource_name FROM appointments WHERE id=?", (appt_id,)
    ) as cur:
        row = await cur.fetchone()
    assert row["google_contact_resource_name"] is None
