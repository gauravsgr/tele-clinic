/**
 * auth.js — OTP send / verify API calls.
 *
 * Used by both the patient flow (BookingSheet, OTPSheet, LookupSheet) and
 * the doctor flow (OTPGate). The `purpose` parameter routes the OTP to the
 * correct validation pathway on the backend:
 *
 *   'booking'      — patient booking OTP (verifyOTP also validates against a held slot)
 *   'lookup'       — patient record lookup OTP
 *   'cancel'       — patient cancellation OTP (currently unused — cancel uses session token)
 *   'doctor_login' — doctor daily login OTP (backend also accepts emergency bcrypt PIN)
 *
 * Note: these functions do NOT call updateActivity() because they are used in
 * both patient and doctor contexts. Patient callers that need session refresh
 * handle it explicitly.
 */
import { apiFetch } from './_base.js';

/**
 * Send a 4-digit OTP via WhatsApp to the given phone number.
 *
 * The backend enforces a 59-second resend cooldown per (phone, purpose) pair.
 * Calling this too soon throws { code: 'resend_too_soon', status: 429 }.
 *
 * @param {string} phone   — E.164 digits (e.g. '919876543210')
 * @param {string} purpose — 'booking' | 'lookup' | 'cancel' | 'doctor_login'
 * @returns {{ sent: boolean, expires_in_seconds: number, resend_available_after_seconds: number }}
 */
export async function sendOTP(phone, purpose) {
  return apiFetch('/otp/send', {
    method: 'POST',
    body: JSON.stringify({ phone, purpose }),
  });
}

/**
 * Verify a 4-digit OTP (or doctor emergency PIN) and receive a session token.
 *
 * On success, the backend returns a signed HMAC-SHA256 session token that
 * encodes (phone, role, expires_at). The token is:
 *   - Patient: stored in sessionStorage via setSession(); expires in 10 min inactivity
 *     or 11:59 PM IST.
 *   - Doctor: held in-memory React state (DoctorApp.doctorToken); cleared on page reload.
 *
 * @param {string} phone   — E.164 digits
 * @param {string} code    — 4-digit OTP string or emergency PIN
 * @param {string} purpose — must match the purpose used in sendOTP
 * @returns {{ verified: boolean, session_token: string, expires_at: string }}
 */
export async function verifyOTP(phone, code, purpose) {
  return apiFetch('/otp/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code, purpose }),
  });
}
