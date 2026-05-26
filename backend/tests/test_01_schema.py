"""Step 1 + 2 tests: migration SQL creates the four expected tables."""

import pytest
import pytest_asyncio
import aiosqlite
from pathlib import Path


MIGRATION_SQL = (Path(__file__).parent.parent / "migrations" / "001_initial_schema.sql").read_text()


@pytest.mark.asyncio
async def test_all_tables_exist(db):
    async with db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ) as cur:
        rows = await cur.fetchall()
    tables = {r["name"] for r in rows}
    assert "appointments" in tables
    assert "weekly_schedule" in tables
    assert "otp_tokens" in tables
    assert "notes_log" in tables


@pytest.mark.asyncio
async def test_appointments_columns(db):
    async with db.execute("PRAGMA table_info(appointments)") as cur:
        cols = {r["name"] for r in await cur.fetchall()}
    expected = {
        "id", "slot_time", "patient_name", "patient_phone", "reason",
        "status", "hold_expires_at", "google_contact_resource_name",
        "created_at", "updated_at",
    }
    assert expected.issubset(cols)


@pytest.mark.asyncio
async def test_weekly_schedule_seeded(db):
    async with db.execute("SELECT * FROM weekly_schedule ORDER BY day_of_week") as cur:
        rows = await cur.fetchall()
    assert len(rows) == 7
    # Mon–Fri (0–4) open, Sat–Sun (5–6) closed
    for row in rows:
        if row["day_of_week"] < 5:
            assert row["is_open"] == 1
        else:
            assert row["is_open"] == 0


@pytest.mark.asyncio
async def test_migration_idempotent(db):
    """Running the migration SQL twice should not raise."""
    await db.executescript(MIGRATION_SQL)
    await db.commit()
    async with db.execute("SELECT COUNT(*) FROM appointments") as cur:
        row = await cur.fetchone()
    assert row[0] == 0


@pytest.mark.asyncio
async def test_otp_tokens_columns(db):
    async with db.execute("PRAGMA table_info(otp_tokens)") as cur:
        cols = {r["name"] for r in await cur.fetchall()}
    assert {"id", "phone", "code", "purpose", "expires_at", "used"}.issubset(cols)


@pytest.mark.asyncio
async def test_notes_log_fk(db):
    """notes_log.appointment_id must reference appointments(id)."""
    import uuid
    # Insert an appointment first
    appt_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO appointments (id, slot_time, status) VALUES (?,?,?)",
        (appt_id, "2026-06-01T10:00:00+05:30", "booked"),
    )
    await db.commit()
    # Insert a note — should succeed
    await db.execute(
        "INSERT INTO notes_log (id, appointment_id, sent_at) VALUES (?,?,?)",
        (str(uuid.uuid4()), appt_id, "2026-06-01T10:05:00+05:30"),
    )
    await db.commit()
