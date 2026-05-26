'use strict';

const { EventEmitter } = require('events');

// ── Mock whatsapp-web.js before requiring pairingBroadcast ───────────────────
// We need a controllable Client and LocalAuth so no Chromium is launched.

let mockClientInstance;

class MockLocalAuth {}

class MockClient extends EventEmitter {
  constructor() {
    super();
    mockClientInstance = this;
    this.initialize = jest.fn();
    this.requestPairingCode = jest.fn();
  }
}

jest.mock('whatsapp-web.js', () => ({
  Client: MockClient,
  LocalAuth: MockLocalAuth,
}));

const { initPairing } = require('../pairingBroadcast');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal Socket.io-like mock with a jest spy on emit(). */
function makeIo() {
  return { emit: jest.fn() };
}

/** Wait for all pending microtasks (flushes resolved promises). */
const flushPromises = () => new Promise((r) => setImmediate(r));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pairingBroadcast.js — initPairing()', () => {
  let io;

  beforeEach(() => {
    io = makeIo();
    // Reset the mock client instance each test.
    mockClientInstance = null;
    jest.clearAllMocks();
  });

  test('throws if doctorPhone is missing or not a string', () => {
    expect(() => initPairing(makeIo(), '')).toThrow(TypeError);
    expect(() => initPairing(makeIo(), null)).toThrow(TypeError);
    expect(() => initPairing(makeIo(), 42)).toThrow(TypeError);
  });

  test('calls client.initialize()', () => {
    initPairing(io, '919876543210');
    expect(mockClientInstance.initialize).toHaveBeenCalledTimes(1);
  });

  test('returns the Client instance', () => {
    const result = initPairing(io, '919876543210');
    expect(result).toBe(mockClientInstance);
  });

  test('emits auth_ready when "ready" event fires', () => {
    initPairing(io, '919876543210');
    mockClientInstance.emit('ready');
    expect(io.emit).toHaveBeenCalledWith('auth_ready');
  });

  test('emits auth_disconnected when "disconnected" event fires', () => {
    initPairing(io, '919876543210');
    mockClientInstance.emit('disconnected', 'LOGOUT');
    expect(io.emit).toHaveBeenCalledWith('auth_disconnected');
  });

  test('emits pairing_code with the code from requestPairingCode on loading_screen', async () => {
    mockClientInstance = null;
    initPairing(io, '919876543210');

    mockClientInstance.requestPairingCode.mockResolvedValue('ABCD1234');

    mockClientInstance.emit('loading_screen');
    await flushPromises();

    expect(mockClientInstance.requestPairingCode).toHaveBeenCalledWith('919876543210');
    expect(io.emit).toHaveBeenCalledWith('pairing_code', 'ABCD1234');
  });

  test('emits auth_error when requestPairingCode rejects on loading_screen', async () => {
    initPairing(io, '919876543210');

    mockClientInstance.requestPairingCode.mockRejectedValue(new Error('network timeout'));

    mockClientInstance.emit('loading_screen');
    await flushPromises();

    expect(io.emit).toHaveBeenCalledWith(
      'auth_error',
      'Pairing code generation failed — check worker logs.',
    );
  });

  test('emits fresh pairing_code when "qr" event fires after initial loading_screen', async () => {
    initPairing(io, '919876543210');

    // First pairing code
    mockClientInstance.requestPairingCode
      .mockResolvedValueOnce('FIRST123')
      .mockResolvedValueOnce('SECOND56');

    mockClientInstance.emit('loading_screen');
    await flushPromises();

    expect(io.emit).toHaveBeenCalledWith('pairing_code', 'FIRST123');

    // Simulate code expiry — whatsapp-web.js fires 'qr'
    mockClientInstance.emit('qr', '<qr-data>');
    await flushPromises();

    expect(io.emit).toHaveBeenCalledWith('pairing_code', 'SECOND56');
    expect(mockClientInstance.requestPairingCode).toHaveBeenCalledTimes(2);
  });

  test('emits auth_error when qr-triggered requestPairingCode rejects', async () => {
    initPairing(io, '919876543210');

    mockClientInstance.requestPairingCode
      .mockResolvedValueOnce('FIRST123')
      .mockRejectedValueOnce(new Error('refresh failed'));

    mockClientInstance.emit('loading_screen');
    await flushPromises();

    mockClientInstance.emit('qr', '<qr-data>');
    await flushPromises();

    expect(io.emit).toHaveBeenCalledWith(
      'auth_error',
      'Pairing code refresh failed — check worker logs.',
    );
  });
});
