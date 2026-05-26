/**
 * BookingPage — The main patient-facing appointment scheduling interface.
 *
 * This is the root component for the `/` route. It handles the complete booking
 * funnel from initial slot selection through OTP verification to the success screen.
 *
 * Layout sections (top → bottom):
 *   1. Doctor profile header — avatar initials, name, specialty, slot duration badge
 *   2. "Manage Existing Appointment" CTA — opens LookupSheet
 *   3. "Select an Appointment Time" heading + date strip (28-day horizontal scroll)
 *   4. Slot legend (Selected / Available / Taken colour key)
 *   5. Slot grid — Morning (10:00–11:45) + Evening (16:00–18:45), 2-column layout
 *   6. Sticky confirm bar — appears on slot selection, hides otherwise
 *   7. Home indicator bar (iOS affordance)
 *
 * Slot pill states (derived from API + local selection):
 *   selected  — blue background, white text, box shadow
 *   available — white bg, gray border, hover effect
 *   held      — amber; non-tappable (another user has a 2-minute hold on it)
 *   booked    — light gray; non-tappable (confirmed booking exists)
 *   cutoff    — light gray; non-tappable (within 1 hour of slot start)
 *
 * Polling:
 *   Slot statuses are refreshed every 15 seconds via setInterval. This ensures
 *   held slots appear/expire in near-real-time without a manual refresh. The
 *   interval is cleared on unmount via the useEffect cleanup.
 *
 * Booking state machine:
 *   screen='scheduler' → user selects slot → taps confirm bar
 *     → BookingSheet opens (name/phone/reason form)
 *     → BookingSheet submits → sendOTP() fires
 *       → if 409 duplicate_date: DuplicateAlert opens
 *       → else: OTPSheet opens
 *         → OTP verified → bookSlot() → SuccessScreen (screen='success')
 *
 *   DuplicateAlert → "Cancel & Rebook" → animated ring countdown
 *     → calls onRebook() → OTPSheet reopens
 *
 * Timing notes (380ms / 300ms delays):
 *   The 380ms delay before opening OTPSheet/DuplicateAlert matches the
 *   BookingSheet slide-out CSS transition (300ms ease-out + small buffer).
 *   Opening a new sheet during another sheet's close animation causes visual
 *   glitching on lower-end devices.
 *
 * `slotClass` helper:
 *   Returns a Tailwind class string for a slot button based on API status +
 *   local selection + cutoff state. Order of conditions matters: `isSelected`
 *   takes priority over all other states (a selected slot that also happens to
 *   be near cutoff should show as selected, not grayed out).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import StatusBar from '../components/StatusBar.jsx';
import Toast from '../components/Toast.jsx';
import BookingSheet from './BookingSheet.jsx';
import OTPSheet from './OTPSheet.jsx';
import DuplicateAlert from './DuplicateAlert.jsx';
import LookupSheet from './LookupSheet.jsx';
import SuccessScreen from './SuccessScreen.jsx';
import { getSlots, bookSlot, cancelAndRebook } from '../api/appointments.js';
import { sendOTP } from '../api/auth.js';
import { generateDateStrip, generateMorningSlots, generateEveningSlots, formatSlotTime, formatDisplayDate, toISTDateStr, isPastCutoff } from '../utils/date.js';
import { ACCENT_PATIENT } from '../utils/constants.js';

const DOCTOR_NAME = 'Dr. Lakshimi Sagar';
const DOCTOR_INITIALS = 'LS';
const SLOT_DURATION = '15 min';
const accent = ACCENT_PATIENT;

// ── Slot pill states ──────────────────────────────────────────────────────
// API status values (from slotStatusMap): 'available' | 'held' | 'booked' | undefined
// Local selection state: tracked separately as `selectedSlot` (ISO string or null)
//
// Priority order (highest to lowest):
//   1. isSelected  — patient has tapped this slot; accent bg regardless of API status
//   2. isCutoff / booked — permanently disabled (gray, non-interactive)
//   3. held        — temporarily disabled (amber; 2-min hold by another patient)
//   4. default     — available, fully interactive

function slotClass(apiStatus, isSelected, isCutoff) {
  if (isSelected) return 'bg-p-accent text-white border-none shadow-md';
  if (isCutoff || apiStatus === 'booked') return 'bg-gray-100 text-gray-400 border-none cursor-not-allowed opacity-70';
  if (apiStatus === 'held') return 'bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed';
  return 'bg-white text-gray-800 border border-gray-200 hover:border-p-accent hover:shadow-sm';
}

export default function BookingPage() {
  const dateStrip = generateDateStrip();

  const [activeDateIdx, setActiveDateIdx] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState(null); // ISO string
  const [slotStatusMap, setSlotStatusMap] = useState({}); // { isoStr: 'available'|'held'|'booked' }
  const [screen, setScreen] = useState('scheduler'); // 'scheduler' | 'success'

  // Sheets
  const [sheetOpen, setSheetOpen] = useState(false);
  const [otpOpen, setOtpOpen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);

  // Booking in-progress data
  const [pendingBooking, setPendingBooking] = useState(null); // { name, phone, reason, slotISO }
  const [bookedAppointment, setBookedAppointment] = useState(null);
  const [existingSlot, setExistingSlot] = useState(null);

  // Toast
  const [toast, setToast] = useState({ visible: false, message: '', variant: 'success' });

  const pollRef = useRef(null);

  // ── Load slots ──────────────────────────────────────────────────────────
  // Fetches the full 28-day slot availability map from the backend.
  // The result is stored as { [isoString]: status } for O(1) lookup during render.
  //
  // `useCallback` with empty deps: `dateStrip` is computed from `generateDateStrip()`
  // which always returns the same 28 dates for the same calendar day. It does not
  // change within a session, so the empty deps array is intentionally correct.
  // The eslint-disable comment suppresses the false positive from exhaustive-deps.
  //
  // Silent failure: if the API call fails, the existing map remains visible.
  // The user can still interact with the UI; on the next 15s poll, the map will
  // refresh. This is preferable to clearing the map and showing all slots as "available".
  const loadSlots = useCallback(async () => {
    const from = dateStrip[0]?.dateStr;
    const to = dateStrip[dateStrip.length - 1]?.dateStr;
    if (!from || !to) return;
    try {
      const data = await getSlots(from, to);
      const map = {};
      // GET /slots returns a bare array — not wrapped in { slots: [...] }
      (Array.isArray(data) ? data : []).forEach((s) => { map[s.slot_time] = s.status; });
      setSlotStatusMap(map);
    } catch {
      // fail silently — show whatever we have
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadSlots();
    // 15s poll interval: short enough to reflect slot holds (2-min lifespan)
    // within a reasonable timeframe, without hammering the backend.
    pollRef.current = setInterval(loadSlots, 15_000);
    return () => clearInterval(pollRef.current);
  }, [loadSlots]);

  // ── Date strip ─────────────────────────────────────────────────────────
  const activeDate = dateStrip[activeDateIdx];

  // Generate slots for selected date
  const morningSlots = activeDate ? generateMorningSlots(activeDate.dateStr) : [];
  const eveningSlots = activeDate ? generateEveningSlots(activeDate.dateStr) : [];

  function slotLabel(iso) { return formatSlotTime(iso); }
  function isDisabled(iso) {
    const status = slotStatusMap[iso];
    return isPastCutoff(iso) || status === 'booked' || status === 'held';
  }

  function handleSlotClick(iso) {
    if (isDisabled(iso)) return;
    setSelectedSlot((prev) => (prev === iso ? null : iso));
  }

  // ── Confirm ─────────────────────────────────────────────────────────────
  function handleConfirm() {
    if (!selectedSlot) return;
    setSheetOpen(true);
  }

  // ── BookingSheet submitted ───────────────────────────────────────────────
  // This handler is the booking funnel's decision point after the patient fills
  // in their name/phone/reason. It fires sendOTP() which triggers the backend
  // to both: (a) check for duplicates and (b) send the WhatsApp OTP.
  //
  // The 'duplicate_date' error code (HTTP 409) short-circuits the OTP flow and
  // redirects to DuplicateAlert instead. The 380ms delay matches the
  // BookingSheet slide-out animation so the DuplicateAlert appears after the
  // previous sheet is fully dismissed.
  async function handleBookingSubmit({ name, phone, reason }) {
    setPendingBooking({ name, phone, reason, slotISO: selectedSlot });
    setSheetOpen(false);

    // sendOTP with purpose='patient_booking' triggers the duplicate check on the
    // backend. If the patient already has a booking for this IST calendar date,
    // the backend returns 409 { code: 'duplicate_date', existing_datetime: ... }.
    try {
      await sendOTP(phone, 'booking');
    } catch (err) {
      if (err.code === 'duplicate_date') {
        setExistingSlot({ dateTime: err.existing_datetime ?? 'your existing appointment' });
        setTimeout(() => setDupOpen(true), 380);
        return;
      }
      showToast('Failed to send OTP. Please try again.', 'error');
      return;
    }
    setTimeout(() => setOtpOpen(true), 380);
  }

  // ── OTP verified → book ──────────────────────────────────────────────────
  // Called by OTPSheet after the patient's code is verified. `sessionToken` is
  // the JWT returned by the backend's /otp/verify endpoint, which is then
  // forwarded to /book as proof of identity.
  //
  // On success: close OTPSheet, build the `bookedAppointment` summary object,
  // then switch to the success screen after 380ms (OTPSheet slide-out).
  // On failure: show an error toast without clearing pendingBooking — the patient
  // can retry the booking form or choose a different slot.
  async function handleOTPVerified(sessionToken) {
    if (!pendingBooking) return;
    try {
      const result = await bookSlot(
        pendingBooking.slotISO,
        sessionToken,
        pendingBooking.name,
        pendingBooking.phone,
        pendingBooking.reason
      );
      setOtpOpen(false);
      // Pre-format the date and time for SuccessScreen so the success view
      // doesn't need to import date utilities.
      setBookedAppointment({
        name: pendingBooking.name,
        date: formatDisplayDate(toISTDateStr(pendingBooking.slotISO)),
        time: formatSlotTime(pendingBooking.slotISO),
        duration: SLOT_DURATION,
        doctorName: DOCTOR_NAME,
        appointmentId: result.appointment_id,
      });
      setTimeout(() => setScreen('success'), 380);
    } catch (err) {
      showToast(err.error ?? 'Booking failed. Please try again.', 'error');
    }
  }

  // ── Rebook after duplicate alert ──────────────────────────────────────────
  function handleRebook() {
    // Reopen OTP gate with same slot
    setTimeout(() => setOtpOpen(true), 300);
  }

  // ── Reset to scheduler ────────────────────────────────────────────────────
  function handleReset() {
    setScreen('scheduler');
    setSelectedSlot(null);
    setActiveDateIdx(0);
    setBookedAppointment(null);
    setPendingBooking(null);
    loadSlots();
  }

  function showToast(message, variant = 'success') {
    setToast({ visible: true, message, variant });
  }

  // ── Confirm bar label ─────────────────────────────────────────────────────
  function confirmLabel() {
    if (!selectedSlot || !activeDate) return '';
    return `Confirm · ${activeDate.dayLabel} ${activeDate.dayNum}, ${formatSlotTime(selectedSlot)}`;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-white">
      <StatusBar side="patient" />

      <Toast
        message={toast.message}
        variant={toast.variant}
        visible={toast.visible}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />

      {screen === 'scheduler' ? (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Doctor profile header */}
          <div className="mx-4 my-[14px] flex items-center gap-[13px] flex-shrink-0">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#c7d2fe] to-[#a5b4fc] border-[2.5px] border-white shadow-[0_2px_8px_rgba(99,102,241,0.22)] flex items-center justify-center flex-shrink-0">
              <span className="text-[18px] font-extrabold text-[#3730a3] select-none tracking-tight">
                {DOCTOR_INITIALS}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-[18px] font-extrabold text-[#0f172a] tracking-tight leading-tight">
                {DOCTOR_NAME}
              </h2>
              <p className="text-[12.5px] text-slate-500 mt-[3px] font-medium">
                General Practitioner · Telehealth
              </p>
            </div>
            <div className="flex-shrink-0 bg-indigo-50 rounded-full px-3 py-[5px] inline-flex items-center">
              <span className="text-[11.5px] font-bold text-indigo-700 whitespace-nowrap">
                {SLOT_DURATION}
              </span>
            </div>
          </div>

          {/* Manage appointment CTA */}
          <div className="px-4 pb-3 flex-shrink-0">
            <button
              onClick={() => setLookupOpen(true)}
              className="w-full min-h-[44px] flex items-center justify-center bg-white rounded-[14px] font-semibold text-[14.5px] cursor-pointer transition-colors duration-150 px-4 py-[10px]"
              style={{
                border: `1.5px solid ${accent}`,
                color: accent,
                letterSpacing: '-0.01em',
              }}
            >
              Manage Existing Appointment
            </button>
          </div>

          {/* Section title */}
          <div className="px-5 pb-[10px] flex-shrink-0 border-b border-gray-100">
            <h1 className="text-[17px] font-extrabold text-gray-900 tracking-tight leading-snug">
              Select an Appointment Time
            </h1>
          </div>

          {/* Date strip */}
          <div className="flex-shrink-0 pt-3 pb-1">
            <div className="px-5 flex items-center justify-between mb-[9px]">
              <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-[0.08em]">
                Next 28 days
              </span>
              <div className="flex items-center gap-1">
                <div className="w-[5px] h-[5px] rounded-full bg-gray-300" />
                <span className="text-[10.5px] text-gray-400 font-medium">Unavailable days are greyed out</span>
              </div>
            </div>
            <div className="no-scroll flex gap-[5px] overflow-x-auto px-4 pb-1" role="list" aria-label="Date strip">
              {dateStrip.map((day, i) => {
                const isActive = i === activeDateIdx;
                // For real dates, mark unavailable based on API data (no slots exist)
                // For now all days are selectable — backend enforces the schedule
                return (
                  <button
                    key={day.dateStr}
                    role="listitem"
                    onClick={() => { setActiveDateIdx(i); setSelectedSlot(null); }}
                    data-testid={`date-chip-${i}`}
                    className="flex-shrink-0 flex flex-col items-center gap-[3px] px-[10px] py-2 rounded-[13px] border-none cursor-pointer transition-all duration-[180ms] select-none font-sans"
                    style={{
                      minWidth: 44,
                      background: isActive ? accent : 'white',
                      color: isActive ? 'white' : '#374151',
                      boxShadow: isActive
                        ? `0 4px 14px ${accent}45`
                        : '0 1px 3px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)',
                    }}
                  >
                    <span className="text-[10.5px] font-semibold tracking-[0.03em]">{day.dayLabel}</span>
                    <span className={`text-[15px] leading-none ${isActive ? 'font-extrabold' : 'font-semibold'}`}>
                      {day.dayNum}
                    </span>
                    <div
                      className="w-1 h-1 rounded-full mt-[1px]"
                      style={{ background: isActive ? 'rgba(255,255,255,0.7)' : accent }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex gap-[14px] px-5 py-2 flex-shrink-0 items-center border-b border-gray-100">
            {[
              { bg: accent, label: 'Selected', outline: false },
              { bg: 'white', label: 'Available', outline: true },
              { bg: '#e5e7eb', label: 'Taken', outline: false },
            ].map(({ bg, label, outline }) => (
              <div key={label} className="flex items-center gap-[5px]">
                <div
                  className="w-[9px] h-[9px] rounded-full flex-shrink-0"
                  style={{
                    background: bg,
                    border: outline ? '1.5px solid #d1d5db' : 'none',
                  }}
                />
                <span className="text-[11.5px] text-gray-400 font-medium">{label}</span>
              </div>
            ))}
          </div>

          {/* Slot grid */}
          <div className="no-scroll flex-1 overflow-y-auto px-4 pt-3 pb-2">
            {/* Morning */}
            <div className="mb-[14px]">
              <div className="flex items-center gap-2 mb-[9px]">
                <span className="text-[11px] font-bold text-amber-500 uppercase tracking-[0.04em]">
                  ☀ Morning Session
                </span>
                <span className="text-[11px] font-medium text-gray-400">10:00 AM – 12:00 PM</span>
              </div>
              <div className="grid grid-cols-2 gap-[7px]">
                {morningSlots.map((iso) => {
                  const status = slotStatusMap[iso];
                  const isSelected = selectedSlot === iso;
                  const isCutoff = isPastCutoff(iso);
                  const disabled = isDisabled(iso);
                  return (
                    <button
                      key={iso}
                      disabled={disabled}
                      onClick={() => handleSlotClick(iso)}
                      data-testid={`slot-${iso}`}
                      className={`slot-btn ${slotClass(status, isSelected, isCutoff)}`}
                      style={isSelected ? { boxShadow: `0 4px 16px ${accent}50` } : undefined}
                    >
                      {slotLabel(iso)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Evening */}
            <div>
              <div className="flex items-center gap-2 mb-[9px]">
                <span className="text-[11px] font-bold text-indigo-600 uppercase tracking-[0.04em]">
                  🌙 Evening Session
                </span>
                <span className="text-[11px] font-medium text-gray-400">4:00 PM – 7:00 PM</span>
              </div>
              <div className="grid grid-cols-2 gap-[7px]">
                {eveningSlots.map((iso) => {
                  const status = slotStatusMap[iso];
                  const isSelected = selectedSlot === iso;
                  const isCutoff = isPastCutoff(iso);
                  const disabled = isDisabled(iso);
                  return (
                    <button
                      key={iso}
                      disabled={disabled}
                      onClick={() => handleSlotClick(iso)}
                      data-testid={`slot-${iso}`}
                      className={`slot-btn ${slotClass(status, isSelected, isCutoff)}`}
                      style={isSelected ? { boxShadow: `0 4px 16px ${accent}50` } : undefined}
                    >
                      {slotLabel(iso)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Sticky confirm bar */}
          {selectedSlot && (
            <div className="px-5 pt-[6px] pb-[15px] flex-shrink-0 border-t border-gray-100">
              <button
                onClick={handleConfirm}
                className="w-full py-[14px] px-4 rounded-[14px] border-none text-white font-semibold text-[15px] cursor-pointer transition-all duration-200"
                style={{
                  background: accent,
                  boxShadow: `0 6px 22px ${accent}42`,
                  letterSpacing: '-0.01em',
                }}
                data-testid="confirm-bar"
              >
                {confirmLabel()}
              </button>
            </div>
          )}

          {/* Home indicator */}
          <div className="h-[34px] flex items-center justify-center flex-shrink-0">
            <div className="w-[134px] h-[5px] bg-black rounded-full opacity-[0.15]" />
          </div>
        </div>
      ) : (
        /* Success screen */
        <>
          <SuccessScreen appointment={bookedAppointment} onReset={handleReset} />
          <div className="h-[34px] flex items-center justify-center flex-shrink-0">
            <div className="w-[134px] h-[5px] bg-black rounded-full opacity-[0.15]" />
          </div>
        </>
      )}

      {/* Sheets — always rendered (outside scroll, inside phone-screen) */}
      {screen === 'scheduler' && (
        <>
          <BookingSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            onSubmit={handleBookingSubmit}
            slotISO={selectedSlot ?? ''}
            accent={accent}
          />

          <OTPSheet
            open={otpOpen}
            onClose={() => setOtpOpen(false)}
            onVerified={handleOTPVerified}
            phone={pendingBooking?.phone ?? ''}
            purpose="booking"
            accent={accent}
          />

          <DuplicateAlert
            open={dupOpen}
            onClose={() => setDupOpen(false)}
            onRebook={handleRebook}
            existingSlot={existingSlot}
            accent={accent}
          />

          <LookupSheet
            open={lookupOpen}
            onClose={() => setLookupOpen(false)}
            accent={accent}
          />
        </>
      )}
    </div>
  );
}
