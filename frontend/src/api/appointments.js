/**
 * appointments.js — Patient-facing appointment API calls.
 *
 * Every function calls updateActivity() first to refresh the patient's
 * 10-minute inactivity window. This ensures that any API interaction the
 * patient makes (loading slots, placing a hold, booking) extends their session
 * rather than letting it silently expire mid-flow.
 *
 * Error shapes thrown on failure (from _base.js apiFetch):
 *   { code: string, error: string, status: number }
 *
 * Notable error codes callers branch on:
 *   'duplicate_date'   — placeHold: phone already has a booking on that IST date
 *   'slot_unavailable' — placeHold/bookSlot: race condition, slot taken between select + hold
 *   'hold_expired'     — bookSlot: 2-minute hold window closed
 *   'cutoff_passed'    — placeHold: slot starts within 1 hour
 */
import { apiFetch } from './_base.js';
import { updateActivity } from '../utils/session.js';

/**
 * Fetch available slots for a date range.
 *
 * @param {string} from — 'YYYY-MM-DD' (start of range, inclusive)
 * @param {string} to   — 'YYYY-MM-DD' (end of range, inclusive)
 * @returns {{ slots: Array<{ id, slot_time, status, hold_expires_at }> }}
 */
export async function getSlots(from, to) {
  updateActivity();
  return apiFetch(`/slots?from=${from}&to=${to}`);
}

/**
 * Place a 2-minute hold on a slot, locking it from other patients.
 *
 * A placeholder phone ('0000000000') is sent here because the real phone
 * number is collected in the booking form that opens after the hold succeeds.
 * The backend only checks the phone for duplicate-date validation; the
 * placeholder does not interfere with that check since it won't match any
 * existing booking.
 *
 * @param {string} slotId — slot UUID from getSlots
 * @param {string} phone  — E.164 digits (e.g. '919876543210')
 * @returns {{ hold_id: string, hold_expires_at: string }} or throws 'duplicate_date'
 */
export async function placeHold(slotId, phone) {
  updateActivity();
  return apiFetch('/hold', {
    method: 'POST',
    body: JSON.stringify({ slot_id: slotId, phone }),
  });
}

/**
 * Confirm a booking after OTP verification.
 *
 * The otpToken is the session_token returned by verifyOTP — the backend uses
 * it both to authenticate the request and to confirm the OTP was verified for
 * this phone number.
 *
 * @param {string} slotId    — same UUID used in placeHold
 * @param {string} otpToken  — session_token from verifyOTP response
 * @param {string} name      — patient full name
 * @param {string} phone     — E.164 digits
 * @param {string} reason    — optional reason for visit (can be empty string)
 * @returns {{ appointment_id, slot_time, patient_name, session_token, … }}
 */
export async function bookSlot(slotId, otpToken, name, phone, reason = '') {
  updateActivity();
  return apiFetch('/book', {
    method: 'POST',
    body: JSON.stringify({ slot_id: slotId, otp_token: otpToken, name, phone, reason }),
  });
}

/**
 * Cancel an existing appointment (patient-initiated).
 *
 * Requires a valid patient session token (Bearer in Authorization header).
 * The backend validates that the token's phone matches the appointment's
 * patient_phone to prevent cross-patient cancellations.
 *
 * @param {string} appointmentId
 * @param {string} sessionToken — from the patient session (setSession / getSession)
 */
export async function cancelSlot(appointmentId, sessionToken) {
  updateActivity();
  return apiFetch(`/appointments/${appointmentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

/**
 * Look up upcoming and past appointments for the authenticated patient.
 *
 * @param {string} phone        — E.164 digits (must match session token's phone)
 * @param {string} sessionToken — patient session token
 * @returns {{ upcoming: Appointment|null, last_visit: Appointment|null }}
 */
export async function lookupAppointment(phone, sessionToken) {
  updateActivity();
  return apiFetch(`/appointments/lookup?phone=${phone}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
}

/**
 * Atomically cancel an existing booking and hold a new slot.
 *
 * This is the "cancel and rebook" flow (US-06): both the cancel and the new
 * hold happen inside a single SQLite IMMEDIATE transaction on the backend,
 * preventing the race condition where another patient grabs the new slot in
 * the gap between cancel and hold.
 *
 * @param {string} cancelId  — UUID of the appointment to cancel
 * @param {string} newSlotId — UUID of the new slot to hold
 * @param {string} phone     — E.164 digits (must match existing booking)
 * @returns {{ cancelled_id, hold_id, hold_expires_at }}
 */
export async function cancelAndRebook(cancelId, newSlotId, phone) {
  updateActivity();
  return apiFetch('/appointments/cancel-and-rebook', {
    method: 'POST',
    body: JSON.stringify({ cancel_id: cancelId, new_slot_id: newSlotId, phone }),
  });
}
