/**
 * DuplicateAlert — Shown when a patient tries to book a second slot on the same day.
 *
 * Business rule: one appointment per phone number per IST calendar date.
 * The backend returns HTTP 409 duplicate_date from POST /hold, which BookingPage
 * catches and routes here.
 *
 * Props:
 *   open         — boolean
 *   onClose      — called to dismiss without action
 *   onRebook     — called when cancel-and-rebook flow completes successfully
 *   existingSlot — { dateTime: string } describing the existing appointment
 *   accent       — hex colour string
 *
 * Three-step internal flow:
 *   'view'      — warning panel: "Keep Existing" | "Cancel & Rebook"
 *   'confirm'   — confirmation step before destructive cancel
 *   'cancelled' — animated progress ring → auto-advance to OTP flow
 *
 * The animated ring in the 'cancelled' step uses setInterval to drive a
 * progress value from 0 to 1 over 2 seconds, then calls onClose() + onRebook()
 * to transition to the OTP sheet. The 300ms delay before onRebook gives the
 * sheet time to animate out before the next one opens.
 *
 * SVG ring math:
 *   strokeDasharray = 2π × r = 2π × 30 ≈ 188.5
 *   strokeDashoffset = circumference × (1 - progress) creates the fill effect.
 *   The SVG is rotated -90° so the fill starts from the top (12 o'clock position).
 */
import { useState, useEffect, useRef } from 'react';
import BottomSheet from '../components/BottomSheet.jsx';

export default function DuplicateAlert({ open, onClose, onRebook, existingSlot, accent = '#2563eb' }) {
  const [step, setStep] = useState('view'); // 'view' | 'confirm' | 'cancelled'
  const [progress, setProgress] = useState(0);
  const tickRef = useRef(null);

  // Drive the cancel animation when the step enters 'cancelled'.
  // setInterval at ~33ms gives ~30fps for the ring fill animation.
  useEffect(() => {
    if (step !== 'cancelled') return;
    setProgress(0);
    const start = Date.now();
    const total = 2000; // 2-second animation

    tickRef.current = setInterval(() => {
      const pct = Math.min((Date.now() - start) / total, 1);
      setProgress(pct);
      if (pct >= 1) {
        clearInterval(tickRef.current);
        onClose();
        // Brief pause so the sheet slide-out animation completes before the OTP sheet opens.
        setTimeout(() => onRebook?.(), 300);
      }
    }, 30);

    return () => clearInterval(tickRef.current);
  }, [step, onClose, onRebook]);

  function handleClose() {
    onClose();
    // Reset to 'view' after the sheet slides out (300ms transition duration).
    setTimeout(() => setStep('view'), 420);
  }

  const existingDateTime = existingSlot?.dateTime ?? 'your existing appointment';
  const CIRCUMFERENCE = 2 * Math.PI * 30; // SVG circle r=30

  return (
    <BottomSheet open={open} onClose={handleClose}>
      <div className="px-[24px] pb-[32px] pt-[8px]">

        {/* ── STEP 1: Duplicate warning ── */}
        {step === 'view' && (
          <>
            {/* Amber warning triangle */}
            <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4 mt-1">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <path d="M12 3L21.5 20H2.5L12 3Z" stroke="#f59e0b" strokeWidth="1.8" strokeLinejoin="round" fill="#fef3c7" />
                <path d="M12 9v5" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />
                <circle cx="12" cy="17" r="1" fill="#f59e0b" />
              </svg>
            </div>

            <h3 className="text-[20px] font-extrabold text-[#0f172a] tracking-tight text-center mb-3">
              One Appointment per Day
            </h3>
            <p className="text-[13.5px] text-slate-500 leading-relaxed text-center mb-7">
              You already have an appointment scheduled for{' '}
              <strong className="text-slate-800">{existingDateTime}</strong>. We limit scheduling to one appointment per day.
            </p>

            <button onClick={handleClose} className="btn-verify w-full mb-3">
              Keep Existing Appointment
            </button>

            <button
              onClick={() => setStep('confirm')}
              className="w-full h-12 rounded-2xl border border-gray-200 bg-white text-red-600 font-semibold text-[14.5px] cursor-pointer transition-colors duration-150 hover:bg-red-50"
            >
              Cancel Existing &amp; Rebook
            </button>
          </>
        )}

        {/* ── STEP 2: Confirm cancellation ── */}
        {step === 'confirm' && (
          <div className="flex flex-col items-center">
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
              Are you sure you want to cancel your existing appointment?
            </p>
            <button
              onClick={() => setStep('cancelled')}
              className="w-full py-[14px] rounded-[14px] border-none bg-[#D93025] text-white font-bold text-[15px] cursor-pointer mb-[10px]"
              style={{ boxShadow: '0 6px 20px rgba(217,48,37,0.28)', letterSpacing: '-0.01em' }}
            >
              Yes, Cancel
            </button>
            <button
              onClick={() => setStep('view')}
              className="w-full py-[13px] rounded-[14px] border border-gray-200 bg-white text-gray-700 font-semibold text-[14px] cursor-pointer"
            >
              Keep Appointment
            </button>
          </div>
        )}

        {/* ── STEP 3: Animated progress ring ── */}
        {step === 'cancelled' && (
          <div className="flex flex-col items-center">
            {/* SVG ring: rotated -90° so progress fills clockwise from 12 o'clock */}
            <div className="relative w-[72px] h-[72px] mb-[18px]">
              <svg width="72" height="72" viewBox="0 0 72 72" style={{ transform: 'rotate(-90deg)' }}>
                {/* Track (grey background ring) */}
                <circle cx="36" cy="36" r="30" fill="none" stroke="#f1f5f9" strokeWidth="5" />
                {/* Fill ring: dashoffset shrinks as progress approaches 1 */}
                <circle
                  cx="36" cy="36" r="30" fill="none" stroke="#22c55e" strokeWidth="5"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 0.03s linear' }}
                />
              </svg>
              {/* Checkmark centred over the ring */}
              <div className="absolute inset-0 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <path d="M5 14l7 7 11-11" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            <h3 className="text-[18px] font-extrabold text-gray-900 tracking-tight mb-2 text-center">
              Slot Cancelled
            </h3>
            <p className="text-[13px] text-gray-500 leading-relaxed text-center mb-5">
              Booking your new appointment automatically…
            </p>
            {/* Linear progress bar mirrors the ring animation */}
            <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#22c55e] rounded-full"
                style={{ width: `${progress * 100}%`, transition: 'width 0.03s linear' }}
              />
            </div>
          </div>
        )}

      </div>
    </BottomSheet>
  );
}
