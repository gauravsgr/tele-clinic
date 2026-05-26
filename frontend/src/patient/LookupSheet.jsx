/**
 * LookupSheet — "Manage Existing Appointment" bottom sheet for patients.
 *
 * Opened from the "Manage Existing Appointment" CTA on BookingPage.
 * Lets a patient look up their booking history and cancel an upcoming appointment.
 *
 * Props:
 *   open    — boolean; controls BottomSheet visibility
 *   onClose — dismiss callback; wired to the shared BottomSheet overlay
 *   accent  — hex string (#2563eb for patient side); passed to OTPInput and buttons
 *
 * Three-step flow:
 *
 *   Step 'phone':
 *     Patient enters a 10-digit mobile number. On "Find My Records", we check
 *     whether a valid patient session already exists in sessionStorage:
 *       - Session valid → skip OTP, call lookupAppointment directly, go to 'found'
 *       - No session    → call sendOTP (sends WhatsApp code), go to 'otp'
 *     This session-skip is a quality-of-life feature: a patient who just booked
 *     and immediately taps "Manage" shouldn't have to enter an OTP again.
 *
 *   Step 'otp':
 *     4-box OTP input with a 59s resend countdown. On verify:
 *       verifyOTP → setSession (persists to sessionStorage) → lookupAppointment
 *       → go to 'found'.
 *
 *   Step 'found' with inner cancelStep state machine:
 *     'view'      — displays AppointmentCard for upcoming + last_visit
 *     'confirm'   — "Are you sure?" confirmation before destructive delete
 *     'cancelled' — success state with green checkmark; button returns to booking
 *
 * Session token flow:
 *   `sessionToken` is stored in component state (not just sessionStorage) so that
 *   the lookupAppointment call in the skip-OTP path also works — the session utility
 *   `getSession()` returns the stored token, but we also store it in component
 *   state (`setSessionToken`) for use in the cancel call later.
 *
 * handleClose + reset:
 *   Closing the sheet resets all step state after 420ms (sheet slide-out duration).
 *   This ensures the sheet always opens fresh even if it was left mid-flow.
 *
 * formatAppt():
 *   Backend may return a pre-formatted `display_datetime` string. If absent,
 *   we construct one from `slot_time` using IST date utilities. The try/catch
 *   guards against malformed ISO strings from the backend.
 */
import { useState, useEffect } from 'react';
import BottomSheet from '../components/BottomSheet.jsx';
import PhoneInput from '../components/PhoneInput.jsx';
import OTPInput from '../components/OTPInput.jsx';
import CountdownTimer from '../components/CountdownTimer.jsx';
import AppointmentCard from './AppointmentCard.jsx';
import { sendOTP, verifyOTP } from '../api/auth.js';
import { lookupAppointment, cancelSlot } from '../api/appointments.js';
import { toE164, toDisplayPhone } from '../utils/phone.js';
import { isSessionValid, setSession } from '../utils/session.js';
import { formatDisplayDate, formatSlotTime, toISTDateStr } from '../utils/date.js';

export default function LookupSheet({ open, onClose, accent = '#2563eb' }) {
  const [step, setStep] = useState('phone');     // 'phone' | 'otp' | 'found'
  const [cancelStep, setCancelStep] = useState('view'); // 'view' | 'confirm' | 'cancelled'
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [cdKey, setCdKey] = useState(0);
  const [upcoming, setUpcoming] = useState(null);
  const [lastVisit, setLastVisit] = useState(null);

  // Reset all step and form state back to initial values.
  // Called with a 420ms delay after onClose so the sheet slide-out animation
  // (300ms ease-out + buffer) completes before the state resets — otherwise
  // the sheet content would visibly jump back to step 1 while still visible.
  function reset() {
    setStep('phone');
    setCancelStep('view');
    setPhone('');
    setOtp('');
    setError('');
    setResent(false);
    setUpcoming(null);
    setLastVisit(null);
  }

  function handleClose() {
    onClose();
    setTimeout(reset, 420);
  }

  // handleFind: the "Find My Records" tap handler.
  // Converts the 10-digit display phone to E.164 before any API call.
  // Session skip: `isSessionValid()` checks sessionStorage for an unexpired
  // patient session (10-min inactivity + 11:59 PM IST hard expiry). If valid,
  // we reuse the cached `sessionToken` from component state and skip OTP.
  // The cdKey bump on sendOTP restart ensures CountdownTimer resets to 59s
  // for a fresh code rather than resuming a stale countdown from a previous open.
  async function handleFind() {
    if (phone.length < 10 || loading) return;
    setLoading(true);
    setError('');
    try {
      const e164 = toE164(phone);

      if (isSessionValid()) {
        // Session active — no OTP needed; go straight to results.
        const data = await lookupAppointment(e164, sessionToken);
        setUpcoming(data.upcoming ?? null);
        setLastVisit(data.last_visit ?? null);
        setStep('found');
      } else {
        await sendOTP(e164, 'patient_lookup');
        setCdKey((k) => k + 1);
        setStep('otp');
      }
    } catch (err) {
      setError(err.error ?? 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    if (otp.length < 4 || loading) return;
    setLoading(true);
    setError('');
    try {
      const e164 = toE164(phone);
      const result = await verifyOTP(e164, otp, 'patient_lookup');
      const tok = result.session_token ?? '';
      setSession({ phone: e164, sessionToken: tok });
      setSessionToken(tok);
      const data = await lookupAppointment(e164, tok);
      setUpcoming(data.upcoming ?? null);
      setLastVisit(data.last_visit ?? null);
      setStep('found');
    } catch (err) {
      setError(err.error ?? 'Verification failed.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await sendOTP(toE164(phone), 'patient_lookup');
      setResent(true);
      setOtp('');
      setCdKey((k) => k + 1);
      setTimeout(() => setResent(false), 2800);
    } catch (err) {
      setError(err.error ?? 'Failed to resend.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!upcoming?.id || loading) return;
    setLoading(true);
    setError('');
    try {
      await cancelSlot(upcoming.id, sessionToken);
      setCancelStep('cancelled');
    } catch (err) {
      setError(err.error ?? 'Cancellation failed.');
    } finally {
      setLoading(false);
    }
  }

  // Format appointment for display
  function formatAppt(appt) {
    if (!appt) return '';
    if (appt.display_datetime) return appt.display_datetime;
    try {
      const dateStr = toISTDateStr(appt.slot_time);
      return `${formatDisplayDate(dateStr)} at ${formatSlotTime(appt.slot_time)}`;
    } catch { return ''; }
  }

  const displayPhone = toDisplayPhone(toE164(phone));

  return (
    <BottomSheet open={open} onClose={handleClose} maxHeight="88%">
      <div className="px-[20px] pb-[22px] pt-[8px] flex-1 overflow-y-auto">

        {/* ── STEP 1: Phone entry ── */}
        {step === 'phone' && (
          <>
            <h3 className="text-[16px] font-extrabold text-gray-900 tracking-tight mb-1">
              Appointment Lookup
            </h3>
            <p className="text-[12.5px] text-gray-400 mb-[18px]">
              Enter the number used for appointment
            </p>
            <div className="mb-3">
              <PhoneInput
                value={phone}
                onChange={setPhone}
                placeholder="98765 43210"
                disabled={loading}
              />
            </div>
            {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
            <button
              onClick={handleFind}
              disabled={phone.length < 10 || loading}
              className="w-full py-[13px] rounded-[14px] border-none font-bold text-[14.5px] cursor-pointer transition-all duration-200 disabled:cursor-not-allowed"
              style={{
                background: phone.length >= 10 ? accent : '#e5e7eb',
                color: phone.length >= 10 ? 'white' : '#9ca3af',
              }}
            >
              {loading ? 'Sending code…' : 'Find My Records'}
            </button>
          </>
        )}

        {/* ── STEP 2: OTP entry ── */}
        {step === 'otp' && (
          <>
            {/* Header */}
            <div className="flex items-center gap-[9px] mb-[14px]">
              <div
                className="w-[34px] h-[34px] rounded-[10px] flex items-center justify-center flex-shrink-0"
                style={{ background: `${accent}15` }}
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none">
                  <rect x="3" y="7" width="11" height="8.5" rx="2" stroke={accent} strokeWidth="1.4" />
                  <path d="M5.5 7V5a3 3 0 0 1 6 0v2" stroke={accent} strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx="8.5" cy="11" r="1.1" fill={accent} />
                </svg>
              </div>
              <div>
                <p className="text-[15px] font-extrabold text-gray-900 tracking-tight">Verify your identity</p>
                <p className="text-[11.5px] text-gray-400 mt-[1px]">{displayPhone}</p>
              </div>
            </div>

            {/* WhatsApp instructions banner */}
            <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl p-[11px_13px] mb-5 flex gap-[9px] items-start">
              <svg width="17" height="17" viewBox="0 0 18 18" fill="none" className="flex-shrink-0 mt-[1px]">
                <rect x="1" y="2" width="16" height="12" rx="3" stroke="#16a34a" strokeWidth="1.4" />
                <path d="M4 6h10M4 9h7" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" />
                <path d="M7 14l2 3 2-3" stroke="#16a34a" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p className="text-[12px] text-gray-700 leading-relaxed">
                We sent a <strong>4-digit verification code</strong> to your WhatsApp. Enter it below to view your records.
              </p>
            </div>

            {/* OTP boxes */}
            <div className="mb-5">
              <OTPInput value={otp} onChange={setOtp} accent={accent} disabled={loading} />
            </div>

            {error && <p className="text-[12px] text-red-500 text-center mb-3">{error}</p>}

            {/* Verify button */}
            <button
              onClick={handleVerify}
              disabled={otp.length < 4 || loading}
              className="w-full py-[13px] rounded-[14px] border-none font-bold text-[14.5px] cursor-pointer transition-all duration-200 mb-3 disabled:cursor-not-allowed"
              style={{
                background: otp.length === 4 ? accent : '#e5e7eb',
                color: otp.length === 4 ? 'white' : '#9ca3af',
                boxShadow: otp.length === 4 ? `0 4px 16px ${accent}38` : 'none',
              }}
            >
              {loading ? 'Verifying…' : 'Verify & View Records'}
            </button>

            {/* Resend */}
            <div className="text-center pb-6">
              {resent ? (
                <span className="text-[11px] font-semibold text-[#22c55e] uppercase tracking-[0.07em]">
                  ✓ Code resent to WhatsApp
                </span>
              ) : (
                <span className="text-[11px] text-gray-400">
                  Resend available in{' '}
                  <CountdownTimer key={cdKey} seconds={59} onExpire={() => {}} className="font-semibold" />
                  {' '}·{' '}
                  <button
                    onClick={handleResend}
                    disabled={loading}
                    className="bg-transparent border-none cursor-pointer text-[11px] font-bold uppercase tracking-[0.07em]"
                    style={{ color: accent }}
                  >
                    Resend Code
                  </button>
                </span>
              )}
            </div>
          </>
        )}

        {/* ── STEP 3: Results ── */}
        {step === 'found' && (
          <>
            {/* ── 3a: View ── */}
            {cancelStep === 'view' && (
              <>
                <h3 className="text-[16px] font-extrabold text-gray-900 tracking-tight mb-1">
                  Your Appointments
                </h3>
                <p className="text-[12.5px] text-gray-400 mb-4">
                  Verified · {displayPhone}
                </p>
                {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
                <div className="bg-[#f9fafb] rounded-2xl overflow-hidden border border-gray-100">
                  {upcoming ? (
                    <AppointmentCard
                      type="upcoming"
                      dateTime={formatAppt(upcoming)}
                      onCancel={() => setCancelStep('confirm')}
                    />
                  ) : (
                    <div className="p-4 text-center text-[13px] text-gray-400">No upcoming appointments</div>
                  )}
                  {lastVisit && (
                    <AppointmentCard type="last_visit" dateTime={formatAppt(lastVisit)} />
                  )}
                </div>
              </>
            )}

            {/* ── 3b: Confirm cancel ── */}
            {cancelStep === 'confirm' && (
              <div className="flex flex-col items-center py-1">
                <div className="w-[52px] h-[52px] rounded-full bg-red-50 flex items-center justify-center mb-4">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="#D93025" strokeWidth="1.8" />
                    <path d="M12 7v5M12 16v.5" stroke="#D93025" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <h3 className="text-[18px] font-extrabold text-gray-900 tracking-tight mb-[10px] text-center">
                  Cancel Appointment?
                </h3>
                <p className="text-[13px] text-gray-500 leading-relaxed text-center mb-[22px]">
                  Are you sure you want to cancel your appointment for{' '}
                  <strong className="text-gray-700">{formatAppt(upcoming)}</strong>?
                </p>
                {error && <p className="text-[12px] text-red-500 mb-3">{error}</p>}
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className="w-full py-[14px] rounded-[14px] border-none bg-[#D93025] text-white font-bold text-[15px] cursor-pointer mb-[10px] disabled:opacity-60"
                  style={{ boxShadow: '0 6px 20px rgba(217,48,37,0.28)', letterSpacing: '-0.01em' }}
                >
                  {loading ? 'Cancelling…' : 'Yes, Cancel'}
                </button>
                <button
                  onClick={() => { setCancelStep('view'); setError(''); }}
                  className="w-full py-[13px] rounded-[14px] border border-gray-200 bg-white text-gray-700 font-semibold text-[14px] cursor-pointer"
                >
                  Keep Appointment
                </button>
              </div>
            )}

            {/* ── 3c: Cancelled success ── */}
            {cancelStep === 'cancelled' && (
              <div className="flex flex-col items-center py-2">
                <div className="w-[72px] h-[72px] rounded-full bg-[#dcfce7] flex items-center justify-center mb-[18px]"
                  style={{ boxShadow: '0 4px 18px rgba(34,197,94,0.18)' }}
                >
                  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                    <path d="M7 18L14 25L27 10" stroke="#16a34a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h3 className="text-[20px] font-extrabold text-gray-900 tracking-tight mb-[10px] text-center">
                  Appointment Cancelled
                </h3>
                <p className="text-[12.5px] text-gray-500 leading-relaxed text-center mb-6">
                  Your appointment has been cancelled. A confirmation message has been sent to{' '}
                  <strong style={{ color: accent }}>{displayPhone}</strong>.
                </p>
                <button
                  onClick={handleClose}
                  className="w-full py-[14px] rounded-[14px] border-none text-white font-bold text-[15px] cursor-pointer"
                  style={{ background: accent, boxShadow: `0 6px 22px ${accent}42`, letterSpacing: '-0.01em' }}
                >
                  Back to Booking
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </BottomSheet>
  );
}
