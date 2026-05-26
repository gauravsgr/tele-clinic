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
python -m venv .venv && source .venv/bin/activate   # first time only
pip install -r requirements.txt                       # first time only
uvicorn main:app --reload --port 8000

# Terminal 2 — WhatsApp Worker
cd whatsapp-worker
npm install                                           # first time only
node server.js

# Terminal 3 — Frontend
cd frontend
npm install                                           # first time only
npm run dev
```

Then open:
- **Patient booking:** http://localhost:5173
- **Doctor dashboard:** http://localhost:5173/doctor

---

## First-Time Setup

### 1. Backend environment file

The backend ships with a pre-configured development `.env`:

```bash
cd backend
# .env already exists with mock defaults — review and customise:
cat .env
```

Key settings to change for a real deployment:

| Variable | Default | Description |
|----------|---------|-------------|
| `DOCTOR_PHONE` | `919876543210` | E.164 digits (no `+`) of the doctor's WhatsApp number |
| `DOCTOR_NAME` | `Dr. Priya Sharma` | Displayed in WhatsApp messages |
| `WHATSAPP_MODE` | `mock` | `mock` = log to file, no real WhatsApp; `real` = live |
| `SESSION_SECRET_KEY` | dev value | **Change in production** — min 32 chars |
| `DOCTOR_EMERGENCY_PIN_HASH` | bcrypt of `9999` | Hash of emergency login PIN |
| `GOOGLE_CLIENT_ID` | placeholder | Google Cloud Console OAuth client |
| `GOOGLE_CLIENT_SECRET` | placeholder | Google Cloud Console OAuth client |

### 2. Frontend environment (optional)

Create `frontend/.env.local` to set the doctor's phone for the OTP gate:

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

## Running Each Service

### Backend

```bash
cd backend
source .venv/bin/activate        # activate virtualenv
uvicorn main:app --reload --port 8000
```

- API docs (Swagger): http://localhost:8000/docs
- API docs (ReDoc): http://localhost:8000/redoc
- SQLite database created at: `backend/data/clinic.db`

### WhatsApp Worker

```bash
cd whatsapp-worker
node server.js
```

**Mock mode** (default, `WHATSAPP_MODE=mock`):
- Messages are written to `whatsapp-worker/mock-messages.jsonl`
- Socket.io emits a fake pairing code `ABCD-1234` after 1 s and `auth_ready` after 4 s
- No Chromium or WhatsApp account required

**Real mode** (`WHATSAPP_MODE=real`):
- Requires `DOCTOR_PHONE` env var
- Starts Chromium via whatsapp-web.js on first run
- Doctor visits `/doctor` → Setup page → enters the 8-character pairing code shown in the UI into WhatsApp → Linked Devices → Link a Device

### Frontend

```bash
cd frontend
npm run dev
```

- Vite dev server: http://localhost:5173
- All `/api/*` requests are proxied to the FastAPI backend at `localhost:8000`
- Hot Module Replacement (HMR) is enabled

---

## Running Tests

### Frontend (Vitest + React Testing Library)

```bash
cd frontend
npm test               # run once
npm run test:watch     # watch mode (re-runs on save)
```

Expected output: **154 tests, 0 failures** across 5 test files.

### Backend (pytest + pytest-asyncio)

```bash
cd backend
source .venv/bin/activate
pytest -v
```

Tests use an in-memory SQLite database — no cleanup needed.

### WhatsApp Worker (Jest)

```bash
cd whatsapp-worker
npm test
```

---

## Building for Production

```bash
# Build the frontend SPA
cd frontend
npm run build          # outputs to frontend/dist/

# Serve the dist/ folder with a static host (Nginx, Caddy, etc.)
# Point /api/* to the FastAPI backend
```

The FastAPI backend can be deployed with:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1
```

> **Note:** Use `--workers 1` — the in-memory APScheduler and single aiosqlite connection are not process-safe across workers.

---

## Google OAuth (local dev)

1. Create a Google Cloud project → Enable **People API**
2. Create an OAuth 2.0 Client ID (type: Web application)
3. Add `http://localhost:8000/oauth2callback` as an authorised redirect URI
4. Copy client ID and secret to `backend/.env`
5. Visit http://localhost:5173/doctor → Setup → Connect Google Contacts
6. Google will show "Unverified App" — click **Advanced → Go to [Project] (unsafe)**
7. After authorisation, the `GOOGLE_REFRESH_TOKEN` is stored in `.env` automatically

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
├── technical-design.md ← API shapes, DB schema decisions
│
├── backend/            ← FastAPI + SQLite
│   ├── main.py         ← Application factory + lifespan
│   ├── config.py       ← Settings (pydantic-settings, reads .env)
│   ├── database.py     ← aiosqlite connection + schema init
│   ├── schemas.py      ← Pydantic v2 request/response models
│   ├── routers/        ← HTTP endpoint handlers
│   ├── services/       ← Business logic (OTP, hold, scheduler, WhatsApp, Google)
│   ├── migrations/     ← SQL schema (001_initial_schema.sql)
│   └── tests/          ← pytest test suite
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
