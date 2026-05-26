'use strict';

/**
 * pairingBroadcast.js — Real-mode WhatsApp pairing via whatsapp-web.js.
 *
 * Used only when WHATSAPP_MODE=real.  The mock-mode pairing simulation
 * (emitting "ABCD-1234" after 1 s, auth_ready after 4 s) lives in server.js.
 *
 * Implementation follows technical-design.md §3.4 exactly.
 *
 * Socket.io events emitted:
 *   pairing_code      — 8-character code for the doctor to type on their phone
 *   auth_ready        — session authenticated (either via saved session or new pairing)
 *   auth_disconnected — session lost / logged out
 *   auth_error        — requestPairingCode() failed; payload is a human string
 *
 * @param {import('socket.io').Server} io     Socket.io server instance
 * @param {string}                     doctorPhone  E.164 pure digits, e.g. '919876543210'
 * @returns {import('whatsapp-web.js').Client}
 */

const { Client, LocalAuth } = require('whatsapp-web.js');

function initPairing(io, doctorPhone) {
  if (!doctorPhone || typeof doctorPhone !== 'string') {
    throw new TypeError('initPairing: doctorPhone must be a non-empty string');
  }

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './session' }),
    puppeteer: {
      // Avoid sandbox issues in Docker / Render free tier.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  });

  // ── Event: session already saved → no pairing needed ─────────────────────
  client.on('ready', () => {
    console.log('[WhatsApp] Client ready — session restored, no pairing needed.');
    io.emit('auth_ready');
  });

  // ── Event: session disconnected / logged out ──────────────────────────────
  client.on('disconnected', (reason) => {
    console.log(`[WhatsApp] Session disconnected: ${reason}`);
    io.emit('auth_disconnected');
  });

  // ── Start the client ──────────────────────────────────────────────────────
  client.initialize();

  // ── Event: no saved session → request a pairing code ─────────────────────
  // 'loading_screen' fires when whatsapp-web.js has opened the browser but
  // no session exists.  This is when requestPairingCode() is available.
  client.once('loading_screen', async () => {
    try {
      // phoneDigits must be E.164 pure digits, e.g. '919876543210'
      const code = await client.requestPairingCode(doctorPhone);
      console.log(`[WhatsApp] Pairing code: ${code}`);
      io.emit('pairing_code', code);

      // When the pairing code expires, WhatsApp Web reloads its auth page.
      // whatsapp-web.js signals this by firing its legacy 'qr' event (named
      // after the old QR-scan flow).  We never display or use the QR image
      // data it carries — we only use the event as an "auth page reloaded,
      // previous code expired" signal.  Calling requestPairingCode() again
      // immediately gets a fresh 8-character text code for the doctor.
      client.on('qr', async () => {
        try {
          const fresh = await client.requestPairingCode(doctorPhone);
          console.log(`[WhatsApp] Refreshed pairing code: ${fresh}`);
          io.emit('pairing_code', fresh);
        } catch (err) {
          console.error(`[WhatsApp] Failed to refresh pairing code: ${err.message}`);
          io.emit('auth_error', 'Pairing code refresh failed — check worker logs.');
        }
      });
    } catch (err) {
      console.error(`[WhatsApp] requestPairingCode failed: ${err.message}`);
      io.emit('auth_error', 'Pairing code generation failed — check worker logs.');
    }
  });

  return client;
}

module.exports = { initPairing };
