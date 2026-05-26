/**
 * API layer tests — verifies correct URLs, methods, headers, bodies, and error propagation.
 * fetch is mocked via vi.stubGlobal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── mock session so updateActivity() is a no-op ──────────────────────────
vi.mock('../../utils/session.js', () => ({
  updateActivity: vi.fn(),
  getSession: vi.fn(() => null),
}));

import { sendOTP, verifyOTP } from '../auth.js';
import { getSlots, placeHold, bookSlot, cancelSlot, lookupAppointment, cancelAndRebook } from '../appointments.js';
import { getDoctorSchedule, getDoctorAppointments, getDoctorStats, cancelDay, cancelSlots, sendNotes } from '../doctor.js';
import { getWeeklySchedule, saveWeeklySchedule } from '../schedule.js';
import { getGoogleStatus, initiateGoogleAuth } from '../setup.js';

// ── fetch mock helpers ────────────────────────────────────────────────────
function mockFetchOk(data) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status, payload) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(payload),
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetchOk({}));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ════════════════════════════════════════════════════════════════════════════
// auth.js
// ════════════════════════════════════════════════════════════════════════════

describe('sendOTP', () => {
  it('POSTs to /api/otp/send with correct body', async () => {
    await sendOTP('919876543210', 'patient_booking');
    expect(fetch).toHaveBeenCalledWith(
      '/api/otp/send',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '919876543210', purpose: 'patient_booking' }),
      })
    );
  });
});

describe('verifyOTP', () => {
  it('POSTs to /api/otp/verify with correct body', async () => {
    await verifyOTP('919876543210', '1234', 'doctor_login');
    expect(fetch).toHaveBeenCalledWith(
      '/api/otp/verify',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ phone: '919876543210', code: '1234', purpose: 'doctor_login' }),
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// appointments.js
// ════════════════════════════════════════════════════════════════════════════

describe('getSlots', () => {
  it('GETs /api/slots with correct query params', async () => {
    await getSlots('2026-05-25', '2026-06-22');
    expect(fetch).toHaveBeenCalledWith(
      '/api/slots?from=2026-05-25&to=2026-06-22',
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });
});

describe('placeHold', () => {
  it('POSTs to /api/hold with slot_id and phone', async () => {
    await placeHold('slot-abc', '919876543210');
    expect(fetch).toHaveBeenCalledWith(
      '/api/hold',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slot_id: 'slot-abc', phone: '919876543210' }),
      })
    );
  });
});

describe('bookSlot', () => {
  it('POSTs to /api/book with all fields', async () => {
    await bookSlot('slot-abc', 'tok123', 'Ravi', '919876543210', 'Fever');
    expect(fetch).toHaveBeenCalledWith(
      '/api/book',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          slot_id: 'slot-abc',
          otp_token: 'tok123',
          patient_name: 'Ravi',
          phone: '919876543210',
          reason: 'Fever',
        }),
      })
    );
  });

  it('defaults reason to empty string', async () => {
    await bookSlot('slot-abc', 'tok123', 'Ravi', '919876543210');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.reason).toBe('');
  });
});

describe('cancelSlot', () => {
  it('DELETEs /api/appointments/:id with Authorization header', async () => {
    await cancelSlot('appt-123', 'sess-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/appointments/appt-123',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer sess-tok' }),
      })
    );
  });
});

describe('lookupAppointment', () => {
  it('GETs /api/appointments/lookup with phone param and auth header', async () => {
    await lookupAppointment('919876543210', 'sess-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/appointments/lookup?phone=919876543210',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sess-tok' }),
      })
    );
  });
});

describe('cancelAndRebook', () => {
  it('POSTs to /api/appointments/cancel-and-rebook', async () => {
    await cancelAndRebook('appt-123', 'slot-new', '919876543210');
    expect(fetch).toHaveBeenCalledWith(
      '/api/appointments/cancel-and-rebook',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ cancel_id: 'appt-123', new_slot_id: 'slot-new', phone: '919876543210' }),
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// doctor.js
// ════════════════════════════════════════════════════════════════════════════

describe('getDoctorSchedule', () => {
  it('GETs /api/doctor/schedule with auth header', async () => {
    await getDoctorSchedule('doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/schedule',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer doc-tok' }),
      })
    );
  });
});

describe('getDoctorAppointments', () => {
  it('GETs /api/doctor/appointments with date and auth', async () => {
    await getDoctorAppointments('2026-05-25', 'doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/appointments?date=2026-05-25',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer doc-tok' }),
      })
    );
  });
});

describe('getDoctorStats', () => {
  it('GETs /api/doctor/stats with auth', async () => {
    await getDoctorStats('doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/stats',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer doc-tok' }),
      })
    );
  });
});

describe('cancelDay', () => {
  it('POSTs to /api/doctor/cancel-day with date', async () => {
    await cancelDay('2026-05-25', 'doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/cancel-day',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ date: '2026-05-25' }),
      })
    );
  });
});

describe('cancelSlots', () => {
  it('POSTs to /api/doctor/cancel-slots with slot_ids array', async () => {
    await cancelSlots(['s1', 's2'], 'doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/cancel-slots',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ slot_ids: ['s1', 's2'] }),
      })
    );
  });
});

describe('sendNotes', () => {
  it('POSTs to /api/doctor/notes with appointment_id and text', async () => {
    await sendNotes('appt-123', 'Take rest.', 'doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ appointment_id: 'appt-123', text: 'Take rest.' }),
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// schedule.js
// ════════════════════════════════════════════════════════════════════════════

describe('getWeeklySchedule', () => {
  it('GETs /api/doctor/weekly-schedule with auth', async () => {
    await getWeeklySchedule('doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/weekly-schedule',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer doc-tok' }),
      })
    );
  });
});

describe('saveWeeklySchedule', () => {
  it('PUTs to /api/doctor/weekly-schedule with schedule body', async () => {
    const schedule = { Mon: true, Tue: false };
    await saveWeeklySchedule(schedule, 'doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/doctor/weekly-schedule',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ schedule }),
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// setup.js
// ════════════════════════════════════════════════════════════════════════════

describe('getGoogleStatus', () => {
  it('GETs /api/setup/google-status with auth', async () => {
    await getGoogleStatus('doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/setup/google-status',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer doc-tok' }),
      })
    );
  });
});

describe('initiateGoogleAuth', () => {
  it('GETs /api/setup/google-auth with auth', async () => {
    await initiateGoogleAuth('doc-tok');
    expect(fetch).toHaveBeenCalledWith(
      '/api/setup/google-auth',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer doc-tok' }),
      })
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Error propagation (_base.js)
// ════════════════════════════════════════════════════════════════════════════

describe('error propagation', () => {
  it('throws { code, error, status } on non-2xx response', async () => {
    vi.stubGlobal('fetch', mockFetchError(409, { code: 'duplicate_date', error: 'Already booked' }));
    await expect(placeHold('slot-abc', '919876543210')).rejects.toMatchObject({
      code: 'duplicate_date',
      error: 'Already booked',
      status: 409,
    });
  });

  it('falls back to unknown_error code if backend returns no code field', async () => {
    vi.stubGlobal('fetch', mockFetchError(500, { message: 'Internal' }));
    await expect(sendOTP('919876543210', 'patient_booking')).rejects.toMatchObject({
      code: 'unknown_error',
      status: 500,
    });
  });
});
