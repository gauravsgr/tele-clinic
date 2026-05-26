# TeleClinic — Technical Design

> Companion to `instructions.md` (authoritative PRD).
> This document answers the five implementation-time questions left open by the PRD:
> API contract, sequence flows, mock strategy, state management, and startup/env.

---

## Table of Contents

1. [Full REST API Specification](#1-full-rest-api-specification)
2. [Sequence Diagrams](#2-sequence-diagrams)
3. [WhatsApp Mock Strategy](#3-whatsapp-mock-strategy)
4. [Frontend State Management](#4-frontend-state-management)
5. [Service Startup and .env](#5-service-startup-and-env)

---

## 1. Full REST API Specification

### Conventions

| Convention | Detail |
|---|---|
| Base URL | `http://localhost:8000` (dev) |
| Content-Type | `application/json` for all request and response bodies |
| Auth — patient session | `Authorization: Bearer <token>` header (session token returned by `POST /otp/verify`) |
| Auth — doctor session | `Authorization: Bearer <token>` header (session token returned by `POST /otp/verify` with `purpose=doctor_login`) |
| Datetimes | ISO 8601 with explicit `+05:30` offset — never bare UTC strings |
| Phone numbers | E.164 pure digits — `919876543210` (no `+`, spaces, or dashes) |
| Slot IDs | ISO 8601 datetime strings (e.g. `2026-05-28T10:00:00+05:30`) — `id` equals `slot_time` |
| Error envelope | `{ "error": "<machine_code>", "message": "<human string>" }` |

### Common error codes

| HTTP | `error` field | Meaning |
|---|---|---|
| 400 | `validation_error` | Missing or malformed field |
| 401 | `auth_required` | Missing or expired session token |
| 403 | `forbidden` | Valid token but wrong role |
| 404 | `not_found` | Resource does not exist |
| 409 | `conflict` | Business rule violation (see each endpoint) |
| 422 | `unprocessable` | Request parsed but semantically invalid |
| 500 | `internal_error` | Unexpected server error |

---

### 1.1 Slots

#### `GET /slots`

Returns all appointment slots within a date range. No auth required.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | `date` (ISO 8601, e.g. `2026-05-25`) | Yes | Start date (inclusive), IST |
| `to` | `date` | Yes | End date (inclusive), IST; max 28 days from today |

**Success — 200**

```json
{
  "slots": [
    {
      "id": "a1b2c3d4-...",
      "slot_time": "2026-05-26T10:00:00+05:30",
      "status": "available",
      "hold_expires_at": null
    },
    {
      "id": "e5f6g7h8-...",
      "slot_time": "2026-05-26T10:15:00+05:30",
      "status": "held",
      "hold_expires_at": "2026-05-26T10:12:00+05:30"
    }
  ]
}
```

`status` values returned: `available` | `held` | `booked` | `done` | `cancelled`.
Slots with status `done` or `cancelled` are included so the frontend can render a complete
day view; it is the frontend's responsibility to hide or grey them out.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | `from` or `to` missing / not a valid date |
| 422 | `window_exceeded` | `to` is more than 28 days from today |

---

### 1.2 Hold

#### `POST /hold`

Places a 2-minute hold on a slot. No auth required (phone is the identity signal; OTP comes next).
Runs the US-06 one-per-day duplicate check atomically inside an SQLite `IMMEDIATE` transaction.

**Request body**

```json
{
  "slot_id": "a1b2c3d4-...",
  "phone": "919876543210"
}
```

**Success — 200**

```json
{
  "hold_id": "a1b2c3d4-...",
  "hold_expires_at": "2026-05-26T10:12:00+05:30"
}
```

`hold_id` is the same as `slot_id`; returned for explicitness.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | Missing `slot_id` or invalid `phone` (not 12 digits starting with `91`) |
| 409 | `slot_unavailable` | Slot is already `held`, `booked`, or `done` |
| 409 | `cutoff_passed` | Slot starts within 1 hour of now (IST) |
| 409 | `outside_window` | Slot is more than 28 days from today |
| 409 | `duplicate_date` | This phone already has a `booked` appointment on the same calendar date (IST). Response body includes the existing appointment: `{ "error": "duplicate_date", "existing": { "id": "...", "slot_time": "...", "status": "booked" } }` |

---

### 1.3 Book

#### `POST /book`

Confirms a booking after OTP verification. Idempotent — calling twice for the same `slot_id`
returns the existing booking without error if already `booked`.

**Request body**

```json
{
  "slot_id": "a1b2c3d4-...",
  "otp_token": "<session_token from POST /otp/verify>",
  "patient_name": "Rahul Verma",
  "phone": "919876543210",
  "reason": "Routine check-up"
}
```

`otp_token` is the **session token** returned by `POST /otp/verify` — not the raw 4-digit OTP
code. The OTP is consumed by `/otp/verify`; `/book` validates the resulting session token.

`reason` is optional.

**Success — 200**

```json
{
  "appointment": {
    "id": "a1b2c3d4-...",
    "slot_time": "2026-05-26T10:00:00+05:30",
    "patient_name": "Rahul Verma",
    "patient_phone": "919876543210",
    "reason": "Routine check-up",
    "status": "booked"
  },
  "session_token": "eyJhbGci..."
}
```

`session_token` is the patient's session token — store in `sessionStorage` and send as
`Authorization: Bearer <session_token>` on subsequent requests.

Side effects triggered by this endpoint:
- Slot status set to `booked`.
- WhatsApp booking confirmation enqueued (one of 3 templates, randomly selected).
- APScheduler jobs registered: 60-min reminder, T−5min contact-add, T+30min wipe+done.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | Missing required fields |
| 400 | `hold_expired` | The 2-minute hold has lapsed; patient must restart |
| 400 | `otp_invalid` | OTP code does not match or has already been used |
| 400 | `otp_expired` | OTP TTL has elapsed |
| 404 | `not_found` | `slot_id` does not exist |
| 409 | `slot_unavailable` | Slot is not in `held` state for this phone |

---

### 1.4 Patient cancel

#### `DELETE /appointments/{id}`

Patient-initiated cancellation. Enforces the 11:59 PM IST deadline.

**Path parameter**

| Param | Type | Description |
|---|---|---|
| `id` | UUID | Appointment ID |

**Headers required**

`Authorization: Bearer <patient session token>`

**Success — 200**

```json
{
  "id": "a1b2c3d4-...",
  "status": "available",
  "cancelled_at": "2026-05-25T14:23:00+05:30"
}
```

Side effects:
- Slot status set to `available`; `patient_name`, `patient_phone`, `reason` cleared.
- WhatsApp cancellation message enqueued.
- If `google_contact_resource_name` is non-null (contact was already added): Google People API
  delete called immediately; field cleared.
- APScheduler jobs for this slot (reminder, contact-add, wipe) cancelled.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 401 | `auth_required` | Missing or expired session token |
| 403 | `forbidden` | Session phone does not match appointment phone |
| 404 | `not_found` | Appointment does not exist |
| 409 | `cancel_deadline_passed` | It is past 11:59 PM IST the night before the appointment |
| 409 | `already_cancelled` | Appointment is already `cancelled` or `available` |

---

### 1.5 Patient lookup

#### `GET /appointments/lookup`

Finds the patient's upcoming appointment and most recent past visit.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `phone` | string | Yes | E.164 digits (without `+`) |

**Headers required**

`Authorization: Bearer <patient session token>` — session token's phone must match `phone` param.

**Success — 200**

```json
{
  "upcoming": {
    "id": "a1b2c3d4-...",
    "slot_time": "2026-05-28T10:00:00+05:30",
    "patient_name": "Rahul Verma",
    "reason": "Routine check-up",
    "status": "booked"
  },
  "last_visit": {
    "id": "z9y8x7w6-...",
    "slot_time": "2026-04-15T16:30:00+05:30",
    "status": "done"
  }
}
```

`upcoming` or `last_visit` may be `null` if none exists.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | `phone` missing or invalid format |
| 401 | `auth_required` | Missing or expired session token |
| 403 | `forbidden` | Token phone does not match `phone` param |

---

### 1.6 Cancel-and-rebook (atomic)

#### `POST /appointments/cancel-and-rebook`

Atomically cancels the patient's existing appointment on a date and places a hold on a new slot.
Used exclusively by the US-06 "Cancel Existing & Rebook" flow.

**Request body**

```json
{
  "cancel_id": "z9y8x7w6-...",
  "new_slot_id": "a1b2c3d4-...",
  "phone": "919876543210"
}
```

**Success — 200**

```json
{
  "cancelled_id": "z9y8x7w6-...",
  "hold_id": "a1b2c3d4-...",
  "hold_expires_at": "2026-05-26T10:12:00+05:30"
}
```

The OTP flow then proceeds identically to `POST /book`.

Side effects:
- SQLite `IMMEDIATE` transaction:
  1. `cancel_id` slot → `available`; patient fields cleared.
  2. `new_slot_id` → `held`; `hold_expires_at` = now + 2 min.
  3. Existing APScheduler jobs for `cancel_id` cancelled.
- If `google_contact_resource_name` on `cancel_id` is non-null → Google People API delete called
  immediately inside the transaction epilogue.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | Missing fields or invalid phone |
| 400 | `cutoff_passed` | `new_slot_id` starts within 1 hour of now |
| 404 | `not_found` | Either `cancel_id` or `new_slot_id` does not exist |
| 409 | `cancel_deadline_passed` | Past 11:59 PM IST the night before the existing appointment |
| 409 | `slot_unavailable` | `new_slot_id` is not `available` |
| 409 | `phone_mismatch` | `phone` does not match `cancel_id` appointment's phone |

---

### 1.7 OTP — Send

#### `POST /otp/send`

Generates a 4-digit OTP, stores it with TTL, and enqueues it to the WhatsApp worker.

**Request body**

```json
{
  "phone": "919876543210",
  "purpose": "booking"
}
```

`purpose` values: `booking` | `lookup` | `cancel` | `doctor_login`

**Success — 200**

```json
{
  "sent": true,
  "expires_in_seconds": 300,
  "resend_available_after_seconds": 59
}
```

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | Invalid phone or unknown purpose |
| 429 | `resend_too_soon` | A new OTP was sent for this phone within the last 59 seconds |
| 502 | `whatsapp_unavailable` | Worker did not accept the send request |

---

### 1.8 OTP — Verify

#### `POST /otp/verify`

Validates a 4-digit OTP. Returns a session token on success. Marks the OTP as used so it cannot
be replayed.

**Request body**

```json
{
  "phone": "919876543210",
  "code": "7832",
  "purpose": "booking"
}
```

**Success — 200**

```json
{
  "verified": true,
  "session_token": "eyJhbGci...",
  "expires_at": "2026-05-25T23:59:00+05:30"
}
```

For `purpose=doctor_login`, `expires_at` is the end of the current page session
(server sets it to a far-future timestamp; actual re-lock is on page reload).

**Alternative — emergency PIN (doctor only)**

When `purpose=doctor_login`, the `code` field may contain the plaintext emergency PIN instead
of an OTP. The backend bcrypt-checks it against `DOCTOR_EMERGENCY_PIN_HASH`. The response shape
is identical.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `otp_invalid` | Code does not match the most recent OTP for this phone+purpose |
| 400 | `otp_expired` | OTP TTL has elapsed |
| 400 | `otp_used` | This OTP code was already consumed |
| 400 | `validation_error` | Missing or malformed fields |

---

### 1.9 Doctor — Today's schedule

#### `GET /doctor/schedule`

Returns all appointments for today (IST). Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Success — 200**

```json
{
  "date": "2026-05-25",
  "appointments": [
    {
      "id": "a1b2c3d4-...",
      "slot_time": "2026-05-25T10:00:00+05:30",
      "patient_name": "Rahul Verma",
      "patient_phone": "919876543210",
      "reason": "Routine check-up",
      "status": "booked",
      "whatsapp_link": "whatsapp://send?phone=919876543210"
    }
  ],
  "server_time": "2026-05-25T09:47:00+05:30"
}
```

`server_time` is returned so the frontend can compute status labels (`DONE`, `ACTIVE NOW`,
`NEXT UP`, `UPCOMING`) relative to authoritative server time, not browser clock.
`whatsapp_link` is a convenience field; equals `whatsapp://send?phone={patient_phone}`.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 401 | `auth_required` | Missing or expired doctor token |
| 403 | `forbidden` | Non-doctor token used |

---

### 1.10 Doctor — Appointments by date

#### `GET /doctor/appointments`

Returns appointments for any calendar date. Doctor auth required.

**Query parameters**

| Param | Type | Required | Description |
|---|---|---|---|
| `date` | `date` (ISO 8601) | Yes | Any date |

**Headers required**

`Authorization: Bearer <doctor session token>`

**Success — 200**

Same shape as `GET /doctor/schedule` response (with `date` set to queried date).

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | `date` missing or invalid |
| 401 | `auth_required` | Missing or expired doctor token |

---

### 1.11 Doctor — Statistics

#### `GET /doctor/stats`

Returns past and future metrics computed from the live database. Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Success — 200**

```json
{
  "past": {
    "completed_this_month": 42,
    "completed_this_week": 11,
    "avg_session_duration_minutes": 12,
    "patient_cancellations": 3,
    "doctor_cancellations": 1,
    "whatsapp_notes_sent": 17
  },
  "future": {
    "total_bookings_next_28_days": 24,
    "confirmed_this_week": 6,
    "next_available_slot": "2026-05-26T10:00:00+05:30",
    "first_fully_booked_day": "2026-05-27",
    "avg_daily_load_forecast": 3.4
  }
}
```

All values default to `0` / `null` on a fresh install. `avg_session_duration_minutes` is
approximated as the slot length (15 min) since actual call duration is not tracked.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 401 | `auth_required` | Missing or expired doctor token |

---

### 1.12 Doctor — Send consultation notes

#### `POST /doctor/notes`

Sends the doctor's typed notes to the active patient via WhatsApp. Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Request body**

```json
{
  "appointment_id": "a1b2c3d4-...",
  "text": "Patient reports mild fever for 3 days. Prescribed paracetamol 500mg TID for 5 days..."
}
```

Maximum `text` length: 4096 characters.

**Success — 200**

```json
{
  "sent": true,
  "appointment_id": "a1b2c3d4-...",
  "patient_phone": "919876543210"
}
```

Side effect: inserts a row into `notes_log` for stats tracking.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | Missing fields or `text` over 4096 chars |
| 401 | `auth_required` | Missing or expired doctor token |
| 404 | `not_found` | `appointment_id` does not exist |
| 409 | `not_active` | Appointment status is not `booked` (no active patient) |
| 502 | `whatsapp_unavailable` | Worker rejected the send |

---

### 1.13 Doctor — Cancel entire day

#### `POST /doctor/cancel-day`

Cancels all `booked` slots on the target date and notifies each patient via WhatsApp.
Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Request body**

```json
{
  "date": "2026-05-28"
}
```

**Success — 200**

```json
{
  "cancelled_count": 6,
  "date": "2026-05-28",
  "patients_notified": 6
}
```

Side effects per cancelled slot:
- Slot status → `available`; patient fields cleared.
- WhatsApp cancellation message enqueued.
- APScheduler jobs cancelled.
- If `google_contact_resource_name` is non-null → Google People API delete called immediately.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | `date` missing or invalid |
| 401 | `auth_required` | Missing or expired doctor token |
| 404 | `no_bookings` | No `booked` slots exist on that date |

---

### 1.14 Doctor — Cancel individual slots

#### `POST /doctor/cancel-slots`

Cancels specific slots by ID. Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Request body**

```json
{
  "slot_ids": ["a1b2c3d4-...", "e5f6g7h8-..."]
}
```

**Success — 200**

```json
{
  "cancelled_count": 2,
  "skipped": []
}
```

`skipped` lists any IDs that were not in `booked` status (already available/cancelled).
Skipped slots do not cause the entire request to fail.

Same side effects as `POST /doctor/cancel-day` per cancelled slot.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | `slot_ids` missing or empty |
| 401 | `auth_required` | Missing or expired doctor token |

---

### 1.15 Doctor — Get weekly schedule

#### `GET /doctor/weekly-schedule`

Returns the current Mon–Sun open/closed configuration and its effective date.
Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Success — 200**

```json
{
  "schedule": [
    { "day_of_week": 0, "label": "Monday",    "is_open": true,  "effective_from": "2026-06-22" },
    { "day_of_week": 1, "label": "Tuesday",   "is_open": true,  "effective_from": "2026-06-22" },
    { "day_of_week": 2, "label": "Wednesday", "is_open": false, "effective_from": "2026-06-22" },
    { "day_of_week": 3, "label": "Thursday",  "is_open": true,  "effective_from": "2026-06-22" },
    { "day_of_week": 4, "label": "Friday",    "is_open": true,  "effective_from": "2026-06-22" },
    { "day_of_week": 5, "label": "Saturday",  "is_open": false, "effective_from": "2026-06-22" },
    { "day_of_week": 6, "label": "Sunday",    "is_open": false, "effective_from": "2026-06-22" }
  ]
}
```

`effective_from` is 28 days after the last save date (business rule; see US-17).

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 401 | `auth_required` | Missing or expired doctor token |

---

### 1.16 Doctor — Save weekly schedule

#### `PUT /doctor/weekly-schedule`

Persists a new Mon–Sun on/off configuration. `effective_from` is always set to today + 28 days
by the server, regardless of any value the client sends. Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Request body**

```json
{
  "schedule": [
    { "day_of_week": 0, "is_open": true  },
    { "day_of_week": 1, "is_open": true  },
    { "day_of_week": 2, "is_open": false },
    { "day_of_week": 3, "is_open": true  },
    { "day_of_week": 4, "is_open": true  },
    { "day_of_week": 5, "is_open": false },
    { "day_of_week": 6, "is_open": false }
  ]
}
```

All 7 days must be present.

**Success — 200**

```json
{
  "saved": true,
  "effective_from": "2026-06-22"
}
```

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 400 | `validation_error` | Missing days or `day_of_week` out of 0–6 range |
| 401 | `auth_required` | Missing or expired doctor token |

---

### 1.17 Setup — Google OAuth status

#### `GET /setup/google-status`

Returns whether Google Contacts is connected and the authorized account email.
Doctor auth required.

**Headers required**

`Authorization: Bearer <doctor session token>`

**Success — 200**

```json
{
  "connected": true,
  "email": "doctor@gmail.com"
}
```

When not connected: `{ "connected": false, "email": null }`

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 401 | `auth_required` | Missing or expired doctor token |

---

### 1.18 Setup — Initiate Google OAuth

#### `GET /setup/google-auth`

Redirects the browser to Google's OAuth 2.0 authorization page.
Doctor auth required (checked before redirect).

**Headers required**

`Authorization: Bearer <doctor session token>`

**Success — 302**

Redirect to `https://accounts.google.com/o/oauth2/v2/auth?...`
with scope `https://www.googleapis.com/auth/contacts`.

**Error responses**

| HTTP | `error` | When |
|---|---|---|
| 401 | `auth_required` | Missing or expired doctor token |
| 500 | `oauth_config_missing` | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` not set in `.env` |

---

### 1.19 Setup — Google OAuth callback

#### `GET /oauth2callback`

Handles the redirect from Google after the doctor grants access.
Exchanges the `code` for tokens, stores the refresh token, and redirects the browser back to
the doctor dashboard.

**Query parameters (injected by Google)**

| Param | Description |
|---|---|
| `code` | Authorization code from Google |
| `state` | Opaque value (the backend sets this to a CSRF nonce before the redirect) |
| `error` | Present only when the doctor denies access |

**Success — 302**

Redirects to `http://localhost:5173/doctor?google=connected`.

**Failure — 302**

Redirects to `http://localhost:5173/doctor?google=error` if `error` param is present or token
exchange fails.

---

### 1.20 WhatsApp worker endpoint

#### `POST /send-message`  _(Node.js worker, port 3001)_

Enqueues a message for delivery. Returns immediately; actual send is asynchronous.
The Python backend is the only caller. No auth — worker is not exposed publicly.

**Request body**

```json
{
  "to": "919876543210",
  "message": "Hi Rahul! Your appointment with Dr. Priya Sharma is confirmed for Monday, 26 May 2026 at 10:00 AM IST..."
}
```

**Success — 200**

```json
{
  "queued": true,
  "queue_position": 3
}
```

**Error responses**

| HTTP | Description |
|---|---|
| 400 | `to` missing or `message` empty |
| 503 | WhatsApp client not yet authenticated (pairing code not yet entered on phone) |

---

## 2. Sequence Diagrams

### 2.1 New booking — slot hold + OTP verification

```
Patient         Frontend              Backend (FastAPI)         WhatsApp Worker       DB (SQLite)
   │                │                        │                         │                   │
   │  open page     │                        │                         │                   │
   │──────────────>│                        │                         │                   │
   │               │──GET /slots?from=&to=─>│                         │                   │
   │               │                        │──── SELECT slots ──────────────────────────>│
   │               │                        │<─── slot rows ─────────────────────────────│
   │               │<──── slot list ────────│                         │                   │
   │  (taps slot)  │                        │                         │                   │
   │               │  (shows booking sheet) │                         │                   │
   │  enters name, │                        │                         │                   │
   │  phone, reason│                        │                         │                   │
   │               │                        │                         │                   │
   │  tap Confirm  │                        │                         │                   │
   │──────────────>│                        │                         │                   │
   │               │──POST /hold ──────────>│                         │                   │
   │               │  {slot_id, phone}      │ BEGIN IMMEDIATE TX      │                   │
   │               │                        │── SELECT existing booking                   │
   │               │                        │   same phone+date IST ─────────────────────>│
   │               │                        │<── 0 rows (no duplicate) ──────────────────│
   │               │                        │── UPDATE slot: status='held',               │
   │               │                        │   hold_expires_at=now+2min ────────────────>│
   │               │                        │   COMMIT                │                   │
   │               │<── {hold_expires_at} ──│                         │                   │
   │  (countdown   │                        │                         │                   │
   │   starts)     │                        │                         │                   │
   │               │──POST /otp/send ───────>│                         │                   │
   │               │  {phone, purpose=      │── INSERT otp_tokens ───────────────────────>│
   │               │   booking}             │── POST /send-message ──>│                   │
   │               │                        │   {to, "OTP: 7832"}    │── enqueue ────────│
   │               │<── {sent:true} ────────│                        │<── {queued:true}   │
   │               │                        │                         │                   │
   │  (fills 4-box │                        │                         │                   │
   │   OTP)        │                        │                         │                   │
   │               │──POST /book ──────────>│                         │                   │
   │               │  {slot_id, otp, name,  │ verify hold not expired │                   │
   │               │   phone, reason}       │── SELECT hold_expires_at ──────────────────>│
   │               │                        │<── hold valid ──────────────────────────────│
   │               │                        │── validate OTP (not used, not expired)      │
   │               │                        │── UPDATE slot: status='booked',             │
   │               │                        │   patient_name, patient_phone, reason ─────>│
   │               │                        │── UPDATE otp: used=1 ───────────────────────>│
   │               │                        │── register APScheduler jobs:                │
   │               │                        │   • T−60min: reminder                       │
   │               │                        │   • T−5min:  contact-add                    │
   │               │                        │   • T+30min: wipe+done                      │
   │               │                        │── POST /send-message ──>│                   │
   │               │                        │   (booking confirmation │── enqueue ────────│
   │               │                        │    random 1-of-3)       │                   │
   │               │<── {appointment,       │                         │                   │
   │               │     session_token} ────│                         │                   │
   │  (success     │                        │                         │                   │
   │   screen)     │                        │                         │                   │
```

**Hold expiry path** (timer reaches zero before OTP verified):

```
   │               │  (countdown reaches 0) │                         │                   │
   │               │  booking sheet closes  │                         │                   │
   │               │  "Reservation window   │                         │                   │
   │               │   has closed"          │                         │                   │
   │               │                        │                         │                   │
   │               │  [separately, backend APScheduler job expires hold every 30 s]       │
   │               │                        │── UPDATE held slots where                   │
   │               │                        │   hold_expires_at < now:                    │
   │               │                        │   status='available' ──────────────────────>│
```

---

### 2.2 Cancel-and-rebook (US-06 — one appointment per calendar date)

```
Patient         Frontend              Backend (FastAPI)                         DB (SQLite)
   │                │                        │                                       │
   │  (has existing booking on date X;       │                                       │
   │   now taps a different slot on date X)  │                                       │
   │               │──POST /hold ──────────>│                                       │
   │               │  {slot_id, phone}      │ BEGIN IMMEDIATE TX                     │
   │               │                        │── SELECT booked slots, same phone+date>│
   │               │                        │<── 1 row found ────────────────────────│
   │               │                        │   ROLLBACK (no hold placed yet)        │
   │               │<─ 409 {error:          │                                       │
   │               │   "duplicate_date",    │                                       │
   │               │   existing:{id,        │                                       │
   │               │   slot_time,...}} ─────│                                       │
   │               │                        │                                       │
   │  (DuplicateAlert sheet opens)          │                                       │
   │  "You already have an appointment at   │                                       │
   │   10:00 AM. Cancel it and rebook?"     │                                       │
   │               │                        │                                       │
   │  tap "Cancel  │                        │                                       │
   │  Existing &   │                        │                                       │
   │  Rebook"      │                        │                                       │
   │──────────────>│                        │                                       │
   │               │──POST /appointments/   │                                       │
   │               │  cancel-and-rebook ───>│                                       │
   │               │  {cancel_id,           │ BEGIN IMMEDIATE TX                     │
   │               │   new_slot_id,         │── UPDATE cancel_id: status='available',│
   │               │   phone}               │   clear patient fields ───────────────>│
   │               │                        │── if google_contact_resource_name       │
   │               │                        │   non-null: Google People API delete    │
   │               │                        │   (outside transaction, immediate)      │
   │               │                        │── cancel APScheduler jobs for cancel_id │
   │               │                        │── UPDATE new_slot_id: status='held',    │
   │               │                        │   hold_expires_at=now+2min ────────────>│
   │               │                        │   COMMIT                               │
   │               │<── {hold_id,           │                                       │
   │               │     hold_expires_at} ──│                                       │
   │               │                        │                                       │
   │  (OTP flow identical to §2.1 from      │                                       │
   │   "POST /otp/send" step onward)        │                                       │
   │               │                        │                                       │
   │               │──POST /book ──────────>│── UPDATE new_slot_id: status='booked' >│
   │               │                        │── register new APScheduler jobs         │
   │               │                        │── enqueue WA confirmation               │
   │               │<── {appointment,       │                                       │
   │               │     session_token} ────│                                       │
   │  (success     │                        │                                       │
   │   screen with │                        │                                       │
   │   new time)   │                        │                                       │
```

---

### 2.3 Doctor contact add/wipe lifecycle (US-18 + US-19)

This flow is entirely server-side. No frontend interaction after booking is complete.

```
Time             APScheduler             google_contacts.py        Google People API     DB
  │                    │                         │                        │               │
  T (booking)          │                         │                        │               │
  │                    │ register jobs:          │                        │               │
  │                    │  • T−60min (reminder)   │                        │               │
  │                    │  • T−5min  (add)        │                        │               │
  │                    │  • T+30min (wipe+done)  │                        │               │
  │                    │                         │                        │               │
  T − 60 min           │                         │                        │               │
  │                    │ reminder job fires      │                        │               │
  │                    │──────────────────────── whatsapp_client.py ──────────────────── │
  │                    │ select random 1-of-3    │                        │               │
  │                    │ reminder template;      │                        │               │
  │                    │ inject name+time        │                        │               │
  │                    │──POST /send-message ─────────────────────────────────────────── │
  │                    │ (to WhatsApp worker)    │                        │               │
  │                    │                         │                        │               │
  T − 5 min            │                         │                        │               │
  │                    │ contact-add job fires   │                        │               │
  │                    │──────────────────────── google_contacts.py ────────────────────>│
  │                    │                         │── search for phone ───>│               │
  │                    │                         │<── contacts: [] ───────│               │
  │                    │                         │   (not found)          │               │
  │                    │                         │── POST people:createContact            │
  │                    │                         │   {name, phone (E.164)}──────────────>│
  │                    │                         │<── {resourceName:      │               │
  │                    │                         │    'people/c98765'} ───│               │
  │                    │                         │── UPDATE appointments  │               │
  │                    │                         │   SET google_contact_  │               │
  │                    │                         │   resource_name=       │               │
  │                    │                         │   'people/c98765' ──────────────────>│
  │                    │                         │                        │               │
  T + 0 (slot start)   │                         │                        │               │
  │                    │ (no job; status stays 'booked'; doctor's dashboard shows ACTIVE NOW)
  │                    │                         │                        │               │
  T + 30 min           │                         │                        │               │
  │                    │ wipe+done job fires     │                        │               │
  │                    │──────────────────────── google_contacts.py ────────────────────>│
  │                    │                         │── SELECT google_contact_               │
  │                    │                         │   resource_name ────────────────────>│
  │                    │                         │<── 'people/c98765' ─────────────────│
  │                    │                         │   (non-null → app added it)           │
  │                    │                         │── DELETE /v1/people/c98765:            │
  │                    │                         │   deleteContact ──────────────────────>│
  │                    │                         │<── 200 OK ─────────────────────────────│
  │                    │                         │── UPDATE appointments  │               │
  │                    │                         │   SET google_contact_  │               │
  │                    │                         │   resource_name=NULL,  │               │
  │                    │                         │   status='done' ────────────────────>│
  │                    │                         │                        │               │
```

**Pre-existing contact path** (phone was already in doctor's contacts):

```
  T − 5 min
  │                    │ contact-add job fires   │                        │               │
  │                    │──────────────────────── google_contacts.py ────────────────────>│
  │                    │                         │── search for phone ───>│               │
  │                    │                         │<── contacts: [{...}] ──│               │
  │                    │                         │   (found — pre-existing)               │
  │                    │                         │   DO NOTHING           │               │
  │                    │                         │   google_contact_resource_name stays NULL
  │                    │                         │                        │               │
  T + 30 min           │                         │                        │               │
  │                    │ wipe+done job fires     │                        │               │
  │                    │──────────────────────── google_contacts.py ────────────────────>│
  │                    │                         │── SELECT google_contact_resource_name >│
  │                    │                         │<── NULL ───────────────────────────────│
  │                    │                         │   (NULL → pre-existing; DO NOT DELETE) │
  │                    │                         │── UPDATE appointments SET status='done'>│
```

**Cancellation before wipe fires** (US-05 / US-15 / US-16 edge case):

```
  Patient cancels at time C (after T−5min contact-add has already fired)
  │                    │                         │                        │               │
  │ DELETE /appointments/{id}                    │                        │               │
  │───────────────────────────────────────────>  │                        │               │
  │                                              │── read google_contact_ │               │
  │                                              │   resource_name ─────────────────────>│
  │                                              │<── 'people/c98765' ───────────────────│
  │                                              │── DELETE /v1/people/c98765:deleteContact
  │                                              │──────────────────────────────────────>│
  │                                              │── UPDATE slot: status='available',     │
  │                                              │   google_contact_resource_name=NULL ──>│
  │                                              │── cancel APScheduler wipe job          │
  │<── {status: "available"} ───────────────────│                        │               │
```

---

## 3. WhatsApp Mock Strategy

### 3.1 The problem

`whatsapp-web.js` requires a live Chromium instance connected to WhatsApp Web. This is
unsuitable for local development without a real WhatsApp account and phone, and it makes CI
impossible. The mock strategy keeps the exact same HTTP and Socket.io interface as the real
worker (`POST /send-message` REST + `pairing_code` / `auth_ready` / `auth_disconnected` Socket.io
events) so the Python backend and React frontend need zero code changes to switch modes.

### 3.2 Environment variable

```
WHATSAPP_MODE=mock    # default for local dev
WHATSAPP_MODE=real    # required for production
```

Set in `backend/.env` (forwarded to the backend process only). The worker reads it from its
own environment:

```bash
WHATSAPP_MODE=mock node whatsapp-worker/server.js
```

### 3.3 Mock worker behaviour (`whatsapp-worker/server.js`)

When `process.env.WHATSAPP_MODE !== 'real'`, the worker skips the `whatsapp-web.js` Client
initialisation entirely and substitutes the following stub behaviours:

#### `POST /send-message` (mock)

1. Validates the request body (`to` and `message` required).
2. Appends the message to `whatsapp-worker/mock-messages.jsonl` (newline-delimited JSON):
   ```json
   {"ts":"2026-05-25T10:23:00+05:30","to":"919876543210","message":"Hi Rahul! Your appointment..."}
   ```
3. Returns `{ "queued": true, "queue_position": 1 }` immediately.

No real delay is simulated — the mock returns instantly so tests are not slowed down.

#### Socket.io pairing code events (mock)

When a client connects to the Socket.io server:

- After **1 second**: emit `pairing_code` with a static fake 8-character code:
  ```
  "ABCD-1234"
  ```
  `SetupPage.jsx` will render this as styled text — it is invalid for real linking, but the UI
  renders correctly for visual testing. No QR image library is needed.
- After **4 seconds**: emit `auth_ready` — the SetupPage transitions to "WhatsApp Connected ✓".

This lets the doctor's SetupPage be exercised without entering any real code.

#### `auth_disconnected` (mock)

Not emitted automatically. Trigger it manually via a test endpoint if needed:
`GET /mock/disconnect` — emits `auth_disconnected` to all connected Socket.io clients.

### 3.4 Real worker — pairing code pattern (`pairingBroadcast.js`)

The following pattern must be used in the real worker. `requestPairingCode()` is `async`
and only exists in the latest `whatsapp-web.js` releases — always pin the latest version in
`package.json`.

```js
// pairingBroadcast.js  (real WHATSAPP_MODE=real path)
const { Client, LocalAuth } = require('whatsapp-web.js');

function initPairing(io, doctorPhone) {
  const client = new Client({ authStrategy: new LocalAuth({ dataPath: './session' }) });

  client.on('ready', () => {
    console.log('[WhatsApp] Client ready — session restored, no pairing needed.');
    io.emit('auth_ready');
  });

  client.on('disconnected', () => {
    console.log('[WhatsApp] Session disconnected.');
    io.emit('auth_disconnected');
  });

  client.initialize();

  // Request pairing code after initialize() is called.
  // Only needed on first run; if a saved session exists, 'ready' fires without this.
  client.once('loading_screen', async () => {
    try {
      // phoneDigits must be E.164 pure digits, e.g. '919876543210'
      const code = await client.requestPairingCode(doctorPhone);
      console.log(`[WhatsApp] Pairing code: ${code}`);
      io.emit('pairing_code', code);

      // Refresh if code expires before the doctor enters it
      // (whatsapp-web.js fires 'qr' again when the session page reloads;
      //  call requestPairingCode again on that event to stay in text-only mode)
      client.on('qr', async () => {
        try {
          const fresh = await client.requestPairingCode(doctorPhone);
          io.emit('pairing_code', fresh);
        } catch (err) {
          console.error('[WhatsApp] Failed to refresh pairing code:', err.message);
          io.emit('auth_error', 'Pairing code refresh failed — check worker logs.');
        }
      });
    } catch (err) {
      console.error('[WhatsApp] requestPairingCode failed:', err.message);
      io.emit('auth_error', 'Pairing code generation failed — check worker logs.');
    }
  });

  return client;
}

module.exports = { initPairing };
```

> **If `requestPairingCode` is not a function:** your installed `whatsapp-web.js` version is too
> old. Run `npm install whatsapp-web.js@latest` in `whatsapp-worker/` and restart.
> Also ensure Puppeteer is launching a modern Chromium — old browser versions do not render the
> "Link with phone number instead" element the library relies on.

### 3.5 Python backend — no changes required

`whatsapp_client.py` always sends requests to `WHATSAPP_WORKER_URL`. Whether the URL points to
a mock or real worker is transparent to the backend. No `if WHATSAPP_MODE:` branches in Python.

### 3.6 Observing mock output

```bash
# Terminal 1 — start mock worker
WHATSAPP_MODE=mock node whatsapp-worker/server.js

# Terminal 2 — watch all outbound WhatsApp messages in real time
tail -f whatsapp-worker/mock-messages.jsonl | python3 -m json.tool

# One-liner to count messages sent during a test run
wc -l whatsapp-worker/mock-messages.jsonl
```

The backend also prints every mock send to stdout:
```
[MOCK WhatsApp] → 919876543210: Your TeleClinic OTP is 0000. Valid for 5 minutes…
```

### 3.7 Mock OTP code

In `WHATSAPP_MODE=mock`, `otp_service.generate_otp()` always produces the fixed code **`0000`**
instead of a random 4-digit number. This means:

- Patients and the doctor can always type `0000` when prompted for an OTP — no need to check log files.
- The emergency doctor PIN (`9999` by default, bcrypt-hashed in `DOCTOR_EMERGENCY_PIN_HASH`) still works for `purpose=doctor_login` as a bypass.
- Tests that call `generate_otp()` in mock mode must account for both calls returning `"0000"`.

In `WHATSAPP_MODE=real`, a cryptographically random 4-digit code is generated and sent via WhatsApp.

### 3.8 Appointment slot seeding

`database.py` exports `seed_slots(db)`, called from `main.py` lifespan on **every startup**.

- Inserts `available` slots for the next 28 calendar days (inclusive of today).
- Sessions: **morning** 10:00–11:45 IST (8 slots × 15 min) + **evening** 16:00–18:45 IST (12 slots × 15 min) = 20 slots per open day.
- Uses `INSERT OR IGNORE` — existing slots with their status and patient data are untouched.
- Open days come from `weekly_schedule` (default: Monday–Friday). Weekend days are skipped.
- Slot `id` equals `slot_time` (the ISO 8601 string, e.g. `2026-05-28T10:00:00+05:30`). The frontend generates the same strings locally so `POST /hold` can find the row by `id`.

Expected startup log line:
```
[seed_slots] Slot window refreshed for the next 28 days.
```

### 3.7 Switching to real mode

1. Ensure a real WhatsApp account is available on a phone.
2. **Verify the library version** — confirm `whatsapp-web.js` in `package.json` is pinned to the
   latest release. `client.requestPairingCode()` does not exist in older versions and will throw
   `TypeError: client.requestPairingCode is not a function` if an outdated package is installed.
   Run `npm install` after updating the version pin.
3. Set `WHATSAPP_MODE=real` in the worker's environment.
4. Start the worker: `WHATSAPP_MODE=real node whatsapp-worker/server.js`
5. Open the doctor's `/doctor` → Setup page. Note the **8-character pairing code** displayed.
6. On the phone: **WhatsApp → Settings → Linked Devices → Link a Device → tap "Link with phone
   number instead" at the bottom of the camera view → enter the 8-character code**.
   No secondary monitor or camera is needed — this works fully on mobile.
7. Session is persisted to `whatsapp-worker/session/` — subsequent restarts skip pairing.

No code changes are needed when switching modes.

---

## 4. Frontend State Management

### 4.1 React Router structure

```jsx
// frontend/src/main.jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

<BrowserRouter>
  <Routes>
    <Route path="/"       element={<PatientApp />} />
    <Route path="/doctor" element={<DoctorApp />} />
  </Routes>
</BrowserRouter>
```

Both route components load eagerly (no `React.lazy`). The two apps share only the component
library (`components/`) — they have separate context trees and no shared state.

### 4.2 Patient session (global state)

**Location:** `SessionContext` (React Context) backed by `session.js` (sessionStorage).

**Shape:**

```js
// What session.js stores and reads from sessionStorage under key 'tele_session'
{
  phone:        "919876543210",  // E.164; set once OTP verified
  sessionToken: "eyJhbGci...",   // opaque token; sent as Authorization header
  expiresAt:    "2026-05-25T23:59:00+05:30",  // 11:59 PM IST today
  lastActivity: 1748188980000    // Unix ms; updated on every user interaction
}
```

**Why `phone` is stored:**
`sessionToken` is opaque — the frontend does not decode it. When the patient opens the lookup
sheet (US-04) or the cancel flow (US-05) *after* OTP verification, the frontend must pass their
phone to the API without asking them to re-enter it. Storing `phone` in the session enables the
"skip OTP" experience.

**Expiry rules (enforced by `session.js`):**

| Rule | Implementation |
|---|---|
| 10-minute inactivity | `SessionContext` runs `setInterval` every 60 s; if `Date.now() - lastActivity > 10 * 60 * 1000`, clears the session |
| 11:59 PM IST end-of-day | Same interval checks if `Date.now() > expiresAt`; clears on first tick after midnight |
| Tab close | `sessionStorage` is automatically cleared by the browser on tab close |

**Updating `lastActivity`:** every API call made through `frontend/src/api/*.js` calls
`session.updateActivity()` before returning — no manual call sites needed in components.

### 4.3 Patient state — what lives where

| State item | Location | Rationale |
|---|---|---|
| `phone`, `sessionToken`, `expiresAt`, `lastActivity` | `sessionStorage` via `SessionContext` | Must survive React re-renders and navigating between sheets; cleared on tab close |
| Selected slot (date + time pill) | `BookingPage` local `useState` | Only relevant while the page is showing; no cross-component consumers |
| 2-minute hold countdown | `BookingSheet` local `useEffect` + `setInterval` | Component owns its timer; cleared on unmount |
| OTP input values | `OTPSheet` local `useState` | Single-use form state |
| Existing appointment (lookup result) | `LookupSheet` local `useState` | Fetched on open; discarded on close |
| Slot list (from `GET /slots`) | `BookingPage` local `useState` | Re-fetched on date change; no caching |

### 4.4 Doctor state — what lives where

The doctor dashboard never persists state across page loads (by design: OTP re-locks on every
page reload).

| State item | Location | Rationale |
|---|---|---|
| OTP verification result | `DoctorApp` local `useState` (in-memory) | Page-lifetime only; deliberately not persisted |
| Doctor session token | In-memory only (same `DoctorApp` state) | Cleared on unmount; no sessionStorage |
| Today's appointment list | `DashboardPage` local `useState`; fetched on mount | Always fresh from server |
| Selected browse date | `BrowsePanel` local `useState` | Panel-scoped; no cross-panel consumers |
| Weekly schedule | `WeeklySchedule.jsx` local `useState`; fetched on mount | Fetched when the settings panel opens |
| Stats data | `StatsSheet` local `useState`; fetched on sheet open | On-demand; not cached |
| Active consultation notes text | `NotesSheet` local `useState` | Discarded on sheet close |
| Socket.io connection (pairing) | `SetupPage` local `useEffect`; connect on mount, disconnect on unmount | Scoped to setup page only |

### 4.5 Polling for slot updates

The patient booking page polls `GET /slots` every 15 seconds to pick up hold expirations and
new bookings from other users. Implementation:

```js
// BookingPage.jsx
useEffect(() => {
  const id = setInterval(() => fetchSlots(selectedDate), 15_000);
  return () => clearInterval(id);
}, [selectedDate]);
```

The doctor dashboard does not poll — status labels (`DONE`, `ACTIVE NOW`, `NEXT UP`, `UPCOMING`)
are computed client-side from `server_time` returned by `GET /doctor/schedule` on mount, using
a local interval that re-computes labels every 30 seconds without re-fetching.

### 4.6 API layer pattern

All HTTP calls live in `frontend/src/api/*.js`. Each function:

1. Calls `session.updateActivity()` (patient calls only).
2. Attaches the appropriate session header.
3. Throws a structured error object `{ code, message }` on non-2xx responses.

```js
// frontend/src/api/appointments.js (sketch)
export async function placeHold(slotId, phone) {
  session.updateActivity();
  const res = await fetch('/api/hold', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot_id: slotId, phone }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw { code: err.error, message: err.message, status: res.status };
  }
  return res.json();
}
```

The Vite dev server proxies `/api/*` → `http://localhost:8000` via `vite.config.js`.

---

## 5. Service Startup and .env

### 5.1 Startup order (local development)

The three services have a hard dependency order:

```
1. whatsapp-worker   ← must be running before backend can send messages
2. backend           ← must be running before frontend can make API calls
3. frontend          ← can be started last; independent of worker directly
```

#### Terminal 1 — WhatsApp worker

```bash
cd whatsapp-worker
WHATSAPP_MODE=mock node server.js
# Expected output:
# [WhatsApp Worker] Mock mode enabled — no real WhatsApp client started
# [WhatsApp Worker] Express + Socket.io listening on port 3001
```

#### Terminal 2 — Backend

```bash
cd backend
cp .env.example .env          # first time only; fill in values
uvicorn main:app --reload --port 8000
# Expected output:
# [seed_slots] Slot window refreshed for the next 28 days.
# INFO:     Application startup complete.
# INFO:     Uvicorn running on http://0.0.0.0:8000
# INFO:     APScheduler started; loaded N pending jobs from database
```

On first run, `database.py` runs `migrations/001_initial_schema.sql` and creates
`data/clinic.db` if it does not exist. On every run, `seed_slots()` generates 20 available
appointment slots per open day for the next 28 days using `INSERT OR IGNORE`.

#### Terminal 3 — Frontend

```bash
cd frontend
npm install                   # first time only
npm run dev
# Expected output:
# VITE v5.x ready in 300ms
# ➜  Local:  http://localhost:5173/
```

#### Optional — Watch mock messages

```bash
tail -f whatsapp-worker/mock-messages.jsonl
```

### 5.2 Concrete `.env.example`

```dotenv
# =============================================================================
# backend/.env.example
# Copy to backend/.env and fill in values before first run.
# =============================================================================

# ─── Doctor identity ─────────────────────────────────────────────────────────
# E.164 format: country code (91 for India) + 10-digit mobile number.
# No +, spaces, or dashes. Example: 919876543210 = +91 98765 43210
DOCTOR_PHONE=919876543210
DOCTOR_NAME="Dr. Priya Sharma"

# ─── WhatsApp worker ─────────────────────────────────────────────────────────
# URL where the Node.js worker is reachable from the Python backend.
# In local dev this is always http://localhost:3001 (same machine).
WHATSAPP_WORKER_URL=http://localhost:3001

# mock = no real WhatsApp needed; messages logged to mock-messages.jsonl
# real = whatsapp-web.js client starts; doctor enters 8-char pairing code on first run
WHATSAPP_MODE=mock

# ─── Google People API ───────────────────────────────────────────────────────
# Obtain from Google Cloud Console → APIs & Services → Credentials.
# Create an OAuth 2.0 Client ID (Web application type).
GOOGLE_CLIENT_ID=123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234

# Must match exactly what is registered in Google Cloud Console.
# Local dev: http://localhost:8000/oauth2callback
# Production: https://your-backend-domain.com/oauth2callback
GOOGLE_REDIRECT_URI=http://localhost:8000/oauth2callback

# Populated automatically after the one-time OAuth flow (GET /setup/google-auth).
# The backend prints this to the terminal; copy it here and restart the backend.
# Leave blank on first run.
GOOGLE_REFRESH_TOKEN=

# ─── OTP settings ────────────────────────────────────────────────────────────
# How long a generated OTP remains valid (seconds).
OTP_TTL_SECONDS=300

# Minimum gap between OTP sends for the same phone number (seconds).
OTP_RESEND_COOLDOWN_SECONDS=59

# ─── Patient session ─────────────────────────────────────────────────────────
# Inactivity timeout in minutes. Session also hard-expires at 11:59 PM IST.
SESSION_INACTIVITY_MINUTES=10

# ─── Doctor emergency PIN ────────────────────────────────────────────────────
# Fallback when WhatsApp is offline and the doctor cannot receive an OTP.
# The PIN itself is never stored here — only its bcrypt hash.
#
# Generate the hash with:
#   python3 -c "import bcrypt; print(bcrypt.hashpw(b'YOUR_4_DIGIT_PIN', bcrypt.gensalt()).decode())"
#
# Example hash for PIN "1234" (DO NOT USE IN PRODUCTION — change this):
DOCTOR_EMERGENCY_PIN_HASH=$2b$12$eImiTXuWVxfM37uY3Nv.deLXvzQFIfqYmQFqmXkPRFTqkVlJpKqHe

# ─── Database ────────────────────────────────────────────────────────────────
# Path to the SQLite file, relative to the backend/ directory.
DATABASE_PATH=data/clinic.db

# ─── CORS ────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed origins for the FastAPI CORS middleware.
# Local dev: just the Vite dev server.
# Production: your Vercel deployment URL.
CORS_ORIGINS=http://localhost:5173
```

### 5.3 First-run checklist

| Step | Command / Action | One-time? |
|---|---|---|
| Copy env file | `cp backend/.env.example backend/.env` | ✓ |
| Install backend deps | `pip install -r backend/requirements.txt` | ✓ |
| Install frontend deps | `cd frontend && npm install` | ✓ |
| Install worker deps | `cd whatsapp-worker && npm install` | ✓ |
| Start in mock mode | See §5.1 | Every dev session |
| Google OAuth flow | Visit `/doctor` → Setup → Connect Google Contacts | ✓ (then copy token to `.env`) |
| Enter WhatsApp pairing code | Visit `/doctor` → Setup → note 8-char code → enter on phone (only when `WHATSAPP_MODE=real`) | ✓ per device |

### 5.4 Production environment differences

| Variable | Local value | Production value |
|---|---|---|
| `WHATSAPP_WORKER_URL` | `http://localhost:3001` | `https://your-worker.onrender.com` |
| `WHATSAPP_MODE` | `mock` | `real` |
| `GOOGLE_REDIRECT_URI` | `http://localhost:8000/oauth2callback` | `https://your-backend.onrender.com/oauth2callback` |
| `CORS_ORIGINS` | `http://localhost:5173` | `https://your-app.vercel.app` |
| `DATABASE_PATH` | `data/clinic.db` | `/data/clinic.db` (persistent volume mount) |

> **Note:** Register the production `GOOGLE_REDIRECT_URI` as an additional authorized redirect
> URI in Google Cloud Console before deploying. The local URI can remain registered alongside it.

---

*End of technical-design.md*
