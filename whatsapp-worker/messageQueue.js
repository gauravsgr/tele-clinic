'use strict';

/**
 * messageQueue.js — FIFO WhatsApp send queue.
 *
 * Rules (from instructions.md §WhatsApp Anti-Ban Rules):
 *   - Max 10 messages in-flight at once.
 *   - Random 30–60 second delay between starting each new send.
 *   - Retry up to 3 times per message on failure.
 *   - Logs permanent failure without crashing.
 *
 * Usage:
 *   const q = new MessageQueue(async (to, message) => { ... });
 *   const result = q.enqueue({ to: '919876543210', message: 'Hello!' });
 *   // => { queued: true, queue_position: 1 }
 *
 * Constructor options:
 *   maxInFlight  — cap on simultaneous in-flight sends (default 10)
 *   delayMs      — fixed ms delay between sends; when null uses random 30–60 s (default null)
 *   maxRetries   — attempts per message including the first (default 3)
 */

const DEFAULT_DELAY_MIN_MS = 30_000;
const DEFAULT_DELAY_MAX_MS = 60_000;

function randomDelayMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MessageQueue {
  /**
   * @param {(to: string, message: string) => Promise<void>} sendFn
   * @param {{ maxInFlight?: number, delayMs?: number|null, maxRetries?: number }} [opts]
   */
  constructor(sendFn, { maxInFlight = 10, delayMs = null, maxRetries = 3 } = {}) {
    if (typeof sendFn !== 'function') {
      throw new TypeError('MessageQueue: sendFn must be a function');
    }
    this._sendFn = sendFn;
    this._maxInFlight = maxInFlight;
    this._delayMs = delayMs;        // null → random 30–60 s per send cycle
    this._maxRetries = maxRetries;
    this._queue = [];               // pending payloads: { to, message, _enqueuePos }
    this._inFlight = 0;
    this._totalEnqueued = 0;
    this._peakInFlight = 0;         // observable for tests
    this._draining = false;
  }

  /** Current number of messages actively being sent. */
  get inFlightCount() { return this._inFlight; }

  /** Current number of messages waiting to be sent. */
  get queueLength() { return this._queue.length; }

  /** Highest in-flight count ever recorded (for tests). */
  get peakInFlight() { return this._peakInFlight; }

  /**
   * Add a message to the send queue.
   * @param {{ to: string, message: string }} payload
   * @returns {{ queued: true, queue_position: number }}
   */
  enqueue({ to, message }) {
    if (!to || typeof to !== 'string') {
      throw new TypeError('MessageQueue.enqueue: "to" must be a non-empty string');
    }
    if (!message || typeof message !== 'string') {
      throw new TypeError('MessageQueue.enqueue: "message" must be a non-empty string');
    }

    this._totalEnqueued += 1;
    const position = this._totalEnqueued;
    this._queue.push({ to, message, position });

    // Kick the drain loop if it isn't already running.
    if (!this._draining) {
      this._drain();
    }

    return { queued: true, queue_position: position };
  }

  /**
   * Internal drain loop.  Starts new sends whenever slots are free and the
   * queue is non-empty.  Applies the inter-send delay between each kick.
   */
  async _drain() {
    this._draining = true;
    try {
      while (this._queue.length > 0 || this._inFlight > 0) {
        // Wait until there is a free in-flight slot.
        while (this._inFlight >= this._maxInFlight) {
          await sleep(10);
        }

        if (this._queue.length === 0) {
          // All items dispatched; wait for in-flight to finish before exiting.
          await sleep(10);
          continue;
        }

        const payload = this._queue.shift();
        this._inFlight += 1;
        if (this._inFlight > this._peakInFlight) {
          this._peakInFlight = this._inFlight;
        }

        // Fire-and-forget send (with retry) so the loop can immediately
        // apply the inter-send delay and pick up the next item.
        this._sendWithRetry(payload).finally(() => {
          this._inFlight -= 1;
        });

        // Inter-send delay before starting the next one.
        const delay = this._delayMs !== null
          ? this._delayMs
          : randomDelayMs(DEFAULT_DELAY_MIN_MS, DEFAULT_DELAY_MAX_MS);

        if (delay > 0) {
          await sleep(delay);
        }
      }
    } finally {
      this._draining = false;
    }
  }

  /**
   * Attempt to send one message, retrying up to maxRetries times.
   * Logs — does not throw — on permanent failure.
   */
  async _sendWithRetry({ to, message, position }) {
    const RETRY_DELAYS_MS = [0, 30_000, 60_000]; // gaps between attempts 1→2, 2→3
    let lastErr;

    for (let attempt = 1; attempt <= this._maxRetries; attempt++) {
      if (attempt > 1) {
        const backoff = RETRY_DELAYS_MS[attempt - 1] ?? 60_000;
        // In test mode (delayMs === 0) skip retry back-off too.
        if (this._delayMs !== 0 && backoff > 0) {
          await sleep(backoff);
        }
      }
      try {
        await this._sendFn(to, message);
        console.log(`[queue] sent pos=${position} to=${to} attempt=${attempt}`);
        return; // success
      } catch (err) {
        lastErr = err;
        console.warn(
          `[queue] send failed pos=${position} to=${to} attempt=${attempt}/${this._maxRetries}: ${err.message}`,
        );
      }
    }

    // All retries exhausted — log and drop.
    console.error(
      `[queue] permanent failure pos=${position} to=${to} after ${this._maxRetries} attempts: ${lastErr.message}`,
    );
  }
}

module.exports = { MessageQueue };
