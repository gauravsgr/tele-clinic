# TeleClinic — Project Blueprint

This document is the authoritative source of truth for building the TeleClinic appointment
management system. Where this file and the existing frontend demo files (`index.html`,
`doctor.html`) conflict on UX/UI decisions, **the HTML files take precedence**.

> "Booking" and "Appointment" are used interchangeably throughout.

---

## Product Overview

A 100% free mobile-web appointment management system for a single doctor in India. Patients book
via a public URL on their smartphone. The doctor manages the day from a WhatsApp-OTP-protected
dashboard. WhatsApp is the only communication channel — for confirmations, reminders, OTP
verification, consultation notes, and contact management.

**No native app. No email. No payment gateway. No username/password for patients.**

---

## Confirmed Business Rules

| Rule | Detail |
|---|---|
| Slot length | Always 15 minutes. Never patient-configurable. |
| Booking window | Patients may only book within the next 28 days. |
| Booking cut-off | A slot cannot be booked within 1 hour of its start time. |
| Slot hold | When a patient starts the booking form, the slot is held for 2 minutes; visible to others as "Held." |
| One appointment per day | One booking per phone number per calendar date (date-month-year, IST). |
| Cancellation deadline | Patients may cancel only up to 11:59 PM IST the night BEFORE the appointment date. |
| Timezone | All dates and times are IST (UTC+5:30). Server stores ISO 8601 with +05:30 offset. |
| Patient session | OTP verified once per browser session. Expires after 10 min of inactivity or at 11:59 PM IST (whichever comes first). |
| Doctor session | OTP required on every full page load. Does NOT re-lock on inactivity. Doctor has a manual logout button. |
| Working days | Doctor configures which days of the week the clinic is open. All other days are grayed out on the booking page. |
| Schedule change lag | Weekly schedule changes take effect 28 days after saving. Since patients book max 28 days out, no existing booking is ever affected. |
| Contact add | 5 minutes before a slot: patient's number is added to doctor's Google Contacts (Google People API), but only if it does not already exist there. |
| Contact wipe | 15 minutes after a slot ends (i.e., slot start + 30 min): patient's number is removed from doctor's Google Contacts — only if the app added it. Pre-existing contacts are never touched. |
| Anti-ban messaging | Max 10 messages queued at a time. Random 30–60 second delay between each send. 3 rotating message templates per message type. |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Python 3.11+ · FastAPI · aiosqlite |
| Database | SQLite (local file) |
| WhatsApp automation | Node.js 20 · whatsapp-web.js · Express · Socket.io |
| Contact management | Google People API (`google-api-python-client`) |
| Scheduling | APScheduler (Python) |
| Hosting (target) | Vercel (frontend) · Google Cloud / Render free tier (backend + worker) |
| Docker | Deferred — add after MVP |

### Why the WhatsApp worker stays in Node.js
`whatsapp-web.js` is the only mature, actively maintained library that handles WhatsApp Web's full
protocol: messages, session persistence, pairing code authentication, and event emission. Python
Playwright alternatives require re-implementing the same protocol and are significantly more
fragile. The Node.js worker is a thin communication adapter; Python FastAPI is the business-logic
brain. Python calls the worker over HTTP and the doctor's browser connects to it directly via
Socket.io for live pairing code delivery.

### Why Google People API replaces WhatsApp block/unblock
WhatsApp's block feature is controlled by the user, not the server. Managing the doctor's Google
Contacts achieves the intended result: a patient whose number is not in the doctor's address book
cannot initiate contact through WhatsApp in a recognisable way, and the doctor's WhatsApp does not
show them as a saved contact. Google People API is free, official, and well-documented.

---

## Architecture Diagram

```
Patient browser  ──── React (Vite) ─────────────────── HTTP REST ──────────────────┐
                                                                                    │
Doctor browser   ──── React (Vite) ─────────────────── HTTP REST ──────────────────┤
       │                                                                            ▼
       │  (SetupPage only)                                          Python FastAPI backend
       │  Socket.io client                                          (SQLite · APScheduler)
       │                                                                   │        │
       │                                        ┌──────────────────────────┘        └─────────────────────┐
       │                                        ▼                                                          ▼
       └──────────────────────────── Node.js WhatsApp worker                        Google People API
                                     (whatsapp-web.js + Chromium)                   (contacts add/wipe)
                                     Express REST:                                  OAuth 2.0 refresh token
                                       POST /send-message
                                     Socket.io events (pairing setup page only):
                                       emit → pairing_code  (8-char string, display as text)
                                       emit → auth_ready
                                       emit → auth_disconnected
```

---

## Repository Structure

```
tele-clinic/
│
├── frontend/                        # React + Vite SPA
│   ├── public/
│   │   └── favicon.ico
│   ├── src/
│   │   ├── main.jsx                 # Entry point; React Router: / = patient, /doctor = doctor
│   │   ├── App.jsx
│   │   │
│   │   ├── components/              # Shared UI primitives (used in both patient and doctor)
│   │   │   ├── OTPInput.jsx         # 4-box OTP field with auto-advance and backspace
│   │   │   ├── BottomSheet.jsx      # Slide-up modal wrapper
│   │   │   ├── PhoneInput.jsx       # +91 prefix + 10-digit field with validation
│   │   │   ├── CountdownTimer.jsx   # Slot hold (2 min) and OTP resend (59 s)
│   │   │   ├── Toast.jsx            # Success / error toast notifications
│   │   │   └── ProgressBar.jsx      # Session time-remaining bar (doctor dashboard)
│   │   │
│   │   ├── patient/                 # Patient-facing screens
│   │   │   ├── BookingPage.jsx      # 28-day date strip + Morning / Evening slot grids
│   │   │   ├── BookingSheet.jsx     # Name / phone / reason form + 2-min hold countdown
│   │   │   ├── OTPSheet.jsx         # OTP verify — shared for booking, lookup, and cancel
│   │   │   ├── DuplicateAlert.jsx   # One-per-date warning + cancel-and-rebook flow
│   │   │   ├── LookupSheet.jsx      # Find appointment by phone number
│   │   │   ├── AppointmentCard.jsx  # Upcoming appointment + most recent past visit
│   │   │   └── SuccessScreen.jsx    # Post-booking confirmation screen
│   │   │
│   │   ├── doctor/                  # Doctor-facing screens
│   │   │   ├── OTPGate.jsx          # Full-screen morning unlock overlay
│   │   │   ├── SetupPage.jsx        # WhatsApp pairing code (live via Socket.io) + Google OAuth (one-time)
│   │   │   ├── DashboardPage.jsx    # Today's timeline + logout button
│   │   │   ├── AppointmentSlot.jsx  # One timeline row: done / active / next / upcoming
│   │   │   ├── NotesSheet.jsx       # Live consultation notes + send + character counter
│   │   │   ├── BrowsePanel.jsx      # Date chips + HTML5 date picker + per-date list
│   │   │   ├── StatsSheet.jsx       # Past and future metrics tabs
│   │   │   └── SettingsPanel/
│   │   │       ├── index.jsx        # Gear slide-over wrapper
│   │   │       ├── CancellationEngine.jsx   # Cancel entire day or individual slots
│   │   │       └── WeeklySchedule.jsx       # Day-level on/off toggles
│   │   │
│   │   ├── api/                     # All HTTP calls from React to the Python backend
│   │   │   ├── appointments.js      # getSlots, placeHold, bookSlot, cancelSlot, getByPhone
│   │   │   ├── auth.js              # sendOTP, verifyOTP (patient and doctor)
│   │   │   ├── doctor.js            # getSchedule, getStats, cancelDay, cancelSlots
│   │   │   ├── schedule.js          # getWeeklySchedule, saveWeeklySchedule
│   │   │   └── notes.js             # sendConsultationNote
│   │   │
│   │   └── utils/
│   │       ├── phone.js             # E.164 format helpers (strip / format for display vs storage)
│   │       ├── date.js              # IST-aware date and time helpers
│   │       ├── session.js           # Patient session store (inactivity + end-of-day expiry)
│   │       └── constants.js         # SLOT_DURATION=15, BOOKING_WINDOW_DAYS=28, CUTOFF_MIN=60
│   │
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── backend/                         # Python 3.11+ FastAPI
│   ├── main.py                      # App factory, CORS settings, router registration
│   ├── database.py                  # SQLite connection via aiosqlite; schema init on startup
│   ├── models.py                    # Table definitions
│   ├── schemas.py                   # Pydantic v2 request and response models
│   │
│   ├── routers/
│   │   ├── appointments.py          # GET /slots, POST /hold, POST /book, DELETE /cancel, GET /lookup
│   │   ├── auth.py                  # POST /otp/send, POST /otp/verify (patient + doctor)
│   │   ├── doctor.py                # GET /doctor/schedule, GET /doctor/stats
│   │   ├── schedule.py              # GET /doctor/weekly-schedule, PUT /doctor/weekly-schedule
│   │   ├── cancellation.py          # POST /doctor/cancel-day, POST /doctor/cancel-slots
│   │   └── setup.py                 # GET /setup/google-status, GET /setup/google-auth,
│   │                                # GET /oauth2callback  (Google OAuth redirect handler)
│   │
│   ├── services/
│   │   ├── otp_service.py           # Generate, store, validate 4-digit OTPs; TTL + rate limits
│   │   ├── whatsapp_client.py       # Async HTTP client to the Node.js WhatsApp worker
│   │   │                            # Selects random template and injects placeholders before sending
│   │   ├── google_contacts.py       # Google People API: add_contact(), wipe_contact()
│   │   │                            # Handles OAuth token refresh automatically
│   │   ├── scheduler.py             # APScheduler jobs:
│   │   │                            #   1. 60-min reminder WhatsApp message
│   │   │                            #   2. 5-min-before contact add (Google People API)
│   │   │                            #   3. slot-start + 30 min → contact wipe + status = done
│   │   ├── hold_service.py          # Place, release, and expire 2-minute slot holds
│   │   └── slot_rules.py            # One-per-date check, 1-hour cut-off, 28-day window validation
│   │
│   ├── data/
│   │   └── clinic.db                # SQLite database file
│   │
│   ├── migrations/
│   │   └── 001_initial_schema.sql   # Run once on first deploy to create all tables
│   │
│   ├── requirements.txt             # fastapi, uvicorn, aiosqlite, apscheduler,
│   │                                # google-api-python-client, google-auth-oauthlib,
│   │                                # httpx, bcrypt, python-dotenv
│   └── .env.example
│       # DOCTOR_PHONE=91XXXXXXXXXX
│       # DOCTOR_NAME="Dr. Lakshmi Sagar"
│       # WHATSAPP_WORKER_URL=http://localhost:3001
│       # GOOGLE_CLIENT_ID=...
│       # GOOGLE_CLIENT_SECRET=...
│       # GOOGLE_REFRESH_TOKEN=...          # Populated after one-time OAuth flow
│       # DOCTOR_EMERGENCY_PIN_HASH=...     # bcrypt hash; fallback when WhatsApp is offline
│       # OTP_TTL_SECONDS=300
│       # SESSION_INACTIVITY_MINUTES=10
│
└── whatsapp-worker/                 # Node.js 20 + whatsapp-web.js + Express + Socket.io
    ├── server.js                    # Express + Socket.io on same port
    │                                # REST:      POST /send-message  (enqueues; returns immediately)
    │                                # Socket.io: emits pairing_code / auth_ready / auth_disconnected
    ├── messageQueue.js              # FIFO send queue; max 10 in-flight; random 30–60 s delay
    ├── templates.js                 # 3 rotating message templates per type
    │                                # (Python backend selects template and injects placeholders;
    │                                #  worker only sends the final message string)
    ├── pairingBroadcast.js           # Calls requestPairingCode(); broadcasts pairing_code / auth_ready / auth_disconnected
    ├── session/                     # Persisted WhatsApp session files (gitignored)
    ├── package.json
    └── README.md                    # Deploy instructions for Render / Hugging Face Spaces
```

---

## Database Schema

```sql
-- Appointment slots (seed + live bookings)
CREATE TABLE appointments (
  id                           TEXT PRIMARY KEY,     -- UUID v4
  slot_time                    TEXT NOT NULL,        -- ISO 8601 with +05:30, e.g. '2026-05-19T10:15:00+05:30'
  patient_name                 TEXT,
  patient_phone                TEXT,                 -- E.164 pure digits, e.g. '919876543210'
  reason                       TEXT,
  status                       TEXT NOT NULL DEFAULT 'available',
                                                     -- available | held | booked | done | cancelled
  hold_expires_at              TEXT,                 -- ISO 8601; NULL when slot is not held
  google_contact_resource_name TEXT,                 -- 'people/c12345678' if app added the contact;
                                                     -- NULL if pre-existing or not yet added
  created_at                   TEXT,
  updated_at                   TEXT
);

-- Which days of the week the clinic operates
CREATE TABLE weekly_schedule (
  day_of_week    INTEGER PRIMARY KEY,   -- 0 = Monday … 6 = Sunday
  is_open        INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT NOT NULL          -- ISO date; always 28 days after the save date
);

-- OTP tokens (patient and doctor)
CREATE TABLE otp_tokens (
  id          TEXT PRIMARY KEY,
  phone       TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL,            -- booking | lookup | cancel | doctor_login
  expires_at  TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0
);

-- Consultation notes sent via WhatsApp (for stats: "notes sent" count)
CREATE TABLE notes_log (
  id              TEXT PRIMARY KEY,
  appointment_id  TEXT NOT NULL REFERENCES appointments(id),
  sent_at         TEXT NOT NULL
);
```

---

## WhatsApp Anti-Ban Rules

Every outgoing message through the WhatsApp worker must follow these rules to avoid account
suspension by Meta.

### Rule 1 — Stagger sends; never batch
All outbound messages go through a single FIFO queue in `messageQueue.js`. One message is sent at
a time. A **random delay of 30–60 seconds** is applied between each send. Bulk operations (e.g.,
cancelling a full day with 8 patients) fan out over 4–8 minutes, not instantly.

### Rule 2 — Rotate 3 templates per message type
A single rigid template for every patient is a Meta spam signal. The Python backend picks one of
3 phrasings at random, injects the dynamic placeholders, and sends the final string to the worker.

**Booking confirmation (3 variants):**
1. "Hi {patient_name}! Your appointment with {doctor_name} is confirmed for {date} at {time} IST. Please keep WhatsApp open — the doctor will call you directly. See you then! 🩺"
2. "Hello {patient_name}, you're all set! {doctor_name} will call you on WhatsApp at {time} on {date}. No need to do anything — just make sure your phone is reachable."
3. "Confirmed ✅ {patient_name}, your slot with {doctor_name} is locked in for {date} at {time}. The doctor will reach out directly via WhatsApp video at that time."

**1-hour reminder (3 variants):**
1. "Hi {patient_name}! Just a reminder — your appointment with {doctor_name} is in about 1 hour, at {time} today. Please keep WhatsApp open and your phone nearby. 📱"
2. "Hello {patient_name}, your call with {doctor_name} starts at {time} today. Make sure you're in a quiet spot with good connectivity — the doctor will call you on WhatsApp shortly."
3. "Quick heads-up, {patient_name}! Your appointment is at {time} today with {doctor_name}. Stay close to your phone — the WhatsApp call is coming your way soon. 🕐"

**Cancellation notification (3 variants):**
1. "Hi {patient_name}, we're sorry — your appointment with {doctor_name} on {date} at {time} has been cancelled. Please rebook at your convenience."
2. "Hello {patient_name}. Unfortunately, your slot with {doctor_name} on {date} at {time} is no longer available. You can book a new appointment on the same link."
3. "Update for {patient_name}: your appointment with {doctor_name} scheduled for {date} at {time} has been cancelled. We apologise for any inconvenience — please rebook when ready."

---

## Google OAuth Setup (Local Development)

For the one-time Google People API authorization (US-10):

1. Create an OAuth 2.0 Client ID in Google Cloud Console.
2. Set **Authorized JavaScript origins**: `http://localhost:8000`
3. Set **Authorized redirect URIs**: `http://localhost:8000/oauth2callback`
   _(Google requires an exact port match. If FastAPI runs on a different port, update both here and in `.env`.)_
4. During the OAuth consent screen, an **"Unverified App" warning** will appear — this is expected for local development. Click **Advanced → Go to [Project Name] (unsafe)** to proceed.
5. After authorization, the backend prints the refresh token to the terminal. Copy it into `.env` as `GOOGLE_REFRESH_TOKEN`.

In production, register the deployed backend URL as an additional redirect URI in Google Cloud Console.

---

## User Stories

The following 20 stories describe every feature of the system. Each story is written to be testable
and implementation-agnostic.

---

### US-01 — Patient browses available appointment slots

**User story**
As a patient, I want to see which 15-minute appointment slots are free across the next 28 days,
so that I can choose a time that suits me.

**Acceptance criteria**
- Page loads without login and shows a scrollable 28-day date strip starting from today.
- Days the doctor has marked unavailable are grayed-out and non-tappable.
- Each available working day shows a Morning session (10:00 AM–12:00 PM) and an Evening session
  (4:00 PM–7:00 PM), each displayed as a grid of 15-minute pills.
- Pill states: **Available** (white, tappable) · **Held** (amber/muted, non-tappable) ·
  **Taken** (gray, non-tappable).
- Slots starting within 1 hour of now are non-tappable (booking cut-off enforced client-side and
  server-side).
- Tapping an available slot highlights it; tapping another switches the highlight.
- A sticky "Confirm · {Day} {Date}, {Time}" button appears only when a slot is selected.

**Edge cases worth thinking about**
- All slots on a day are taken or held → day is still selectable but shows "Fully booked."
- A held slot's 2-minute timer expires while the patient is watching the page → slot transitions
  back to Available without a full page reload (polling every ~15 seconds is sufficient).
- Patient's device timezone differs from IST → all times still display in IST.

**Out of scope**
Filtering by symptom or speciality. Multi-doctor calendars. Slot pricing.

---

### US-02 — Patient books a new appointment (with 2-minute slot hold)

**User story**
As a patient, I want my chosen slot to be held for 2 minutes while I fill in my details and verify
my OTP, so that I cannot lose the slot to another patient mid-booking.

**Acceptance criteria**
- Tapping "Confirm" on a slot immediately places a 2-minute hold in the database; the slot shows
  as "Held" to all other patients on the booking page.
- A visible countdown timer (e.g., "1:47 remaining") is shown inside the booking sheet.
- Booking sheet collects: Full Name (required), 10-digit Indian mobile number (required), Reason
  for visit (optional). The "+91" prefix is fixed; the patient types 10 digits only.
- Empty name or invalid number → inline red error shown; hold timer keeps running.
- Valid submit → 4-digit OTP sent to patient's WhatsApp within 30 seconds.
- 4 OTP input boxes: auto-advance on digit entry; backspace moves focus back. "Verify & Complete
  Action" button is disabled until all 4 boxes are filled.
- Correct OTP before hold expires → slot status → "booked" in DB → success screen shown.
- Hold expires before OTP verified → booking sheet closes; patient sees: "Your reservation
  window has closed. Please choose another available slot."
- Incorrect OTP → error message; patient can retry or request resend (59-second cooldown) within
  remaining hold time.
- After OTP is verified, the patient's session is "identified" for the rest of the browser
  session (no repeat OTP prompts; subject to 10-min inactivity and 11:59 PM IST expiry rules).

**Edge cases worth thinking about**
- Double-tap submit → server is idempotent; one hold and one booking created.
- WhatsApp OTP delivery fails (number not on WhatsApp) → clear error shown; hold released;
  patient must try again.
- Same phone number already has a booking on the same calendar date → the duplicate flow
  (US-06) triggers before the booking sheet opens; no hold is placed yet.
- Two patients select the same slot simultaneously → first POST /hold wins; second receives
  "slot just taken, please choose another" error.

**Out of scope**
Email OTP. Persistent patient account across multiple days.

---

### US-03 — Patient receives WhatsApp booking confirmation

**User story**
As a patient, I want to receive a WhatsApp message confirming my appointment immediately after
booking, so that I have a written record without screenshotting.

**Acceptance criteria**
- Within 60 seconds of successful OTP verification, the patient's WhatsApp receives a message
  containing: doctor name, appointment date (written out, e.g., "Tuesday, 19 May 2026"),
  appointment time (IST), and that the doctor will call directly on WhatsApp.
- Message is plain text (no markdown formatting).
- Message is sent even if the patient closes the browser immediately after the OTP screen.
- WhatsApp worker retries up to 3 times (30-second gaps) on delivery failure; logs persistent
  failure without crashing.
- One of 3 message templates is selected at random (see Anti-Ban Rules).

**Out of scope**
Rich media (images, PDFs) in confirmation. SMS as a fallback channel.

---

### US-04 — Patient looks up an existing appointment

**User story**
As a patient, I want to find my appointment by entering my phone number (with OTP only if my
session has expired), so that I can view my booking at any time without remembering anything else.

**Acceptance criteria**
- "Manage Appointment" button opens a lookup sheet.
- If the patient's session is already identified (OTP verified earlier in this session), skip the
  OTP step and show the appointment directly.
- If not identified: patient enters 10-digit number → "Find My Records" button (disabled until
  exactly 10 digits) → OTP sent → verified → records shown; session now identified.
- Records shown: upcoming appointment (date, time, status "Confirmed") and most recent past visit.
- No appointment found for that number → "No upcoming appointments found."

**Edge cases worth thinking about**
- OTP gate prevents cross-lookup: only the number that received the OTP code can view the records
  associated with it.

**Out of scope**
Full appointment history beyond the most recent past visit. Editing appointment details from this
screen.

---

### US-05 — Patient cancels an appointment

**User story**
As a patient, I want to cancel my upcoming appointment so that the slot is freed for someone else
and I receive a WhatsApp confirmation of the cancellation.

**Acceptance criteria**
- Cancel button is shown only for appointments that can still be cancelled: before 11:59 PM IST
  the night before the appointment date.
- If the appointment is for today, or the cancel window has passed → button is disabled with the
  message: "Cancellations must be made by 11:59 PM the night before your appointment."
- A confirmation step shows the appointment details and requires "Yes, Cancel" before acting.
- On confirm → slot status → "available" in DB; patient receives a WhatsApp cancellation
  message within 60 seconds; "Back to Booking" button is shown.

**Edge cases worth thinking about**
- Double-tap "Yes, Cancel" → idempotent; cancellation happens once.
- If the 5-min-before contact-add (US-18) has already fired by the time the patient cancels →
  backend must call Google People API to wipe the contact immediately rather than waiting for the
  scheduled wipe time.

**Out of scope**
Refunds (no payments in this system). Rescheduling in a single step (patient books fresh after
cancelling).

---

### US-06 — System enforces one appointment per calendar date

**User story**
As the system, I want to prevent a patient (identified by phone number) from holding two
appointments on the same calendar date, so that scheduling remains fair to all patients.

**Acceptance criteria**
- Before placing a hold on a new slot, the server checks whether that phone number already has a
  "booked" appointment on the same calendar date (date-month-year, IST).
- If a duplicate is found → the "One Appointment per Day" alert sheet is shown before the booking
  sheet opens; no hold is placed yet.
- "Keep Existing Appointment" → sheet closes; no hold placed; nothing changes.
- "Cancel Existing & Rebook" → the existing appointment is cancelled and the hold is placed on the
  new slot in a single atomic server operation, followed by one OTP flow and one WhatsApp
  confirmation for the new booking.
- Past appointments on the same calendar date do NOT trigger the alert.

**Edge cases worth thinking about**
- Race between cancelling the old slot and placing the new hold → server-side atomic transaction
  (SQLite's immediate transaction mode).

**Out of scope**
Exceptions for family members sharing one phone number.

---

### US-07 — Patient receives a WhatsApp reminder 1 hour before appointment

**User story**
As a patient, I want to receive a WhatsApp reminder one hour before my appointment so that I
remember to keep my phone nearby and WhatsApp open.

**Acceptance criteria**
- Background scheduler fires 60 minutes before each booked slot (IST time-aware).
- One of 3 reminder templates is selected at random; patient name and time are injected.
- Reminder is not sent if the appointment was cancelled before the reminder window.
- Scheduler reloads all pending reminder jobs from the database on server restart.
- If an appointment is booked with less than 60 minutes until the slot → no reminder is sent
  (the booking still completes normally).

**Out of scope**
Reminders at other time intervals. Patient ability to opt out of reminders.

---

### US-08 — Doctor logs into the dashboard with WhatsApp OTP

**User story**
As a doctor, I want to enter a 4-digit WhatsApp OTP each time I open or refresh the dashboard,
so that my patient schedule is protected if my device is left unattended.

**Acceptance criteria**
- The dashboard URL is always behind the OTP gate; no stored cookie bypasses a full page load.
- On page load: a full-screen modal appears; a 4-digit OTP is automatically sent to the doctor's
  registered WhatsApp number.
- Correct OTP → modal dismissed; dashboard shown.
- Wrong OTP → error message; resend link available after a 59-second countdown.
- Session does NOT re-lock on inactivity. Re-locks only on full page reload or manual logout.
- A "Log Out" button is always visible on the dashboard. Pressing it kills the session and returns
  to the OTP screen.
- Emergency fallback: a static PIN stored as a bcrypt hash in `.env` (`DOCTOR_EMERGENCY_PIN_HASH`)
  can be entered instead if WhatsApp is offline. The UI accepts this on the same OTP screen.

**Edge cases worth thinking about**
- Rapid page reloads generate multiple OTPs → only the most recently issued OTP is valid.

**Out of scope**
Role-based access (single-doctor system). "Remember this device" persistent sessions.

---

### US-09 — Doctor completes one-time WhatsApp engine pairing-code setup (live via Socket.io)

**User story**
As a doctor, I want to see an 8-character pairing code on my setup page, so that I can link the
cloud engine to my WhatsApp account by entering it on my phone — without scanning a QR code or
needing a secondary screen.

**Why Socket.io (not polling)**
`whatsapp-web.js` delivers the pairing code as a string via an async callback. Socket.io pushes
it to the setup page the instant it is available, with no polling round-trip. If the doctor's
browser reconnects, the last emitted code is re-sent immediately.

**Why pairing code (not QR)**
The pairing code flow (`client.requestPairingCode(phoneNumber)`) requires no camera, no
secondary monitor, and no QR rendering library on the frontend. A plain text string displayed
on-screen is sufficient. It is also more reliable: QR codes expire every ~20 seconds, whereas
pairing codes are valid for ~160 seconds, giving the doctor ample time to switch to their phone.
No secondary monitor or screen is required — this setup is fully compatible with mobile-only
configurations.

> **Library version requirement:** `client.requestPairingCode()` is only available in the latest
> versions of `whatsapp-web.js` (or its active community fork `wwebjs`). Running it on an older
> version will throw `TypeError: client.requestPairingCode is not a function`. Additionally,
> Puppeteer must launch a modern Chromium build — old browser versions do not render the
> "Link with phone number instead" element that the library's internal automation relies on.
> Always pin `whatsapp-web.js` to the latest release in `package.json`.

**Acceptance criteria**
- The Node.js WhatsApp worker runs Socket.io on the same port as Express.
- After `client.initialize()` completes, the worker calls
  `await client.requestPairingCode(DOCTOR_PHONE)` to request a pairing code. The call is
  wrapped in try/catch; any error is logged and surfaced to the frontend as an
  `auth_error` event.
- When the code is returned, the worker emits `pairing_code` with the 8-character string to all
  connected Socket.io clients.
- When authentication succeeds (doctor entered the code on their phone), worker emits `auth_ready`.
- When the session disconnects (doctor unlinks device from WhatsApp), worker emits
  `auth_disconnected`.
- The doctor's `SetupPage.jsx` connects to the worker's Socket.io endpoint when the setup page is
  visible and disconnects when the doctor navigates away.
- On `pairing_code`: display the received 8-character string as large, styled text (e.g.,
  `ABCD-1234`). No QR image rendering or external QR library needed.
- On `auth_ready`: hide the code; show "WhatsApp Connected ✓."
- On `auth_disconnected`: show "Session lost — re-link required."
- **Doctor's phone steps:** WhatsApp → Settings → Linked Devices → Link a Device → tap
  **"Link with phone number instead"** at the bottom of the camera view → enter the
  8-character code shown on the setup page.
- This setup is independent of the daily OTP login (US-08).

**Edge cases worth thinking about**
- Doctor loses network before entering code → Socket.io auto-reconnects; worker re-emits the
  latest code on reconnect.
- Pairing code expires (~160 s) before the doctor enters it → worker calls
  `requestPairingCode()` again and emits a fresh `pairing_code` event.
- Corrupted session file → worker deletes it on startup and requests a fresh pairing code.
- Multiple browser tabs open on the setup page → all display the same code; entering it from
  any device works.
- Old `whatsapp-web.js` version installed → `requestPairingCode` throws immediately; worker
  logs the error and emits `auth_error`; the setup page shows "Pairing code generation failed
  — check worker logs."

**Out of scope**
Multiple WhatsApp numbers per doctor. WhatsApp Business API (paid).

---

### US-10 — Doctor completes one-time Google Contacts OAuth setup

**User story**
As a doctor, I want to authorize the app once to manage my Google Contacts, so that the system
can automatically add and wipe patient numbers around each appointment.

**Acceptance criteria**
- A setup page in the doctor dashboard shows a "Connect Google Contacts" button.
- Tapping it initiates the Google OAuth 2.0 authorization flow with scope:
  `https://www.googleapis.com/auth/contacts`.
- The FastAPI backend handles the OAuth redirect at `GET /oauth2callback`
  (local dev: `http://localhost:8000/oauth2callback`; production: `https://{domain}/oauth2callback`).
  Both the Authorized JavaScript origin and redirect URI must be registered in Google Cloud Console
  with an exact port match.
- After the doctor grants access, the backend stores the refresh token securely. Access tokens are
  obtained on-demand using the stored refresh token; no re-authorization is needed unless the
  doctor revokes access.
- Setup page shows "Google Contacts: Connected ✓" with the authorized account email.
- If the token is later revoked → page shows a "Reconnect" prompt.
- During local development, an "Unverified App" warning from Google is expected and normal. The
  doctor clicks "Advanced → Go to [Project Name] (unsafe)" to proceed.

**Edge cases worth thinking about**
- Doctor uses a personal Google account (not Workspace) → standard user-level OAuth 2.0 is the
  correct flow; no service account or domain-wide delegation is needed.
- `redirect_uri_mismatch` error → the port in the Google Cloud Console registration must exactly
  match the port the backend is running on.

**Out of scope**
Multiple Google accounts. Service account / domain-wide delegation setup.

---

### US-11 — Doctor views today's appointment schedule in real time

**User story**
As a doctor, I want to see all of today's appointments in a chronological timeline with live
status labels, so that I always know who is active, who is next, and what remains.

**Acceptance criteria**
- Timeline shows all booked slots for today in time order.
- Each slot displays: time, patient name, phone number, reason for visit, and a status pill.
- Status pills: **DONE** (past slots) · **ACTIVE NOW** (current 15-min window) · **NEXT UP**
  (immediately next slot) · **UPCOMING** (all later slots).
- The ACTIVE NOW slot is visually prominent: pulsing green dot, green highlight, "Start WhatsApp
  Call" button, and an animated session progress bar showing time elapsed and remaining.
- DONE slots are visually muted (lower opacity).
- Status labels update automatically — no manual page refresh required.
- No appointments today → "No appointments scheduled for today."

**Edge cases worth thinking about**
- Doctor opens the page after all appointments are done → all DONE; no progress bar shown.
- Clock skew between server and browser → server time is authoritative for all status calculations.

**Out of scope**
Editing appointment details from the timeline. Showing other days' appointments in the today view.

---

### US-12 — Doctor starts a WhatsApp call with the active patient

**User story**
As a doctor, I want to tap one button to open WhatsApp pre-filled with the active patient's
number, so that I can start the call without searching for their contact manually.

**Acceptance criteria**
- "Start WhatsApp Call" button is visible only on the ACTIVE NOW slot.
- Tapping it opens WhatsApp via `whatsapp://send?phone={E.164}` deep-link.
- The button is absent on DONE, NEXT UP, and UPCOMING slots.
- If WhatsApp is not installed on the doctor's device → deep-link fails; the patient's phone
  number is shown as plain text as a fallback so the doctor can dial manually.

**Out of scope**
In-browser calling. Auto-dialling without the doctor tapping the button.

---

### US-13 — Doctor sends live consultation notes to patient via WhatsApp

**User story**
As a doctor, I want to type observations during a call and push them to the patient's WhatsApp
instantly, so that the patient has a written record without waiting for a follow-up.

**Acceptance criteria**
- "Live Consultation Notes" card on the dashboard opens a bottom sheet.
- Sheet shows the active patient's name and appointment time.
- A character counter is visible below the textarea at all times, counting down from 4096
  (e.g., "3,847 characters remaining"), styled like a Twitter/X character count.
  - Counter turns amber as it approaches 0.
  - Counter turns red and shows the overage (e.g., "−12") when the limit is exceeded.
  - "Send Notes to Patient" button is disabled while over the limit.
- Empty textarea → "Send" button disabled.
- "Send Notes to Patient" → backend → WhatsApp worker `POST /send-message` → patient receives
  the message.
- Button shows green "Notes Sent!" state for 3 seconds, then reverts; a toast confirms:
  "Notes sent via WhatsApp · [Patient name] will receive them shortly."
- No active patient (between slots or all done) → sheet shows "No active session."

**Edge cases worth thinking about**
- Text exactly at 4096 characters → allowed; send proceeds.
- WhatsApp worker timeout → error toast shown; doctor can retry.

**Out of scope**
File or image attachments. Storing notes as a permanent medical record.

---

### US-14 — Doctor browses appointments by any date

**User story**
As a doctor, I want to look up the appointment list for any past or future date so that I can
prepare for upcoming sessions or review previous ones.

**Acceptance criteria**
- "Browse Appointments by Date" accordion is expandable within the dashboard.
- A horizontal 10-day chip row provides quick selection; an HTML5 date picker allows any date
  outside the chip range.
- Selecting a date shows: time, patient name, reason for visit, and status for each appointment.
- No appointments on the selected date → "No appointments on this date."

**Out of scope**
Editing or rescheduling appointments from the browse view.

---

### US-15 — Doctor cancels all appointments on a given day

**User story**
As a doctor, I want to cancel every appointment on a chosen day and automatically notify each
patient via WhatsApp, so that I can block emergency leave without contacting each person manually.

**Acceptance criteria**
- "Cancel Entire Selected Day" scope is available in the Settings gear panel (Precision
  Cancellation Engine).
- After the doctor picks a target date, a preview appears: "All X appointments on {date} will be
  cancelled and patients notified via WhatsApp."
- If the chosen date has zero bookings → "No booked appointments on that day" is shown before any
  confirm button is enabled.
- If the chosen date includes an ACTIVE NOW slot → an extra warning is shown before the confirm
  button is enabled.
- On confirm → all booked slots set to "available"; each affected patient receives a WhatsApp
  cancellation message (via the anti-ban queue; may take up to several minutes for large lists).
- If the 5-min contact-add (US-18) has already fired for any slot being cancelled → the backend
  must wipe those contacts immediately as part of the cancellation.
- A success splash is shown after the action is triggered.

**Out of scope**
Auto-rebooking patients on another date.

---

### US-16 — Doctor cancels individual time slots on a given day

**User story**
As a doctor, I want to cancel specific time slots on a chosen day and notify only those affected
patients, so that I can free part of my schedule without disrupting the rest.

**Acceptance criteria**
- "Select Individual Slots to Cancel" scope shows a checkbox grid of all booked slots on the
  chosen date.
- Preview summary updates dynamically: "{count} slot(s) on {date} will be released and patients
  alerted via WhatsApp."
- Zero checkboxes selected → confirm button disabled.
- On confirm → only selected slots set to "available"; unselected slots unchanged; each affected
  patient receives a WhatsApp cancellation notice.
- If Google contact was already added for a cancelled slot → wipe it immediately.
- If an ACTIVE NOW slot is selected → extra warning shown before confirm is enabled.

**Out of scope**
Partial-slot cancellation (e.g., cutting a 15-min slot to 7 min).

---

### US-17 — Doctor manages weekly availability

**User story**
As a doctor, I want to toggle which days of the week my clinic is open so that the patient booking
page automatically disables unavailable days going forward.

**Acceptance criteria**
- Weekly Schedule Management section (in the Settings gear panel) shows Monday–Sunday with on/off
  toggles; current state is loaded from the database.
- Info banner: "Changes take effect after 28 days. Since patients book at most 28 days ahead, no
  existing booking is ever affected."
- "Save Schedule Changes" button appears only when the current toggle state differs from the saved
  state.
- On save → new schedule persisted to DB; success splash shown; patient booking page reflects
  the updated availability from the effective date onward.

**Edge cases worth thinking about**
- Doctor toggles a day off then immediately back on before saving → "Save" button disappears; no
  change is recorded.

**Out of scope**
Different session hours per day (day-level on/off only). Holiday-specific blocks — use US-15 for
those.

---

### US-18 — System adds patient to doctor's Google Contacts 5 minutes before appointment

**User story**
As the system, I want to automatically add a patient's phone number to the doctor's Google
Contacts 5 minutes before their appointment begins, so that the doctor can initiate a WhatsApp
call and the patient's name appears correctly on the doctor's Android phone.

**Acceptance criteria**
- Background scheduler checks every minute for appointments starting within 5 minutes.
- For each found appointment:
  1. Search the doctor's Google Contacts for the patient's phone number.
  2. If the number is **not** present: call Google People API `POST /v1/people:createContact` with
     the patient's name and phone (E.164 format). Store the returned `resourceName` (e.g.,
     `people/c12345678`) in `appointments.google_contact_resource_name`.
  3. If the number is **already** present: leave it untouched; `google_contact_resource_name`
     stays NULL.
- Operation is idempotent: firing twice for the same appointment creates no duplicate contact.
- Scheduler reloads pending jobs from the database on server restart.
- Google Contacts sync ensures the new contact appears in WhatsApp on the doctor's Android phone
  within seconds of being added.

**Edge cases worth thinking about**
- Google People API offline or token expired → retry with a fresh access token; if still failing,
  log and continue (the call can proceed without a named contact in the address book).
- Appointment cancelled after contact is added → backend wipes the contact immediately (see US-19
  edge case in US-05).
- Multiple appointments in the same 5-minute window → add contacts sequentially (Google API
  requires sequential writes for the same user to avoid conflicts).

**Out of scope**
UI indicator to the doctor that the contact was added. Adding information beyond name and phone.

---

### US-19 — System wipes patient from doctor's Google Contacts after appointment ends

**User story**
As the system, I want to automatically remove a patient's phone number from the doctor's Google
Contacts 15 minutes after their appointment slot ends, so that the doctor is protected from
unsolicited contact while still having a short natural wind-down buffer after the call.

**Acceptance criteria**
- Wipe fires at: slot start time + 15 min (slot duration) + 15 min (buffer) = slot start + 30 min.
  Example: slot at 10:15 AM → wipe at 10:45 AM.
- Backend checks `google_contact_resource_name` for the appointment.
- If a `resourceName` is stored (contact was added by the app): call Google People API
  `DELETE /v1/{resourceName}:deleteContact`.
- Clear `google_contact_resource_name` from the appointment row; set status to "done."
- If `google_contact_resource_name` is NULL (pre-existing contact) → do NOT delete; leave it
  completely untouched.
- Idempotent: calling the delete endpoint twice does not error.

**Edge cases worth thinking about**
- Google People API offline at wipe time → retry every 30 seconds for up to 10 minutes; log
  persistent failure.
- Doctor still on a call at wipe time → wipe fires; the active WhatsApp call is not terminated
  by the contact deletion (existing calls are not affected by contact list changes).
- Appointment cancelled before the scheduled wipe → contact is wiped immediately during the
  cancellation flow; the scheduled wipe job is cancelled or becomes a no-op.

**Out of scope**
Notifying the patient that their window has closed. Doctor-initiated session extension.

---

### US-20 — Doctor views appointment statistics

**User story**
As a doctor, I want to see a summary of past and upcoming appointment metrics so that I can
understand my clinic's workload at a glance.

**Acceptance criteria**
- A Stats sheet is accessible from the dashboard with "Past" and "Future" tabs.
- **Past tab** shows: total completed this month, completed this week, average session duration,
  patient-initiated cancellations, doctor-initiated cancellations, WhatsApp notes sent.
- **Future tab** shows: total forward bookings (next 28 days), confirmed this week, next
  available slot, first fully-booked day, average daily load forecast.
- All numbers are computed from the live database; a brand-new install shows zeros gracefully.
- Switching between tabs updates the displayed data without closing the sheet.

**Edge cases worth thinking about**
- "WhatsApp notes sent" requires a separate `notes_log` table (a counter column on `appointments`
  is too fragile for long-term tracking).

**Out of scope**
Exporting stats to CSV or PDF. Per-patient visit history visible from this panel. Referral
tracking (not in the data model).

---

## Resolved Design Decisions

| Decision | Resolution |
|---|---|
| Booking cut-off | 1 hour before slot start time |
| One-per-day uniqueness key | Phone number + calendar date (date-month-year, IST) |
| Patient cancellation deadline | 11:59 PM IST the night before the appointment date |
| Slot length | Always 15 minutes |
| Patient booking window | Next 28 days only |
| Doctor session re-lock | Page reload or manual logout only; not on inactivity |
| Weekly schedule change conflict | Impossible — 28-day booking window equals 28-day grace period |
| Referrals metric | Dropped — not tracked in the data model |
| Notes log | Separate `notes_log` table (not a counter column) |
| Hosting target | Vercel (frontend) + Google Cloud / Render free tier (backend + worker) |
| Docker | Deferred to post-MVP |
| Contact management mechanism | Google People API — not WhatsApp block/unblock |
| WhatsApp worker endpoints | `POST /send-message` (REST) + Socket.io events for pairing only |
| Pairing code delivery mechanism | Socket.io push from the Node.js worker directly to the doctor's browser; doctor enters 8-char code on phone instead of scanning a QR |
| Pre-existing contacts | Never wiped; only contacts added by the app are removed |
| Contact add timing | 5 minutes before slot start |
| Contact wipe timing | 15 minutes after slot ends (slot start + 30 min total) |
| Anti-ban approach | Max 10 queued messages; 30–60 s random delay; 3 rotating templates per type |
| Doctor cancellation notification | Not needed — patients cancel ≥12 hours before the slot |
| Doctor session extension | Not supported — 15-min window is a hard cutoff |
| Google OAuth redirect URI (local) | `http://localhost:8000/oauth2callback`; exact port match required |
