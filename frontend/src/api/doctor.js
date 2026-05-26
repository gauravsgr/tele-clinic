/**
 * doctor.js — Doctor-facing API calls.
 *
 * All functions require a doctorToken — the in-memory session token received
 * after OTP verification in OTPGate. The token is passed as a Bearer header on
 * every request. It is intentionally NOT stored in localStorage/sessionStorage:
 * clearing on page reload is a security feature (forces re-authentication).
 *
 * The backend validates the token via HMAC-SHA256 signature and checks that
 * the role field is 'doctor'. Patient session tokens are rejected.
 */
import { apiFetch } from './_base.js';

/** Returns the Authorization header object for a given doctor token. */
function authHeader(doctorToken) {
  return { Authorization: `Bearer ${doctorToken}` };
}

/**
 * Fetch today's appointment schedule for the doctor's timeline view.
 *
 * Returns server_time (ISO 8601 +05:30) alongside appointments so the frontend
 * can compute DONE/ACTIVE/NEXT UP/UPCOMING statuses without trusting the
 * browser clock (which may be wrong or in a different timezone).
 *
 * @returns {{ appointments: DoctorAppointment[], server_time: string }}
 */
export async function getDoctorSchedule(doctorToken) {
  return apiFetch('/doctor/schedule', {
    headers: authHeader(doctorToken),
  });
}

/**
 * Fetch appointments for a specific date (used by BrowsePanel date picker).
 *
 * @param {string} date — 'YYYY-MM-DD' in IST
 */
export async function getDoctorAppointments(date, doctorToken) {
  return apiFetch(`/doctor/appointments?date=${date}`, {
    headers: authHeader(doctorToken),
  });
}

/**
 * Fetch aggregate practice stats for the StatsSheet.
 *
 * @returns {{ past: PastStats, future: FutureStats }}
 */
export async function getDoctorStats(doctorToken) {
  return apiFetch('/doctor/stats', {
    headers: authHeader(doctorToken),
  });
}

/**
 * Cancel all booked appointments for a calendar day (CancellationEngine Scope A).
 *
 * The backend sends WhatsApp cancellation messages to all affected patients
 * and fires-and-forgets; this call returns when the DB update completes, not
 * when all WhatsApp messages are delivered.
 *
 * @param {string} date — 'YYYY-MM-DD' in IST
 * @returns {{ cancelled_count: number, patients_notified: number }}
 */
export async function cancelDay(date, doctorToken) {
  return apiFetch('/doctor/cancel-day', {
    method: 'POST',
    headers: authHeader(doctorToken),
    body: JSON.stringify({ date }),
  });
}

/**
 * Cancel specific appointment slots (CancellationEngine Scope B).
 *
 * @param {string[]} slotIds — array of appointment UUIDs to cancel
 * @returns {{ cancelled_count: number, skipped: string[] }}
 */
export async function cancelSlots(slotIds, doctorToken) {
  return apiFetch('/doctor/cancel-slots', {
    method: 'POST',
    headers: authHeader(doctorToken),
    body: JSON.stringify({ slot_ids: slotIds }),
  });
}

/**
 * Send consultation notes to a patient via WhatsApp.
 *
 * The text is sent as-is through the WhatsApp worker. There is no template —
 * the doctor writes free-form notes. The backend logs the send in notes_log.
 *
 * @param {string} appointmentId — UUID of the active appointment
 * @param {string} text          — free-form consultation notes (1–4096 chars)
 * @returns {{ sent: boolean, appointment_id: string, patient_phone: string }}
 */
export async function sendNotes(appointmentId, text, doctorToken) {
  return apiFetch('/doctor/notes', {
    method: 'POST',
    headers: authHeader(doctorToken),
    body: JSON.stringify({ appointment_id: appointmentId, text }),
  });
}
