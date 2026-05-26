/**
 * Utils test suite — date, phone, and session helpers.
 * Run with: npx vitest run
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── date helpers ────────────────────────────────────────────────────────────
import {
  toISTDateStr,
  formatSlotTime,
  formatDisplayDate,
  formatShortDate,
  isSameISTDate,
  isWithinBookingWindow,
  isPastCutoff,
  generateDateStrip,
  generateMorningSlots,
  generateEveningSlots,
} from '../date.js';

// ── phone helpers ────────────────────────────────────────────────────────────
import { toE164, toDisplayPhone, maskPhone } from '../phone.js';

// ── session helpers ──────────────────────────────────────────────────────────
import {
  getSession,
  setSession,
  clearSession,
  updateActivity,
  isSessionValid,
} from '../session.js';

import { SESSION_INACTIVITY_MS } from '../constants.js';

// ════════════════════════════════════════════════════════════════════════════
// DATE HELPERS
// ════════════════════════════════════════════════════════════════════════════

describe('toISTDateStr', () => {
  it('converts a UTC date that crosses midnight in IST to the correct IST date', () => {
    // 2026-05-25T23:30:00Z = 2026-05-26T05:00:00+05:30 → date is 2026-05-26 in IST
    expect(toISTDateStr('2026-05-25T23:30:00Z')).toBe('2026-05-26');
  });

  it('handles ISO string with IST offset directly', () => {
    expect(toISTDateStr('2026-05-25T10:15:00+05:30')).toBe('2026-05-25');
  });

  it('handles a Date object', () => {
    // Noon UTC on 2026-05-25 stays 2026-05-25 in IST (noon + 5h30 = 17:30 same day)
    expect(toISTDateStr(new Date('2026-05-25T12:00:00Z'))).toBe('2026-05-25');
  });
});

describe('formatSlotTime', () => {
  it('formats a morning slot correctly', () => {
    expect(formatSlotTime('2026-05-25T10:15:00+05:30')).toBe('10:15 AM');
  });

  it('formats noon as 12:00 PM', () => {
    expect(formatSlotTime('2026-05-25T12:00:00+05:30')).toBe('12:00 PM');
  });

  it('formats midnight as 12:00 AM', () => {
    expect(formatSlotTime('2026-05-25T00:00:00+05:30')).toBe('12:00 AM');
  });

  it('formats an evening slot correctly', () => {
    expect(formatSlotTime('2026-05-25T16:30:00+05:30')).toBe('4:30 PM');
  });

  it('returns empty string for invalid input', () => {
    expect(formatSlotTime('not-a-date')).toBe('');
  });
});

describe('formatDisplayDate', () => {
  it('returns a long date string in IST', () => {
    const result = formatDisplayDate('2026-05-25');
    // Should contain 'May', '2026', and '25'
    expect(result).toMatch(/May/);
    expect(result).toMatch(/2026/);
    expect(result).toMatch(/25/);
  });

  it('includes the weekday', () => {
    // 2026-05-25 is a Monday
    const result = formatDisplayDate('2026-05-25');
    expect(result).toMatch(/Monday/);
  });
});

describe('formatShortDate', () => {
  it('returns a short date string', () => {
    const result = formatShortDate('2026-05-25');
    expect(result).toMatch(/Mon/);
    expect(result).toMatch(/25/);
    expect(result).toMatch(/May/);
  });
});

describe('isSameISTDate', () => {
  it('returns true for two ISOs on the same IST date', () => {
    expect(isSameISTDate('2026-05-25T10:00:00+05:30', '2026-05-25T18:00:00+05:30')).toBe(true);
  });

  it('returns false for ISOs on different IST dates', () => {
    expect(isSameISTDate('2026-05-25T23:30:00Z', '2026-05-25T10:00:00+05:30')).toBe(false);
    // 2026-05-25T23:30:00Z → 2026-05-26 in IST; 2026-05-25T10:00:00+05:30 → 2026-05-25 in IST
  });
});

describe('isWithinBookingWindow', () => {
  it('returns true for a slot today', () => {
    const today = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    expect(isWithinBookingWindow(today.toISOString())).toBe(true);
  });

  it('returns true for a slot 27 days from now', () => {
    const slot = new Date(Date.now() + 27 * 24 * 60 * 60 * 1000);
    expect(isWithinBookingWindow(slot.toISOString())).toBe(true);
  });

  it('returns false for a slot 30 days from now', () => {
    const slot = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    expect(isWithinBookingWindow(slot.toISOString())).toBe(false);
  });
});

describe('isPastCutoff', () => {
  it('returns true if slot is within 30 minutes', () => {
    const slot = new Date(Date.now() + 30 * 60 * 1000);
    expect(isPastCutoff(slot.toISOString())).toBe(true);
  });

  it('returns false if slot is 2 hours away', () => {
    const slot = new Date(Date.now() + 2 * 60 * 60 * 1000);
    expect(isPastCutoff(slot.toISOString())).toBe(false);
  });

  it('returns true if slot is in the past', () => {
    const slot = new Date(Date.now() - 60 * 1000);
    expect(isPastCutoff(slot.toISOString())).toBe(true);
  });
});

describe('generateDateStrip', () => {
  it('returns exactly 28 entries', () => {
    const strip = generateDateStrip();
    expect(strip).toHaveLength(28);
  });

  it('each entry has dateStr, dayLabel, dayNum, dayOfWeek', () => {
    const strip = generateDateStrip();
    for (const day of strip) {
      expect(day).toHaveProperty('dateStr');
      expect(day).toHaveProperty('dayLabel');
      expect(day).toHaveProperty('dayNum');
      expect(day).toHaveProperty('dayOfWeek');
      expect(day.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('first entry is today in IST', () => {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const nowIST = new Date(Date.now() + IST_OFFSET_MS);
    const todayStr = nowIST.toISOString().slice(0, 10);
    const strip = generateDateStrip();
    expect(strip[0].dateStr).toBe(todayStr);
  });

  it('strip dates are consecutive', () => {
    const strip = generateDateStrip();
    for (let i = 1; i < strip.length; i++) {
      const prev = new Date(strip[i - 1].dateStr);
      const curr = new Date(strip[i].dateStr);
      expect(curr.getTime() - prev.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe('generateMorningSlots', () => {
  it('returns 8 slots (10:00–11:45, 15 min apart)', () => {
    const slots = generateMorningSlots('2026-05-25');
    expect(slots).toHaveLength(8);
  });

  it('first slot is 10:00', () => {
    const slots = generateMorningSlots('2026-05-25');
    expect(slots[0]).toBe('2026-05-25T10:00:00+05:30');
  });

  it('last slot is 11:45', () => {
    const slots = generateMorningSlots('2026-05-25');
    expect(slots[slots.length - 1]).toBe('2026-05-25T11:45:00+05:30');
  });
});

describe('generateEveningSlots', () => {
  it('returns 12 slots (16:00–18:45, 15 min apart)', () => {
    const slots = generateEveningSlots('2026-05-25');
    expect(slots).toHaveLength(12);
  });

  it('first slot is 16:00', () => {
    const slots = generateEveningSlots('2026-05-25');
    expect(slots[0]).toBe('2026-05-25T16:00:00+05:30');
  });

  it('last slot is 18:45', () => {
    const slots = generateEveningSlots('2026-05-25');
    expect(slots[slots.length - 1]).toBe('2026-05-25T18:45:00+05:30');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PHONE HELPERS
// ════════════════════════════════════════════════════════════════════════════

describe('toE164', () => {
  it('converts a 10-digit number to E.164', () => {
    expect(toE164('9876543210')).toBe('919876543210');
  });

  it('handles a number already prefixed with 91', () => {
    expect(toE164('919876543210')).toBe('919876543210');
  });

  it('handles a number prefixed with +91 (strips the +)', () => {
    expect(toE164('+919876543210')).toBe('919876543210');
  });

  it('strips spaces and dashes', () => {
    expect(toE164('98765 43210')).toBe('919876543210');
    expect(toE164('98765-43210')).toBe('919876543210');
  });

  it('returns empty string for empty input', () => {
    expect(toE164('')).toBe('');
    expect(toE164(null)).toBe('');
  });
});

describe('toDisplayPhone', () => {
  it('formats E.164 to display format', () => {
    expect(toDisplayPhone('919876543210')).toBe('+91 98765 43210');
  });

  it('returns empty string for empty input', () => {
    expect(toDisplayPhone('')).toBe('');
    expect(toDisplayPhone(null)).toBe('');
  });
});

describe('maskPhone', () => {
  it('masks the first 5 local digits', () => {
    expect(maskPhone('919876543210')).toBe('+91 •••••43210');
  });

  it('returns empty string for empty input', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SESSION HELPERS
// ════════════════════════════════════════════════════════════════════════════

describe('session helpers', () => {
  // Mock sessionStorage using a simple in-memory store
  let storage = {};

  beforeEach(() => {
    storage = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => { storage[key] = value; },
      removeItem: (key) => { delete storage[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getSession returns null when nothing is stored', () => {
    expect(getSession()).toBeNull();
  });

  it('setSession persists a session and getSession retrieves it', () => {
    setSession({ phone: '919876543210', sessionToken: 'tok123' });
    const session = getSession();
    expect(session).not.toBeNull();
    expect(session.phone).toBe('919876543210');
    expect(session.sessionToken).toBe('tok123');
    expect(session.lastActivity).toBeTypeOf('number');
    expect(session.expiresAt).toBeTypeOf('number');
  });

  it('clearSession removes the session', () => {
    setSession({ phone: '919876543210', sessionToken: 'tok123' });
    clearSession();
    expect(getSession()).toBeNull();
  });

  it('isSessionValid returns true immediately after setSession', () => {
    setSession({ phone: '919876543210', sessionToken: 'tok123' });
    expect(isSessionValid()).toBe(true);
  });

  it('isSessionValid returns false when inactivity threshold exceeded', () => {
    setSession({ phone: '919876543210', sessionToken: 'tok123' });
    const session = getSession();
    // Backdate lastActivity beyond the inactivity window
    session.lastActivity = Date.now() - SESSION_INACTIVITY_MS - 1000;
    storage['tele_session'] = JSON.stringify(session);
    expect(isSessionValid()).toBe(false);
    // Should also clear the session
    expect(getSession()).toBeNull();
  });

  it('isSessionValid returns false when expiresAt has passed', () => {
    setSession({ phone: '919876543210', sessionToken: 'tok123' });
    const session = getSession();
    // Set expiresAt to 1 second ago
    session.expiresAt = Date.now() - 1000;
    storage['tele_session'] = JSON.stringify(session);
    expect(isSessionValid()).toBe(false);
    expect(getSession()).toBeNull();
  });

  it('isSessionValid returns false when no session exists', () => {
    expect(isSessionValid()).toBe(false);
  });

  it('updateActivity refreshes lastActivity', () => {
    setSession({ phone: '919876543210', sessionToken: 'tok123' });
    const before = getSession().lastActivity;
    // Backdate lastActivity a bit
    const session = getSession();
    session.lastActivity = before - 5000;
    storage['tele_session'] = JSON.stringify(session);

    updateActivity();
    const after = getSession().lastActivity;
    expect(after).toBeGreaterThan(before - 5000);
  });

  it('updateActivity is a no-op when session is absent', () => {
    // Should not throw
    expect(() => updateActivity()).not.toThrow();
  });
});
