/**
 * BrowsePanel — Collapsible accordion for browsing appointments by arbitrary date.
 *
 * Sits at the bottom of the DashboardPage timeline card. The doctor uses this
 * to look up past days (e.g. "who came in last Thursday?") or preview upcoming
 * days beyond today's live timeline.
 *
 * Props:
 *   doctorToken — string; bearer token forwarded to GET /doctor/appointments
 *
 * Two date-selection mechanisms are intentionally provided:
 *   1. Date chip row — quick access to the nearest 10 days (horizontal scroll).
 *      Each chip shows day abbreviation + numeric date + an active indicator dot.
 *      Active chip: dark background (#1c1917) with white text and a green dot.
 *   2. Custom date picker — a native `<input type="date">` for any date outside
 *      the chip row. Selecting a date here clears the chip selection and vice
 *      versa, so only one source of truth exists at a time.
 *
 * Data flow:
 *   Date selection (chip or picker) → setSelectedDate → useEffect → loadAppointments
 *   → setAppointments → render appointment list
 *
 * Why eslint-disable react-hooks/exhaustive-deps on the useEffect?
 *   `loadAppointments` is defined inside the component and depends on `doctorToken`.
 *   Including it in deps would require memoizing it with useCallback, adding
 *   complexity for marginal benefit. The simple rule here: effect fires when
 *   selectedDate changes, and it reads the latest doctorToken from closure.
 *
 * Slot status colour mapping (slotStatusStyle):
 *   done     → grey pill (#f3f4f6 bg / #9ca3af text)
 *   active   → green pill with white text
 *   default  → sky-blue pill (upcoming style)
 *
 * Chip row shows 10 days (not 28) to keep the panel compact. The date picker
 * handles the remaining 18 days of the booking window.
 */
import { useState, useEffect } from 'react';
import { getDoctorAppointments } from '../api/doctor.js';
import { generateDateStrip, formatSlotTime, toISTDateStr } from '../utils/date.js';
import { formatDisplayDate } from '../utils/date.js';

function slotStatusStyle(status) {
  if (status === 'done') return { color: '#9ca3af', bg: '#f3f4f6', border: 'none' };
  if (status === 'active') return { color: 'white', bg: '#22c55e', border: 'none' };
  return { color: '#0369a1', bg: '#f0f9ff', border: '1px solid #bae6fd' };
}

export default function BrowsePanel({ doctorToken }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [customDate, setCustomDate] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);

  // Limit the chip row to 10 days — beyond that, the horizontal scroll becomes
  // cumbersome on a phone-width (393px) container. The date picker covers the rest.
  const dateStrip = generateDateStrip().slice(0, 10);

  async function loadAppointments(dateStr) {
    if (!doctorToken || !dateStr) return;
    setLoading(true);
    try {
      const data = await getDoctorAppointments(dateStr, doctorToken);
      setAppointments(data.appointments ?? []);
    } catch {
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedDate) loadAppointments(selectedDate);
  }, [selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chip click: set the chip as the active date and clear any custom date value
  // so the two pickers stay mutually exclusive.
  function handleChipClick(dateStr) {
    setSelectedDate(dateStr);
    setCustomDate('');
  }

  // Custom date picker: controlled by its own state to show the native input's
  // value correctly. Only calls setSelectedDate when a value is present; the
  // empty string ('') from clearing the picker should not trigger a fetch.
  function handleCustomDate(e) {
    const val = e.target.value;
    setCustomDate(val);
    if (val) setSelectedDate(val);
  }

  return (
    <div className="mt-[11px] border-t border-[#f0ede9] pt-[10px]">
      {/* Accordion header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full bg-transparent border-none cursor-pointer p-0 flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-[6px]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
            <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="#44403c" strokeWidth="1.5" />
            <path d="M5 1v4M11 1v4M1 7h14" stroke="#44403c" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="4" y="10" width="2" height="2" rx=".5" fill="#44403c" />
            <rect x="7" y="10" width="2" height="2" rx=".5" fill="#44403c" />
          </svg>
          <p className="text-[11px] font-bold text-[#44403c]">Browse Appointments by Date</p>
        </div>
        <svg
          width="15" height="15" viewBox="0 0 16 16" fill="none"
          className="flex-shrink-0 text-gray-400 transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-[10px]">
          {/* Date chip row */}
          <div className="no-scroll overflow-x-auto mb-[10px]">
            <div className="flex gap-[6px] pb-1" style={{ width: 'max-content' }}>
              {dateStrip.map((day) => {
                const isActive = day.dateStr === selectedDate;
                return (
                  <button
                    key={day.dateStr}
                    onClick={() => handleChipClick(day.dateStr)}
                    className="date-chip"
                    style={{
                      background: isActive ? '#1c1917' : '#f3f4f6',
                    }}
                  >
                    <span
                      className="text-[9px] font-semibold uppercase tracking-[0.05em]"
                      style={{ color: isActive ? 'rgba(255,255,255,0.6)' : '#9ca3af' }}
                    >
                      {day.dayLabel}
                    </span>
                    <span
                      className="text-[17px] font-extrabold"
                      style={{ color: isActive ? 'white' : '#1c1917' }}
                    >
                      {day.dayNum}
                    </span>
                    <span
                      className="w-1 h-1 rounded-full block"
                      style={{ background: isActive ? '#22c55e' : 'transparent' }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom date picker */}
          <div className="flex items-center gap-2 mb-[10px] p-[10px_12px] bg-[#f9f8f7] rounded-xl border border-[#f0ede9]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
              <rect x="1" y="3" width="14" height="12" rx="2.5" stroke="#9ca3af" strokeWidth="1.4" />
              <path d="M5 1v4M11 1v4M1 7h14" stroke="#9ca3af" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="text-[11.5px] font-semibold text-gray-500 flex-1">Pick any date</span>
            <input
              type="date"
              value={customDate}
              onChange={handleCustomDate}
              className="date-input"
              style={{ width: 'auto', padding: '5px 9px', fontSize: '11.5px', borderRadius: '9px' }}
            />
          </div>

          {/* Appointment list */}
          {loading ? (
            <p className="text-[12px] text-gray-400 text-center py-3">Loading…</p>
          ) : !selectedDate ? (
            <p className="text-[12px] text-gray-400 text-center py-3">Select a date to view appointments</p>
          ) : appointments.length === 0 ? (
            <p className="text-[12px] text-gray-400 text-center py-3">No appointments for this date</p>
          ) : (
            <div className="flex flex-col gap-[5px]">
              {appointments.map((appt) => {
                const statusStyle = slotStatusStyle(appt.status);
                return (
                  <div
                    key={appt.id}
                    className="flex items-center justify-between gap-2 p-[10px_12px] bg-white rounded-[13px] border border-[#f0ede9]"
                  >
                    <div>
                      <p className="text-[12px] font-bold text-stone-950">{appt.patient_name}</p>
                      <p className="text-[11px] text-gray-400 mt-[2px]">
                        {appt.slot_time ? formatSlotTime(appt.slot_time) : '—'}
                        {appt.reason ? ` · ${appt.reason}` : ''}
                      </p>
                    </div>
                    <span
                      className="status-pill flex-shrink-0"
                      style={{
                        background: statusStyle.bg,
                        color: statusStyle.color,
                        border: statusStyle.border,
                      }}
                    >
                      {appt.status?.toUpperCase() ?? 'UPCOMING'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
