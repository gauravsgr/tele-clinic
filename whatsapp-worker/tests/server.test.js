'use strict';

/**
 * server.test.js — Integration tests for server.js in mock mode.
 *
 * All tests run with WHATSAPP_MODE=mock (the default).
 * Messages are written to a temp JSONL path (MOCK_JSONL_PATH env var)
 * so we never pollute the project root.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const request = require('supertest');
const { io: ioClient } = require('socket.io-client');

// ── Temp file for mock messages ───────────────────────────────────────────────

const TEMP_JSONL = path.join(os.tmpdir(), `mock-messages-test-${process.pid}.jsonl`);

// Point server at the temp file before requiring it.
process.env.MOCK_JSONL_PATH = TEMP_JSONL;
delete process.env.WHATSAPP_MODE; // ensure mock mode

// ── Require server AFTER setting env ─────────────────────────────────────────

const { app, httpServer, io } = require('../server');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

let serverAddress;

beforeAll((done) => {
  httpServer.listen(0, () => {               // port 0 → OS assigns free port
    serverAddress = `http://localhost:${httpServer.address().port}`;
    done();
  });
});

afterAll((done) => {
  io.close();
  httpServer.close(done);
});

beforeEach(() => {
  // Start each test with a clean JSONL file.
  try { fs.unlinkSync(TEMP_JSONL); } catch (_) {}
});

// ── Helper ────────────────────────────────────────────────────────────────────

function readJsonl() {
  try {
    return fs.readFileSync(TEMP_JSONL, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  } catch (_) {
    return [];
  }
}

// ── POST /send-message ────────────────────────────────────────────────────────

describe('POST /send-message (mock mode)', () => {
  test('valid body → 200 { queued: true, queue_position: 1 }', async () => {
    const res = await request(app)
      .post('/send-message')
      .send({ to: '919876543210', message: 'Hi Rahul! Your appointment is confirmed.' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: true, queue_position: 1 });
  });

  test('valid body → appends exactly one line to mock-messages.jsonl', async () => {
    await request(app)
      .post('/send-message')
      .send({ to: '919876543210', message: 'Test message' });

    const lines = readJsonl();
    expect(lines).toHaveLength(1);
  });

  test('appended line has correct ts, to, and message fields', async () => {
    const to = '919876543210';
    const message = 'Confirmed appointment';

    await request(app)
      .post('/send-message')
      .send({ to, message });

    const [entry] = readJsonl();
    expect(entry.to).toBe(to);
    expect(entry.message).toBe(message);
    // ts must be a string ending with +05:30 (IST)
    expect(typeof entry.ts).toBe('string');
    expect(entry.ts).toMatch(/\+05:30$/);
  });

  test('two sends → two lines in JSONL', async () => {
    await request(app).post('/send-message').send({ to: '919000000001', message: 'First' });
    await request(app).post('/send-message').send({ to: '919000000002', message: 'Second' });

    expect(readJsonl()).toHaveLength(2);
  });

  test('missing "to" → 400 validation_error', async () => {
    const res = await request(app)
      .post('/send-message')
      .send({ message: 'Hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  test('empty "to" → 400 validation_error', async () => {
    const res = await request(app)
      .post('/send-message')
      .send({ to: '', message: 'Hello' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  test('missing "message" → 400 validation_error', async () => {
    const res = await request(app)
      .post('/send-message')
      .send({ to: '919876543210' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  test('empty "message" → 400 validation_error', async () => {
    const res = await request(app)
      .post('/send-message')
      .send({ to: '919876543210', message: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

// ── GET /mock/disconnect ──────────────────────────────────────────────────────

describe('GET /mock/disconnect', () => {
  test('returns 200 and emits auth_disconnected to connected Socket.io clients', (done) => {
    const client = ioClient(serverAddress, { transports: ['websocket'] });

    client.once('connect', async () => {
      client.once('auth_disconnected', () => {
        client.disconnect();
        done();
      });

      await request(app).get('/mock/disconnect');
    });

    client.once('connect_error', (err) => {
      client.disconnect();
      done(err);
    });
  }, 8000);
});

// ── Socket.io pairing events (mock mode) ─────────────────────────────────────

describe('Socket.io mock pairing events', () => {
  test('pairing_code event fires within 2 s with an 8-character string', (done) => {
    const client = ioClient(serverAddress, { transports: ['websocket'] });

    const timer = setTimeout(() => {
      client.disconnect();
      done(new Error('pairing_code not received within 2 s'));
    }, 2000);

    client.once('pairing_code', (code) => {
      clearTimeout(timer);
      try {
        expect(typeof code).toBe('string');
        // "ABCD-1234" has 9 chars with the dash; spec says 8-char code displayed as text.
        // The mock emits the literal "ABCD-1234" — count only alphanumeric characters.
        const alphanumeric = code.replace(/[^A-Za-z0-9]/g, '');
        expect(alphanumeric.length).toBe(8);
        client.disconnect();
        done();
      } catch (err) {
        client.disconnect();
        done(err);
      }
    });

    client.once('connect_error', (err) => {
      clearTimeout(timer);
      client.disconnect();
      done(err);
    });
  }, 6000);

  test('auth_ready event fires within 6 s of connect', (done) => {
    const client = ioClient(serverAddress, { transports: ['websocket'] });

    const timer = setTimeout(() => {
      client.disconnect();
      done(new Error('auth_ready not received within 6 s'));
    }, 6000);

    client.once('auth_ready', () => {
      clearTimeout(timer);
      client.disconnect();
      done();
    });

    client.once('connect_error', (err) => {
      clearTimeout(timer);
      client.disconnect();
      done(err);
    });
  }, 8000);

  test('pairing_code fires before auth_ready', (done) => {
    const client = ioClient(serverAddress, { transports: ['websocket'] });
    const events = [];

    const finish = setTimeout(() => {
      client.disconnect();
      try {
        expect(events[0]).toBe('pairing_code');
        expect(events[1]).toBe('auth_ready');
        done();
      } catch (err) {
        done(err);
      }
    }, 5500);

    client.once('pairing_code', () => events.push('pairing_code'));
    client.once('auth_ready',   () => events.push('auth_ready'));

    client.once('connect_error', (err) => {
      clearTimeout(finish);
      client.disconnect();
      done(err);
    });
  }, 8000);
});
