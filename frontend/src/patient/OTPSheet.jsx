/**
 * OTPSheet — Universal OTP verification bottom sheet.
 *
 * Used for:
 *   - Booking confirmation (purpose='patient_booking')
 *   - Appointment lookup (purpose='patient_lookup')
 *   - Cancel-and-rebook (same as booking)
 *
 * Props:
 *   open        — boolean
 *   onClose     — called on backdrop tap
 *   onVerified  — called with sessionToken (string) on successful verification
 *   phone       — 10-digit string (displayed masked, e.g. '+91 •••••43210')
 *   purpose     — OTP purpose passed to verifyOTP
 *   accent      — hex colour string (default '#2563eb' patient blue)
 *
 * OTP lifecycle in this component:
 *   1. The parent (BookingPage) calls sendOTP before opening this sheet.
 *   2. On open, the component resets its state and restarts the 59-second resend countdown.
 *   3. Patient enters 4 digits → handleVerify() calls verifyOTP → onVerified(sessionToken).
 *   4. "Resend" button calls sendOTP again and resets the countdown (cdKey bump).
 *
 * The 59-second countdown matches the backend's OTP_RESEND_COOLDOWN_SECONDS (59s).
 * If the patient clicks resend before 59s, the backend returns 429 resend_too_soon.
 */
import { useState, useEffect } from 'react';
import BottomSheet from '../components/BottomSheet.jsx';
import OTPInput from '../components/OTPInput.jsx';
import CountdownTimer from '../components/CountdownTimer.jsx';
import { sendOTP, verifyOTP } from '../api/auth.js';
import { toE164, maskPhone } from '../utils/phone.js';

/** Inline WhatsApp brand icon — avoids an icon library dependency. */
function WAIcon({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.7 9.3A9.35 9.35 0 0 0 16 6.6c-5.19 0-9.4 4.21-9.4 9.4 0 1.66.44 3.28 1.27 4.7l-1.37 5 5.16-1.35a9.38 9.38 0 0 0 4.34 1.1c5.19 0 9.4-4.21 9.4-9.4 0-2.51-.98-4.87-2.7-6.65zm-6.7 14.45a7.8 7.8 0 0 1-3.97-1.08l-.28-.17-2.93.77.78-2.86-.19-.3a7.8 7.8 0 0 1-1.2-4.21c0-4.31 3.51-7.82 7.82-7.82 2.09 0 4.05.81 5.53 2.29a7.77 7.77 0 0 1 2.29 5.54c0 4.32-3.51 7.84-7.85 7.84z"
        fill="white"
      />
    </svg>
  );
}

export default function OTPSheet({ open, onClose, onVerified, phone = '', purpose = 'patient_booking', accent = '#2563eb' }) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  // Bumped on open and on each resend to force CountdownTimer remount and restart.
  const [cdKey, setCdKey] = useState(0);

  // Reset the sheet state whenever it opens (e.g. re-opening after a wrong code).
  useEffect(() => {
    if (open) {
      setOtp('');
      setError('');
      setResent(false);
      setCdKey((k) => k + 1);
    }
  }, [open]);

  async function handleVerify() {
    if (otp.length < 4 || loading) return;
    setLoading(true);
    setError('');
    try {
      const e164 = toE164(phone);
      const result = await verifyOTP(e164, otp, purpose);
      // sessionToken is passed back to the parent to either store (patient) or use directly (booking).
      onVerified(result.session_token ?? '');
    } catch (err) {
      setError(err.error ?? 'Verification failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await sendOTP(toE164(phone), purpose);
      setResent(true);
      setOtp('');
      setCdKey((k) => k + 1); // restart the countdown
      // Brief "Code resent" confirmation, then revert to the countdown row.
      setTimeout(() => setResent(false), 2800);
    } catch (err) {
      setError(err.error ?? 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  }

  // maskPhone converts '919876543210' → '+91 •••••43210'
  const masked = phone ? maskPhone(toE164(phone)) : '+91 ••••••••••';
  const filled  = otp.length === 4;

  return (
    <BottomSheet open={open} onClose={onClose}>
      <div className="px-[22px] pb-[26px] pt-[16px]">
        {/* Lock + WhatsApp badge icon */}
        <div className="flex justify-center mb-[14px]">
          <div className="relative w-[60px] h-[60px]">
            <div
              className="w-[60px] h-[60px] rounded-[18px] flex items-center justify-center"
              style={{ background: `${accent}15` }} // 15 = 8% opacity in hex
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <rect x="5" y="12" width="18" height="14" rx="3" stroke={accent} strokeWidth="2" />
                <path d="M9 12V9a5 5 0 0 1 10 0v3" stroke={accent} strokeWidth="2" strokeLinecap="round" />
                <circle cx="14" cy="19" r="2" fill={accent} />
                <path d="M14 21v2" stroke={accent} strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </div>
            {/* WhatsApp badge pinned to bottom-right of the lock icon */}
            <div className="absolute -bottom-1 -right-1 w-[22px] h-[22px] rounded-full bg-white flex items-center justify-center shadow-md">
              <WAIcon size={16} />
            </div>
          </div>
        </div>

        {/* Title + description */}
        <div className="text-center mb-[16px]">
          <h3 className="text-[17px] font-extrabold text-gray-900 tracking-tight mb-[6px]">
            Verify Your WhatsApp Number
          </h3>
          <p className="text-[12.5px] text-gray-500 leading-relaxed max-w-[290px] mx-auto">
            We sent a <strong className="text-gray-700">4-digit verification code</strong> via WhatsApp to{' '}
            <span className="font-bold" style={{ color: accent }}>{masked}</span>. Enter it below.
          </p>
        </div>

        {/* OTP boxes */}
        <div className="mb-[22px]">
          <OTPInput value={otp} onChange={setOtp} accent={accent} disabled={loading} />
        </div>

        {/* Inline error message */}
        {error && (
          <p className="text-[12px] text-red-500 text-center mb-3">{error}</p>
        )}

        {/* Verify button — grey when incomplete, accent when all 4 digits entered */}
        <button
          onClick={handleVerify}
          disabled={!filled || loading}
          className="w-full py-[15px] rounded-[14px] border-none font-bold text-[15px] cursor-pointer transition-all duration-200 mb-[13px] disabled:cursor-not-allowed"
          style={{
            background: filled ? accent : '#e5e7eb',
            color: filled ? 'white' : '#9ca3af',
            letterSpacing: '-0.01em',
            boxShadow: filled ? `0 6px 22px ${accent}40` : 'none',
          }}
        >
          {loading ? 'Verifying…' : 'Verify & Complete Action'}
        </button>

        {/* Resend row — shows countdown then inline "Resend now" link */}
        <div className="text-center">
          {resent ? (
            <span className="text-[12px] font-medium text-[#22c55e]">✓ Code resent to WhatsApp</span>
          ) : (
            <span className="text-[12px] text-gray-400 flex items-center justify-center gap-[5px]">
              <WAIcon size={13} />
              Didn&apos;t receive code? Resend via WhatsApp (
              {/* key=cdKey forces remount/reset of the 59s countdown on each resend */}
              <CountdownTimer key={cdKey} seconds={59} onExpire={() => {}} className="inline" />
              )&nbsp;
              <button
                onClick={handleResend}
                disabled={loading}
                className="bg-transparent border-none cursor-pointer text-[12px] underline underline-offset-2 font-medium"
                style={{ color: accent }}
              >
                Resend now
              </button>
            </span>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
