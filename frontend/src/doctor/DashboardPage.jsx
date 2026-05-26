/**
 * DashboardPage — The doctor's primary view after OTP authentication.
 *
 * Renders today's appointment timeline with live status computation, and hosts
 * the NotesSheet, StatsSheet, SettingsPanel, and SetupPage sub-views.
 *
 * Props:
 *   doctorToken — string; bearer token obtained from OTPGate after verification.
 *                 Lives in DoctorApp's React state — never persisted to storage,
 *                 cleared on page reload by design (forces re-auth each session).
 *
 * Core responsibilities:
 *   1. Fetch GET /doctor/schedule on mount and every 30 seconds.
 *      The response includes `server_time` (ISO +05:30) and the day's `appointments`
 *      array. Using server_time (not Date.now()) prevents display drift when the
 *      browser clock differs from the IST backend clock.
 *
 *   2. Compute slot statuses (done / active / next / upcoming) from server_time
 *      via `assignStatuses`. Status is re-derived on every render, so the 30s
 *      poll keeps the timeline accurate without a separate timer.
 *
 *   3. Track the active appointment for the NotesSheet — if no slot is currently
 *      active, NotesSheet opens without a patient header (edge case: doctor taps
 *      "Live Consultation Notes" button between slots).
 *
 * Sub-views:
 *   page === 'setup'     → SetupPage (WhatsApp pairing + Google OAuth)
 *   page === 'dashboard' → main timeline view (default)
 *
 * Slot status algorithm (getSlotStatus + assignStatuses):
 *   - A slot is 'done'   if now ≥ slotStart + 15 min
 *   - A slot is 'active' if now ≥ slotStart AND now < slotEnd
 *   - The first non-done/non-active slot is 'next'
 *   - All remaining slots are 'upcoming'
 *   Only one slot can be 'active' at a time (15-min non-overlapping slots).
 *
 * Progress calculation (calcProgress):
 *   Returns { percent: 0–100, minsRemaining: integer } for the active slot only.
 *   Uses server_time for consistency with status computation. The ProgressBar
 *   uses a 1s CSS transition, so updates every 30s look smooth enough in practice.
 *
 * Toast system:
 *   `showToast(message, variant)` sets a `toast` state object; the Toast component
 *   reads it and auto-dismisses after 3s. Dismissal is also wired to the onDismiss
 *   prop for manual swipe-away (future feature).
 */
import { useState, useEffect, useRef } from 'react';
import StatusBar from '../components/StatusBar.jsx';
import Toast from '../components/Toast.jsx';
import AppointmentSlot from './AppointmentSlot.jsx';
import NotesSheet from './NotesSheet.jsx';
import BrowsePanel from './BrowsePanel.jsx';
import StatsSheet from './StatsSheet.jsx';
import SettingsPanel from './SettingsPanel/index.jsx';
import SetupPage from './SetupPage.jsx';
import { getDoctorSchedule } from '../api/doctor.js';

const DOCTOR_NAME = 'Dr. Lakshimi Sagar';

/**
 * Computes the binary slot state (done / active / null) for a single appointment.
 *
 * Returns null for future slots; the caller (assignStatuses) is responsible for
 * assigning 'next' vs 'upcoming' among the future set, because that distinction
 * requires knowing about all other slots (only one slot can be 'next').
 *
 * Falls back to new Date() if serverTime is absent (e.g. first render before
 * the initial fetch completes). This is intentional — a brief period of local-
 * clock-based status on startup is preferable to showing every slot as 'upcoming'.
 */
function getSlotStatus(appt, serverTime) {
  const now = serverTime ? new Date(serverTime) : new Date();
  const slot = new Date(appt.slot_time);
  const slotEnd = new Date(slot.getTime() + 15 * 60 * 1000);

  if (now >= slotEnd) return 'done';
  if (now >= slot) return 'active';
  return null; // caller distinguishes 'next' vs 'upcoming'
}

/**
 * Assigns a display status to every appointment in the day's list.
 *
 * Invariant: appointments array is pre-sorted ascending by slot_time by the backend.
 * The `foundNext` flag implements a one-shot assignment — the first future slot
 * claims 'next', all later slots get 'upcoming'. This relies on the sort order;
 * if the array were unsorted, the first future slot by index (not time) would
 * get 'next', which would be wrong.
 */
function assignStatuses(appointments, serverTime) {
  let foundNext = false;
  return appointments.map((appt, idx) => {
    const base = getSlotStatus(appt, serverTime);
    if (base === 'done' || base === 'active') return { ...appt, _status: base };
    if (!foundNext) {
      foundNext = true;
      return { ...appt, _status: 'next' };
    }
    return { ...appt, _status: 'upcoming' };
  });
}

/**
 * Computes the session progress for the active slot.
 *
 * `percent` is clamped [0, 100] to guard against clock skew — if serverTime
 * is slightly ahead of or behind the slot boundaries, raw arithmetic could
 * produce values outside that range. Math.ceil on minsRemaining rounds up
 * to the nearest minute, which reads more naturally ("1 min" rather than
 * "0.3 min" as the slot nears its end).
 */
function calcProgress(appt, serverTime) {
  if (!appt.slot_time) return { percent: 0, minsRemaining: null };
  const now = serverTime ? new Date(serverTime).getTime() : Date.now();
  const start = new Date(appt.slot_time).getTime();
  const end = start + 15 * 60 * 1000;
  const elapsed = now - start;
  const total = end - start;
  const percent = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const minsRemaining = Math.max(0, Math.ceil((end - now) / 60000));
  return { percent, minsRemaining };
}

export default function DashboardPage({ doctorToken }) {
  const [appointments, setAppointments] = useState([]);
  const [serverTime, setServerTime] = useState(null);
  const [page, setPage] = useState('dashboard'); // 'dashboard' | 'setup'
  const [notesOpen, setNotesOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [gearOpen, setGearOpen] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', variant: 'success' });

  // Stable ref for the polling interval so we can clear it on unmount without
  // capturing a stale interval ID in the cleanup closure.
  const intervalRef = useRef(null);

  async function loadSchedule() {
    try {
      const data = await getDoctorSchedule(doctorToken);
      setAppointments(data.appointments ?? []);
      // `server_time` from the backend is an ISO +05:30 string used as the
      // authoritative clock for status and progress computations. This ensures
      // the display is consistent with IST regardless of the browser's timezone.
      setServerTime(data.server_time ?? null);
    } catch {
      // Silent failure: keep the existing data on screen so the doctor isn't
      // left staring at an empty timeline on a transient network hiccup.
    }
  }

  useEffect(() => {
    loadSchedule();
    // Poll every 30s — frequent enough to catch slot transitions (NEXT UP → ACTIVE)
    // within half a minute, but not so frequent as to hammer the backend.
    intervalRef.current = setInterval(loadSchedule, 30_000);
    return () => clearInterval(intervalRef.current);
  }, [doctorToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const enriched = assignStatuses(appointments, serverTime);
  const activeAppt = enriched.find((a) => a._status === 'active');

  // Today display
  const today = new Date();
  const todayLabel = today.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  function showToast(message, variant = 'success') {
    setToast({ visible: true, message, variant });
  }

  if (page === 'setup') {
    return (
      <div className="flex flex-col h-full overflow-hidden relative bg-[#f7f6f4]">
        <StatusBar side="doctor" />
        {/* Header */}
        <div className="bg-white px-[18px] pt-[10px] pb-[13px] flex items-center justify-between flex-shrink-0 border-b border-[#f0ede9]">
          <button
            onClick={() => setPage('dashboard')}
            className="text-[13px] font-semibold text-gray-500 flex items-center gap-1"
          >
            ← Dashboard
          </button>
          <span className="text-[14px] font-extrabold text-stone-950">Setup</span>
          <div className="w-16" />
        </div>
        <SetupPage doctorToken={doctorToken} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden relative bg-[#f7f6f4]">
      <StatusBar side="doctor" />

      <Toast
        message={toast.message}
        variant={toast.variant}
        visible={toast.visible}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />

      {/* App header */}
      <div className="bg-white px-[18px] pt-[10px] pb-[13px] flex items-center justify-between flex-shrink-0 border-b border-[#f0ede9]">
        <div>
          <h1 className="text-[21px] font-extrabold text-stone-950 tracking-tight leading-tight">
            Hello, {DOCTOR_NAME}
          </h1>
          <div className="flex items-center gap-[7px] mt-[5px]">
            {/* Online badge */}
            <span className="bg-[#dcfce7] text-[#15803d] text-[9px] font-extrabold tracking-[0.07em] rounded-[6px] px-2 py-[2px] uppercase inline-flex items-center gap-1">
              <span className="w-[5px] h-[5px] rounded-full bg-[#16a34a] inline-block" />
              Online
            </span>
            <span className="text-[11px] text-[rgb(127,123,120)] font-medium">{todayLabel}</span>
          </div>
        </div>
        <button
          onClick={() => setGearOpen(true)}
          className="gear-btn"
          title="Availability Settings"
          data-testid="gear-button"
        >
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
            <rect x="0" y="0" width="16" height="2" rx="1" fill="#374151" />
            <rect x="0" y="5" width="16" height="2" rx="1" fill="#374151" />
            <rect x="0" y="10" width="16" height="2" rx="1" fill="#374151" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="no-scroll flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">

        {/* Timeline card */}
        <div className="card">
          <div className="flex items-center justify-between mb-[10px]">
            <p className="section-label">Today's Appointments</p>
            <span className="text-[10px] font-semibold text-[#a8a29e]">
              {enriched.length} slots
            </span>
          </div>

          {/* Timeline slots */}
          <div className="flex flex-col gap-[7px]">
            {enriched.length === 0 ? (
              <p className="text-[12px] text-gray-400 text-center py-4">No appointments today</p>
            ) : (
              enriched.map((appt, idx) => {
                const { percent, minsRemaining } = appt._status === 'active'
                  ? calcProgress(appt, serverTime)
                  : { percent: 0, minsRemaining: null };

                return (
                  <AppointmentSlot
                    key={appt.id ?? idx}
                    appointment={{
                      ...appt,
                      progressPercent: percent,
                      minsRemaining,
                    }}
                    status={appt._status}
                    isLast={idx === enriched.length - 1}
                    onNotes={appt._status === 'active' ? () => setNotesOpen(true) : undefined}
                  />
                );
              })
            )}
          </div>

          {/* Browse panel accordion */}
          <BrowsePanel doctorToken={doctorToken} />
        </div>

        {/* Live Notes trigger */}
        <button
          onClick={() => setNotesOpen(true)}
          className="w-full bg-white border border-[#ebe8e4] rounded-[18px] p-[14px_16px] flex items-center justify-between gap-[10px] cursor-pointer transition-colors duration-150 shadow-sm"
          onMouseDown={(e) => (e.currentTarget.style.background = '#f9f8f7')}
          onMouseUp={(e) => (e.currentTarget.style.background = 'white')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
        >
          <div className="flex items-center gap-[10px]">
            <div className="w-9 h-9 rounded-[11px] bg-[#f0fdf4] border border-[#bbf7d0] flex items-center justify-center flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <rect x="2" y="2" width="14" height="14" rx="3" stroke="#22c55e" strokeWidth="1.5" />
                <path d="M5 6h8M5 9h8M5 12h5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-left">
              <p className="text-[13px] font-bold text-stone-950 leading-tight">Live Consultation Notes</p>
              <p className="text-[11px] text-[#a8a29e] mt-[2px]">Tap to add observations &amp; send to patient</p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Setup link */}
        <button
          onClick={() => setPage('setup')}
          className="w-full bg-white border border-[#ebe8e4] rounded-[18px] p-[14px_16px] flex items-center justify-between gap-[10px] cursor-pointer text-left shadow-sm"
        >
          <div className="flex items-center gap-[10px]">
            <div className="w-9 h-9 rounded-[11px] bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[16px]">📱</span>
            </div>
            <div>
              <p className="text-[13px] font-bold text-stone-950 leading-tight">WhatsApp &amp; Google Setup</p>
              <p className="text-[11px] text-[#a8a29e] mt-[2px]">Manage pairing code and contacts integration</p>
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 6l4 4 4-4" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

      </div>

      {/* Home indicator */}
      <div className="h-[34px] flex items-center justify-center flex-shrink-0">
        <div className="w-[134px] h-[5px] bg-black rounded-full opacity-[0.15]" />
      </div>

      {/* Sheets */}
      <NotesSheet
        open={notesOpen}
        onClose={() => setNotesOpen(false)}
        activePatient={activeAppt ? { name: activeAppt.patient_name, slotTime: activeAppt.slot_time } : null}
        appointmentId={activeAppt?.id}
        doctorToken={doctorToken}
      />

      <StatsSheet
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        doctorToken={doctorToken}
      />

      <SettingsPanel
        open={gearOpen}
        onClose={() => setGearOpen(false)}
        doctorToken={doctorToken}
      />
    </div>
  );
}
