'use strict';

/**
 * server.js — Express + Socket.io entry point for the WhatsApp worker.
 *
 * Port: 3001 (default) or process.env.PORT
 *
 * Modes (set via WHATSAPP_MODE env var):
 *   mock (default) — writes messages to mock-messages.jsonl; emits fake
 *                    pairing events to Socket.io clients. No Chromium.
 *   real            — uses whatsapp-web.js + pairingBroadcast.js. Requires
 *                     DOCTOR_PHONE env var (E.164 pure digits, e.g. 919876543210).
 *
 * REST API:
 *   POST /send-message   { to, message } → { queued: true, queue_position: N }
 *   GET  /mock/disconnect (mock mode only) → emits auth_disconnected to all clients
 *
 * Socket.io events (server → client):
 *   pairing_code      — 8-char string for WhatsApp phone linking
 *   auth_ready        — WhatsApp session authenticated
 *   auth_disconnected — session lost / logged out
 *   auth_error        — pairing code generation failed (real mode)
 */

const fs   = require('fs');
const path = require('path');
const http = require('http');

const express  = require('express');
const { Server } = require('socket.io');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: '*' }, // dev permissive; lock down in production
});

app.use(express.json());

// ── Paths ─────────────────────────────────────────────────────────────────────

// Allow test to override via env var so tests don't pollute the project root.
const MOCK_JSONL_PATH = process.env.MOCK_JSONL_PATH
  ? path.resolve(process.env.MOCK_JSONL_PATH)
  : path.join(__dirname, 'mock-messages.jsonl');

// ── Mode detection ────────────────────────────────────────────────────────────

const IS_REAL = process.env.WHATSAPP_MODE === 'real';

// ── IST timestamp helper ──────────────────────────────────────────────────────

function nowIST() {
  // Node.js doesn't natively format with offset; we compute manually.
  const now = new Date();
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + IST_OFFSET_MS);
  // Format as ISO 8601 with +05:30 suffix.
  return istDate.toISOString().replace('Z', '+05:30');
}

// ── POST /send-message ────────────────────────────────────────────────────────

let messageQueue = null; // populated in real mode

app.post('/send-message', async (req, res) => {
  const { to, message } = req.body || {};

  if (!to || typeof to !== 'string' || to.trim() === '') {
    return res.status(400).json({
      error: 'validation_error',
      message: '"to" is required and must be a non-empty string',
    });
  }
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({
      error: 'validation_error',
      message: '"message" is required and must be a non-empty string',
    });
  }

  if (!IS_REAL) {
    // ── Mock mode: write directly to JSONL, return immediately ──────────────
    const entry = JSON.stringify({ ts: nowIST(), to, message }) + '\n';
    try {
      fs.appendFileSync(MOCK_JSONL_PATH, entry, 'utf8');
    } catch (err) {
      console.error(`[mock] Failed to write to ${MOCK_JSONL_PATH}: ${err.message}`);
      return res.status(500).json({ error: 'internal_error', message: err.message });
    }
    return res.json({ queued: true, queue_position: 1 });
  }

  // ── Real mode: enqueue via MessageQueue ────────────────────────────────────
  try {
    const result = messageQueue.enqueue({ to, message });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', message: err.message });
  }
});

// ── GET /mock/disconnect — manual test hook (mock mode only) ──────────────────

app.get('/mock/disconnect', (_req, res) => {
  io.emit('auth_disconnected');
  res.json({ emitted: 'auth_disconnected' });
});

// ── Socket.io connection handler ──────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  if (!IS_REAL) {
    // Mock mode: emit fake pairing events so the doctor's SetupPage works
    // without a real WhatsApp account.
    const t1 = setTimeout(() => {
      socket.emit('pairing_code', 'ABCD-1234');
    }, 1000);

    const t2 = setTimeout(() => {
      socket.emit('auth_ready');
    }, 4000);

    socket.on('disconnect', () => {
      clearTimeout(t1);
      clearTimeout(t2);
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  } else {
    socket.on('disconnect', () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  }
});

// ── Real mode startup ─────────────────────────────────────────────────────────

if (IS_REAL) {
  const { MessageQueue } = require('./messageQueue');
  const { initPairing }  = require('./pairingBroadcast');

  const DOCTOR_PHONE = process.env.DOCTOR_PHONE;
  if (!DOCTOR_PHONE) {
    console.error('[worker] DOCTOR_PHONE env var is required in real mode. Exiting.');
    process.exit(1);
  }

  const client = initPairing(io, DOCTOR_PHONE);

  messageQueue = new MessageQueue(async (to, msg) => {
    // whatsapp-web.js expects phone in 'XXXXXXXXXXX@c.us' format.
    await client.sendMessage(`${to}@c.us`, msg);
  });

  console.log('[worker] Real mode — WhatsApp client initialising…');
} else {
  console.log('[worker] Mock mode — no WhatsApp client started.');
}

// ── Server listen ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`[worker] Listening on :${PORT} (mode=${IS_REAL ? 'real' : 'mock'})`);
  });
}

module.exports = { app, httpServer, io };
