# TeleClinic

**Single-doctor appointment management system.** Patients book 15-minute teleconsult slots; the doctor takes WhatsApp video calls. WhatsApp is the only communication channel — OTPs, confirmations, reminders, and consultation notes all flow through it.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌──────────────────────────────────┐                   │
│  │ React 18 + Vite  (port 5173)     │                   │
│  │  /          → Patient booking    │                   │
│  │  /doctor    → Doctor dashboard   │                   │
│  └──────────────┬───────────────────┘                   │
└─────────────────┼───────────────────────────────────────┘
                  │  /api/* (Vite proxy strips /api)
                  ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI  (port 8000)                                   │
│  SQLite · APScheduler · Google People API               │
└──────────────────────┬──────────────────────────────────┘
                       │  POST /send-message
                       ▼
┌─────────────────────────────────────────────────────────┐
│  WhatsApp Worker — Node.js / Express (port 3001)        │
│  whatsapp-web.js · Socket.io                            │
└─────────────────────────────────────────────────────────┘
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Python** | 3.11+ | Backend |
| **Node.js** | 20+ | Frontend + WhatsApp worker |
| **npm** | 9+ | Bundled with Node |

> **WSL / Linux tip:** Use `nvm` to install Node 20:
> ```bash
> nvm install 20 && nvm use 20
> ```

---

## Quick Start (all three services)

Open **three separate terminals** and run one service per terminal:

```bash
# Terminal 1 — Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate   # first time only
pip install -r requirements.txt                        # first time only
uvicorn main:app --reload --port 8000

# Terminal 2 — WhatsApp Worker
cd whatsapp-worker
npm install                                            # first time only
node server.js

# Terminal 3 — Frontend
cd frontend
npm install                                            # first time only
npm run dev
```

Then open:
- **Patient booking:** http://localhost:5173
- **Doctor dashboard:** http://localhost:5173/doctor

---

## First-Time Setup

### 1. Backend environment file

The backend ships with a pre-configured development `.env`. Review and customise it:

```bash
cd backend
cat .env
```

Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCTOR_PHONE` | `919876543210` | E.164 digits (no `+`) of the doctor's WhatsApp number |
| `DOCTOR_NAME` | `Dr. Priya Sharma` | Displayed in WhatsApp messages |
| `WHATSAPP_MODE` | `mock` | `mock` = log to file, no real WhatsApp; `real` = live |
| `SESSION_SECRET_KEY` | dev value | **Change in production** — min 32 chars |
| `DOCTOR_EMERGENCY_PIN_HASH` | bcrypt of `9999` | Bcrypt hash of the emergency doctor login PIN |
| `GOOGLE_CLIENT_ID` | placeholder | From Google Cloud Console (see Google OAuth setup below) |
| `GOOGLE_CLIENT_SECRET` | placeholder | From Google Cloud Console |

### 2. Frontend environment (optional)

```bash
echo "VITE_DOCTOR_PHONE=919876543210" > frontend/.env.local
```

If omitted, the frontend falls back to `919999999999` (fine for mock mode).

### 3. WhatsApp Worker environment (real mode only)

```bash
# whatsapp-worker/.env (create if needed)
WHATSAPP_MODE=real
DOCTOR_PHONE=919876543210   # E.164, no +
```

---

## Mock Mode (default for local dev)

With `WHATSAPP_MODE=mock` (the default), **no WhatsApp account or phone is needed**:

- All OTPs are always **`0000`** — just type that when any OTP prompt appears (patient booking, patient lookup, doctor login).
- The emergency doctor PIN is **`9999`** (bypasses OTP entirely for doctor login).
- WhatsApp messages are printed to the backend terminal and written to `backend/data/mock-messages.jsonl`.
- The WhatsApp worker emits a fake pairing code `ABCD-1234` and then `auth_ready` automatically.

> **After changing `.env`**, restart the backend — settings are cached at startup.

---

## Running Each Service

### Backend

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

Expected startup output:
```
[seed_slots] Slot window refreshed for the next 28 days.
INFO:     Application startup complete.
```

- API docs (Swagger): http://localhost:8000/docs
- SQLite database: `backend/data/clinic.db`
- Mock WhatsApp log: `backend/data/mock-messages.jsonl`

### WhatsApp Worker

```bash
cd whatsapp-worker
node server.js
```

**Mock mode** (default):
- No Chromium or WhatsApp account required.
- Socket.io emits fake pairing code `ABCD-1234` after 1 s and `auth_ready` after 4 s.
- Messages are written to `whatsapp-worker/mock-messages.jsonl`.

**Real mode** (`WHATSAPP_MODE=real`):
- Requires `DOCTOR_PHONE` env var.
- Starts Chromium via whatsapp-web.js on first run.
- Doctor visits `/doctor` → Setup → enters the 8-character pairing code shown in the UI into WhatsApp → Linked Devices → Link a Device.

> If the worker is not running, the Setup page will show a red error: *"WhatsApp worker not running."* The rest of the app (booking, OTPs) works fine without it in mock mode.

### Frontend

```bash
cd frontend
npm run dev
```

- Vite dev server: http://localhost:5173
- All `/api/*` requests are proxied to the FastAPI backend.
- Hot Module Replacement (HMR) is enabled.

---

## Running Tests

### Frontend (Vitest + React Testing Library)

```bash
cd frontend
npm test               # run once
npm run test:watch     # watch mode
```

Expected: **154 tests, 0 failures** across 5 test files.

### Backend (pytest + pytest-asyncio)

```bash
cd backend
source .venv/bin/activate
python3 -m pytest tests/ -v
```

Expected: **127 tests, 0 failures**. Uses an in-memory SQLite DB — no cleanup needed.

### WhatsApp Worker (Jest)

```bash
cd whatsapp-worker
npm test
```

---

## Google OAuth Setup (for Google Contacts integration)

The Google Contacts integration adds patients to the doctor's contacts 5 minutes before their appointment, then removes them 30 minutes after the slot ends. It requires a real Google Cloud OAuth client.

### Step 1 — Create a Google Cloud Project

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Click the project dropdown (top left) → **New Project**
3. Name it `TeleClinic` → **Create**

### Step 2 — Enable the People API

1. **APIs & Services → Library**
2. Search **"Google People API"** → click → **Enable**

### Step 3 — Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in: App name (`TeleClinic`), user support email, developer contact email
4. Click through Scopes (skip) and Test users
5. **Add your own Google account email** as a test user (required while app is in "Testing" status)
6. Finish

### Step 4 — Create OAuth credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `TeleClinic local`
4. Under **Authorised redirect URIs** → Add: `http://localhost:8000/oauth2callback`
5. Click **Create** — copy the **Client ID** and **Client Secret**

### Step 5 — Update `.env`

```dotenv
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:8000/oauth2callback
```

Restart the backend after editing `.env`.

### Step 6 — Authorise

1. Doctor logs in at http://localhost:5173/doctor
2. Navigate to **Setup** → click **Connect Google Contacts**
3. Browser opens Google's OAuth consent screen
4. Google may warn *"Unverified App"* — click **Advanced → Go to TeleClinic (unsafe)**
5. After consent, `GOOGLE_REFRESH_TOKEN` is saved to `backend/.env` automatically
6. The Setup page shows "Google Connected ✓"

---

## Building for Production

```bash
# Build the frontend SPA
cd frontend
npm run build          # outputs to frontend/dist/

# Serve dist/ with a static host (Nginx, Caddy, etc.)
# Point /api/* to the FastAPI backend
```

The FastAPI backend:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

> **Use `--workers 1`** — the in-memory APScheduler and single aiosqlite connection are not process-safe across multiple workers.

---

## Business Rules (non-negotiable)

| Rule | Value |
|------|-------|
| Slot length | 15 minutes |
| Booking window | 28 days from today |
| Booking cut-off | 1 hour before slot start |
| Slot hold duration | 2 minutes |
| One booking per day | Per phone number per IST calendar date |
| Cancellation deadline | 11:59 PM IST the night before |
| Timezone | All times stored as ISO 8601 `+05:30` |
| Phone format | E.164 pure digits, e.g. `919876543210` (no `+`, spaces, dashes) |

---

## Key URLs

| URL | What |
|-----|------|
| http://localhost:5173 | Patient booking page |
| http://localhost:5173/doctor | Doctor dashboard (OTP login required) |
| http://localhost:8000/docs | FastAPI Swagger UI |
| http://localhost:8000/redoc | FastAPI ReDoc |

---

## Design Reference Files

`index.html` and `doctor.html` at the repo root are **read-only UI/UX prototypes** — the original HTML design specs from which the React SPA was built. They are authoritative on all visual/interaction decisions. Do not modify or delete them; they are not served by the application.

---

## Project Structure

```
tele-clinic/
├── index.html          ← Patient UI prototype (read-only design reference)
├── doctor.html         ← Doctor UI prototype (read-only design reference)
├── instructions.md     ← Full product spec + user stories
├── technical-design.md ← API shapes, DB schema, mock strategy
│
├── backend/            ← FastAPI + SQLite
│   ├── main.py         ← Application factory + lifespan (calls seed_slots on startup)
│   ├── config.py       ← Settings (pydantic-settings, reads .env)
│   ├── database.py     ← aiosqlite connection + schema init + slot seeding
│   ├── schemas.py      ← Pydantic v2 request/response models
│   ├── routers/        ← HTTP endpoint handlers
│   │   ├── auth.py         ← POST /otp/send, POST /otp/verify
│   │   ├── appointments.py ← GET /slots, POST /hold, POST /book, DELETE, lookup
│   │   ├── doctor.py       ← GET /doctor/schedule, POST /doctor/notes, stats
│   │   ├── schedule.py     ← Weekly schedule CRUD
│   │   ├── cancellation.py ← Doctor cancel-day / cancel-slots
│   │   └── setup.py        ← Google OAuth endpoints
│   ├── services/       ← Business logic
│   │   ├── otp_service.py      ← OTP generate/verify + session tokens
│   │   ├── hold_service.py     ← 2-minute slot hold
│   │   ├── slot_rules.py       ← 28-day window, 1-hour cut-off, one-per-day
│   │   ├── whatsapp_client.py  ← Template selection + HTTP send to worker
│   │   ├── google_contacts.py  ← People API add/wipe
│   │   └── scheduler.py        ← APScheduler jobs (reminder, contact add/wipe)
│   ├── migrations/     ← SQL schema (001_initial_schema.sql)
│   └── tests/          ← pytest suite (127 tests)
│
├── frontend/           ← React 18 + Vite + Tailwind CSS
│   ├── src/
│   │   ├── App.jsx         ← Root router (/ = patient, /doctor = doctor)
│   │   ├── api/            ← fetch wrappers for all backend endpoints
│   │   ├── components/     ← Shared UI (OTPInput, BottomSheet, Toast, …)
│   │   ├── patient/        ← Patient booking flow components + tests
│   │   ├── doctor/         ← Doctor dashboard components + tests
│   │   └── utils/          ← Date/phone/session helpers + tests
│   ├── vite.config.js  ← Vite config + /api proxy + Vitest config
│   └── tailwind.config.js  ← Custom design tokens + animations
│
└── whatsapp-worker/    ← Node.js Express + Socket.io
    ├── server.js       ← Entry point, mock/real mode, /send-message endpoint
    ├── messageQueue.js ← FIFO queue: max 10 in-flight, 30–60 s random delay
    ├── pairingBroadcast.js ← Real-mode WhatsApp pairing via whatsapp-web.js
    └── templates.js    ← Source of truth for message template strings
```
