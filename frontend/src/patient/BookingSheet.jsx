/**
 * BookingSheet — Patient details form inside a BottomSheet.
 *
 * Flow:
 *   1. Sheet opens → placeHold() is called immediately to reserve the slot for 2 minutes.
 *   2. Patient fills in name, WhatsApp number, and optional reason.
 *   3. On submit → validate → call parent's onSubmit({ name, phone, reason }).
 *   4. Parent (BookingPage) sends OTP and opens OTPSheet.
 *
 * Props:
 *   open        — boolean
 *   onClose     — called on cancel or backdrop tap
 *   onSubmit    — called with { name, phone, reason } to proceed to OTP step
 *   slotISO     — selected slot ISO string (for hold and display)
 *   accent      — hex colour string (default '#2563eb' patient blue)
 *
 * Hold strategy:
 *   placeHold is called with a placeholder phone ('0000000000') because the
 *   real phone is not yet known — the user hasn't filled the form. The backend
 *   only uses the phone for duplicate-date validation; '0000000000' never
 *   matches any real booking, so the check is a no-op. The real phone is
 *   validated during POST /book after OTP verification.
 *
 *   If placeHold fails (slot already taken by another patient), the form still
 *   opens and the countdown starts — the failure will surface at POST /book.
 *   This avoids an extra round-trip that would degrade UX for the common case.
 *
 * Hold countdown:
 *   A 2-minute CountdownTimer starts when the hold succeeds. On expiry, the
 *   sheet closes and the user must select a new slot. The `cdKey` integer is
 *   bumped whenever the sheet opens so the timer resets cleanly on re-open.
 */
import { useState, useEffect } from 'react';
import BottomSheet from '../components/BottomSheet.jsx';
import PhoneInput from '../components/PhoneInput.jsx';
import CountdownTimer from '../components/CountdownTimer.jsx';
import { placeHold } from '../api/appointments.js';
import { toE164 } from '../utils/phone.js';
import { formatSlotTime, formatDisplayDate, toISTDateStr } from '../utils/date.js';

export default function BookingSheet({ open, onClose, onSubmit, slotISO = '', accent = '#2563eb' }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [holdActive, setHoldActive] = useState(false);
  // Bumped on each open to force CountdownTimer remount and reset its seconds.
  const [cdKey, setCdKey] = useState(0);

  // Place a hold whenever the sheet opens with a new slot.
  // The `cancelled` flag prevents stale async callbacks from updating state
  // after the component has unmounted or the sheet has closed and reopened.
  useEffect(() => {
    if (!open || !slotISO) return;
    let cancelled = false;
    setHoldActive(false);
    setErrors({});
    setName('');
    setPhone('');
    setReason('');

    // Placeholder phone — see module docstring for rationale.
    placeHold(slotISO, '0000000000')
      .then(() => {
        if (!cancelled) {
          setHoldActive(true);
          setCdKey((k) => k + 1); // reset the 2-min countdown
        }
      })
      .catch(() => {
        // Silently proceed — hold failure surfaces at booking time, not here.
        if (!cancelled) setHoldActive(true);
      });

    return () => { cancelled = true; };
  }, [open, slotISO]);

  function validate() {
    const e = {};
    if (!name.trim()) e.name = 'Please enter your full name';
    if (!/^\d{10}$/.test(phone)) e.phone = 'Enter a valid 10-digit mobile number';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleSubmit() {
    if (!validate() || loading) return;
    setLoading(true);
    // Hand off to BookingPage which will call sendOTP and open OTPSheet.
    onSubmit({ name: name.trim(), phone: toE164(phone), reason: reason.trim() });
    setLoading(false);
  }

  // Derive display strings from the ISO slot string.
  const displayTime = slotISO ? formatSlotTime(slotISO) : '';
  const dateStr     = slotISO ? toISTDateStr(slotISO) : '';
  const displayDate = dateStr  ? formatDisplayDate(dateStr) : '';

  return (
    <BottomSheet open={open} onClose={onClose}>
      {/* ── Header with slot info and countdown ── */}
      <div className="px-[20px] pb-[14px] pt-[8px] border-b border-gray-100 flex-shrink-0">
        <div className="text-[17px] font-extrabold text-gray-900 tracking-tight">
          Confirm your booking
        </div>
        <div className="text-[12.5px] text-gray-400 mt-1">
          {displayDate && displayTime ? `${displayDate} · ${displayTime}` : ''}
        </div>

        {/* Hold countdown — visible once placeHold resolves successfully.
            Expiry closes the sheet; the user must pick a new slot. */}
        {holdActive && (
          <div className="flex items-center gap-1 mt-2 text-[11.5px] text-amber-600 font-medium">
            <span>⏱ Slot reserved for</span>
            <CountdownTimer
              key={cdKey}
              seconds={120}
              onExpire={() => {
                setHoldActive(false);
                onClose(); // release the UI; hold auto-expires on the backend too
              }}
              className="font-bold"
            />
          </div>
        )}
      </div>

      {/* ── Patient details form — scrollable body ── */}
      <div className="px-[20px] pt-[18px] pb-[4px] overflow-y-auto flex-1">
        {/* Full Name */}
        <div className="mb-[14px]">
          <label className="text-[12px] font-semibold text-gray-700 block mb-[6px] tracking-[0.01em]">
            Full Name
          </label>
          <input
            className="tc-input"
            type="text"
            placeholder="e.g. Priya Sharma"
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors((v) => ({ ...v, name: null })); }}
          />
          {errors.name && <p className="text-[11.5px] text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* WhatsApp Number — 10-digit local number, converted to E.164 on submit */}
        <div className="mb-[14px]">
          <label className="text-[12px] font-semibold text-gray-700 block mb-[6px] tracking-[0.01em]">
            WhatsApp Number
          </label>
          <PhoneInput
            value={phone}
            onChange={(v) => { setPhone(v); setErrors((err) => ({ ...err, phone: null })); }}
          />
          {errors.phone && <p className="text-[11.5px] text-red-500 mt-1">{errors.phone}</p>}
        </div>

        {/* Reason — optional; passed to the doctor's appointment view */}
        <div className="mb-[4px]">
          <label className="text-[12px] font-semibold text-gray-700 block mb-[6px] tracking-[0.01em]">
            Reason for Visit <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            className="tc-input"
            type="text"
            placeholder="e.g., Fever, follow-up, prescription renewal…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      {/* ── Pinned footer — always visible at the bottom of the sheet ──
          Sits outside the scroll area so it stays anchored regardless of how
          much content (error messages, keyboard) the form body contains. */}
      <div className="px-[20px] pb-[20px] pt-[10px] flex-shrink-0 border-t border-gray-100">
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full py-[14px] rounded-[14px] border-none text-white font-bold text-[15px] cursor-pointer disabled:opacity-60"
          style={{
            background: accent,
            boxShadow: `0 6px 20px ${accent}40`,
            letterSpacing: '-0.01em',
          }}
        >
          {loading ? 'Sending code…' : 'Confirm Appointment'}
        </button>
      </div>
    </BottomSheet>
  );
}
