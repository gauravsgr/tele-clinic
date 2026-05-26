/**
 * OTPGate — Full-screen blurred overlay for doctor daily login.
 *
 * Renders on top of DashboardPage and hides when the doctor's OTP is verified.
 * The overlay uses backdrop-filter:blur(4px) + a dark semi-transparent background
 * to obscure the dashboard beneath it, making the login feel like a native lock screen.
 *
 * Props:
 *   onVerified — called with doctorToken (string) after successful verification;
 *                DoctorApp stores this token in React state (never localStorage).
 *
 * Authentication flow:
 *   1. Component mounts → sendOTP(DOCTOR_PHONE, 'doctor_login') is called immediately.
 *      `sending = true` while the request is in-flight; the verify button is disabled.
 *   2. Doctor receives the 4-digit OTP via WhatsApp and enters it.
 *   3. verifyOTP → backend validates OTP (or bcrypt emergency PIN).
 *   4. onVerified(session_token) is called → DoctorApp sets doctorToken → overlay unmounts.
 *
 * Emergency PIN:
 *   The backend's /otp/verify endpoint also accepts a bcrypt-hashed PIN
 *   (DOCTOR_EMERGENCY_PIN_HASH in .env) for situations where WhatsApp is down.
 *   The frontend doesn't know or care — it just passes whatever the doctor typed.
 *
 * Doctor phone:
 *   Read from VITE_DOCTOR_PHONE env var (set in frontend/.env.local).
 *   Falls back to '919999999999' for development (mock mode accepts any OTP).
 *
 * Time-of-day greeting:
 *   Computed once on mount from the browser clock — no effect hook needed.
 *   It's cosmetic and doesn't need to update while the overlay is visible.
 */
import { useState, useEffect } from 'react';
import OTPInput from '../components/OTPInput.jsx';
import CountdownTimer from '../components/CountdownTimer.jsx';
import { sendOTP, verifyOTP } from '../api/auth.js';
import { ACCENT_DOCTOR } from '../utils/constants.js';

// Read from build-time env (Vite replaces import.meta.env.* at build time).
// In development with mock mode, any 4-digit code is accepted by the backend.
const DOCTOR_PHONE    = import.meta.env.VITE_DOCTOR_PHONE ?? '919999999999';
const DOCTOR_NAME     = 'Dr. Lakshimi Sagar';
const DOCTOR_INITIALS = 'LS';

export default function OTPGate({ onVerified }) {
  const [otp, setSotp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [cdKey, setCdKey] = useState(0); // bumped to reset the resend countdown
  // `sending` is true while the initial OTP is being sent on mount.
  // The verify button is disabled during this time so the doctor can't submit
  // before the OTP has been dispatched.
  const [sending, setSending] = useState(true);

  // Send OTP immediately on mount — doctor doesn't need to click "Send".
  // .catch() still clears sending=true so the UI isn't stuck in the sending state
  // if the WhatsApp worker is down (doctor can still try the emergency PIN).
  useEffect(() => {
    sendOTP(DOCTOR_PHONE, 'doctor_login')
      .then(() => setSending(false))
      .catch(() => setSending(false));
  }, []);

  async function handleVerify() {
    if (otp.length < 4 || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await verifyOTP(DOCTOR_PHONE, otp, 'doctor_login');
      // session_token is the signed backend token; fall back to the raw OTP
      // only as a last resort (should never happen in practice).
      onVerified(result.session_token ?? otp);
    } catch (err) {
      setError(err.error ?? 'Incorrect OTP. Try again or use your emergency PIN.');
      setSotp(''); // clear the boxes so the doctor can retry
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await sendOTP(DOCTOR_PHONE, 'doctor_login');
      setResent(true);
      setSotp('');
      setCdKey((k) => k + 1); // restart 59s countdown
      setTimeout(() => setResent(false), 2800);
    } catch {
      setError('Failed to resend. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // Greeting computed once from the current hour — purely cosmetic.
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col items-center justify-center px-6"
      style={{ backdropFilter: 'blur(4px)', background: 'rgba(15,15,15,0.78)' }}
      data-testid="otp-gate"
      role="dialog"
      aria-label="Doctor login"
      aria-modal="true"
    >
      {/* Doctor avatar — green gradient initials circle with WhatsApp badge */}
      <div className="relative mb-4">
        <div className="w-[72px] h-[72px] rounded-[22px] bg-gradient-to-br from-[#a7f3d0] to-[#6ee7b7] flex items-center justify-center shadow-lg">
          <span className="text-[22px] font-extrabold text-[#065f46] select-none tracking-tight">
            {DOCTOR_INITIALS}
          </span>
        </div>
        {/* WhatsApp badge — communicates that the OTP arrives via WhatsApp */}
        <div className="absolute -bottom-1 -right-1 w-[24px] h-[24px] rounded-full bg-white flex items-center justify-center shadow-md">
          <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="16" fill="#25D366" />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M22.7 9.3A9.35 9.35 0 0 0 16 6.6c-5.19 0-9.4 4.21-9.4 9.4 0 1.66.44 3.28 1.27 4.7l-1.37 5 5.16-1.35a9.38 9.38 0 0 0 4.34 1.1c5.19 0 9.4-4.21 9.4-9.4 0-2.51-.98-4.87-2.7-6.65z"
              fill="white"
            />
          </svg>
        </div>
      </div>

      {/* Greeting and status message */}
      <p className="text-white text-[18px] font-extrabold tracking-tight mb-1 text-center">
        {greeting}, {DOCTOR_NAME}.
      </p>
      <p className="text-white/60 text-[12px] font-medium mb-6 text-center">
        {sending ? 'Sending OTP via WhatsApp…' : 'Enter your WhatsApp OTP to continue.'}
      </p>

      {/* OTP boxes — disabled while initial OTP is being sent */}
      <div className="w-full mb-5">
        <OTPInput value={otp} onChange={setSotp} accent={ACCENT_DOCTOR} disabled={loading || sending} />
      </div>

      {error && (
        <p className="text-red-400 text-[12px] text-center mb-3">{error}</p>
      )}

      {/* Verify button — disabled until 4 digits entered AND initial OTP send completes */}
      <button
        onClick={handleVerify}
        disabled={otp.length < 4 || loading || sending}
        className="w-full py-[14px] rounded-[14px] border-none font-bold text-[15px] cursor-pointer mb-4 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: otp.length === 4 ? ACCENT_DOCTOR : '#4b5563',
          color: 'white',
          letterSpacing: '-0.01em',
          boxShadow: otp.length === 4 ? `0 6px 22px ${ACCENT_DOCTOR}50` : 'none',
        }}
      >
        {loading ? 'Verifying…' : 'Login to Dashboard'}
      </button>

      {/* Resend row with 59s countdown */}
      <div className="text-center text-white/50 text-[12px]">
        {resent ? (
          <span className="text-[#22c55e]">✓ Code resent to WhatsApp</span>
        ) : (
          <span>
            Resend in{' '}
            <CountdownTimer key={cdKey} seconds={59} onExpire={() => {}} className="font-bold text-white/70" />
            {' · '}
            <button
              onClick={handleResend}
              disabled={loading}
              className="bg-transparent border-none cursor-pointer text-[12px] font-semibold underline underline-offset-2 text-white/60"
            >
              Resend
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
