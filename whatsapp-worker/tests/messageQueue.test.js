'use strict';

const { MessageQueue } = require('../messageQueue');

/** Wait for the queue to fully drain (both pending and in-flight = 0). */
async function waitForDrain(queue, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (queue.queueLength > 0 || queue.inFlightCount > 0) {
    if (Date.now() > deadline) throw new Error('Queue did not drain in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('MessageQueue', () => {
  describe('constructor', () => {
    test('throws if sendFn is not a function', () => {
      expect(() => new MessageQueue(null)).toThrow(TypeError);
      expect(() => new MessageQueue('bad')).toThrow(TypeError);
    });

    test('creates queue with default options', () => {
      const q = new MessageQueue(async () => {});
      expect(q.inFlightCount).toBe(0);
      expect(q.queueLength).toBe(0);
    });
  });

  describe('enqueue()', () => {
    test('returns { queued: true, queue_position: N } with 1-based N', () => {
      const q = new MessageQueue(async () => new Promise(() => {}), { delayMs: 0 });
      const r1 = q.enqueue({ to: '919876543210', message: 'Hello 1' });
      const r2 = q.enqueue({ to: '919876543210', message: 'Hello 2' });
      const r3 = q.enqueue({ to: '919876543210', message: 'Hello 3' });

      expect(r1).toEqual({ queued: true, queue_position: 1 });
      expect(r2).toEqual({ queued: true, queue_position: 2 });
      expect(r3).toEqual({ queued: true, queue_position: 3 });
    });

    test('throws on missing "to"', () => {
      const q = new MessageQueue(async () => {});
      expect(() => q.enqueue({ message: 'Hi' })).toThrow(TypeError);
      expect(() => q.enqueue({ to: '', message: 'Hi' })).toThrow(TypeError);
    });

    test('throws on missing "message"', () => {
      const q = new MessageQueue(async () => {});
      expect(() => q.enqueue({ to: '919876543210' })).toThrow(TypeError);
      expect(() => q.enqueue({ to: '919876543210', message: '' })).toThrow(TypeError);
    });
  });

  describe('max in-flight enforcement', () => {
    test('peak in-flight never exceeds maxInFlight=10 when 12 messages enqueued', async () => {
      // Each send takes 50 ms; delayMs=0 so the loop advances instantly.
      const sendFn = jest.fn(() => new Promise((r) => setTimeout(r, 50)));
      const q = new MessageQueue(sendFn, { maxInFlight: 10, delayMs: 0 });

      for (let i = 1; i <= 12; i++) {
        q.enqueue({ to: '91000000000' + i, message: `msg ${i}` });
      }

      await waitForDrain(q, 5000);

      expect(q.peakInFlight).toBeLessThanOrEqual(10);
      expect(sendFn).toHaveBeenCalledTimes(12);
    }, 10000);
  });

  describe('FIFO ordering', () => {
    test('messages are delivered in enqueue order', async () => {
      const received = [];
      const sendFn = jest.fn(async (to, message) => { received.push(message); });
      const q = new MessageQueue(sendFn, { maxInFlight: 1, delayMs: 0 });

      q.enqueue({ to: '91000000001', message: 'first' });
      q.enqueue({ to: '91000000002', message: 'second' });
      q.enqueue({ to: '91000000003', message: 'third' });

      await waitForDrain(q, 3000);

      expect(received).toEqual(['first', 'second', 'third']);
    });
  });

  describe('retry behaviour', () => {
    test('sends successfully on 2nd attempt when 1st throws', async () => {
      let calls = 0;
      const sendFn = jest.fn(async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient error');
      });
      const q = new MessageQueue(sendFn, { maxRetries: 3, delayMs: 0 });

      q.enqueue({ to: '919876543210', message: 'retry me' });
      await waitForDrain(q, 3000);

      expect(sendFn).toHaveBeenCalledTimes(2);
    });

    test('drops message and continues after maxRetries exhausted', async () => {
      const failFn = jest.fn(async () => { throw new Error('always fails'); });
      const successFn = jest.fn(async () => {});

      // Two messages: first always fails, second always succeeds.
      let callIndex = 0;
      const sendFn = jest.fn(async (to, message) => {
        callIndex += 1;
        if (message === 'will-fail') {
          throw new Error('always fails');
        }
      });

      const q = new MessageQueue(sendFn, { maxRetries: 3, delayMs: 0 });
      q.enqueue({ to: '919000000001', message: 'will-fail' });
      q.enqueue({ to: '919000000002', message: 'will-succeed' });

      await waitForDrain(q, 5000);

      // 3 attempts for the failing message + 1 for the succeeding one
      expect(sendFn).toHaveBeenCalledTimes(4);

      const allMessages = sendFn.mock.calls.map(([, msg]) => msg);
      expect(allMessages.filter((m) => m === 'will-fail')).toHaveLength(3);
      expect(allMessages.filter((m) => m === 'will-succeed')).toHaveLength(1);
    });

    test('queue continues processing after a permanent failure', async () => {
      const received = [];
      const sendFn = jest.fn(async (to, message) => {
        if (message === 'bad') throw new Error('fail');
        received.push(message);
      });

      const q = new MessageQueue(sendFn, { maxRetries: 1, delayMs: 0 });
      q.enqueue({ to: '91000000001', message: 'good-1' });
      q.enqueue({ to: '91000000002', message: 'bad' });
      q.enqueue({ to: '91000000003', message: 'good-2' });

      await waitForDrain(q, 3000);

      expect(received).toContain('good-1');
      expect(received).toContain('good-2');
    });
  });

  describe('queue drains completely', () => {
    test('inFlightCount and queueLength both reach 0 after processing', async () => {
      const sendFn = jest.fn(async () => {});
      const q = new MessageQueue(sendFn, { delayMs: 0 });

      for (let i = 0; i < 5; i++) {
        q.enqueue({ to: `9190000000${i}`, message: `msg ${i}` });
      }

      await waitForDrain(q, 3000);

      expect(q.inFlightCount).toBe(0);
      expect(q.queueLength).toBe(0);
      expect(sendFn).toHaveBeenCalledTimes(5);
    });
  });
});
