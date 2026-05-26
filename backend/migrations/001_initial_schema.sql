-- TeleClinic initial schema
-- All datetimes stored as ISO 8601 with +05:30 (IST).
-- Phone numbers stored as E.164 pure digits (no +, spaces, dashes).

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ── appointments ─────────────────────────────────────────────────────────────
-- status: available | held | booked | done | cancelled
CREATE TABLE IF NOT EXISTS appointments (
  id                           TEXT PRIMARY KEY,     -- UUID v4
  slot_time                    TEXT NOT NULL,        -- ISO 8601 +05:30
  patient_name                 TEXT,
  patient_phone                TEXT,                 -- E.164 digits, e.g. 919876543210
  reason                       TEXT,
  status                       TEXT NOT NULL DEFAULT 'available',
  hold_expires_at              TEXT,                 -- ISO 8601; NULL when not held
  google_contact_resource_name TEXT,                 -- 'people/cXXXX' if app added; NULL otherwise
  created_at                   TEXT,
  updated_at                   TEXT
);

CREATE INDEX IF NOT EXISTS idx_appointments_slot_time  ON appointments(slot_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status      ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_appointments_phone       ON appointments(patient_phone);

-- ── weekly_schedule ──────────────────────────────────────────────────────────
-- day_of_week: 0=Monday … 6=Sunday
-- effective_from: ISO date; always today+28 days when saved
CREATE TABLE IF NOT EXISTS weekly_schedule (
  day_of_week    INTEGER PRIMARY KEY,
  is_open        INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT    NOT NULL
);

-- ── otp_tokens ───────────────────────────────────────────────────────────────
-- purpose: booking | lookup | cancel | doctor_login
CREATE TABLE IF NOT EXISTS otp_tokens (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_purpose ON otp_tokens(phone, purpose);

-- ── notes_log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes_log (
  id              TEXT PRIMARY KEY,
  appointment_id  TEXT NOT NULL REFERENCES appointments(id),
  sent_at         TEXT NOT NULL
);
