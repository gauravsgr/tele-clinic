/**
 * StatsSheet — Practice analytics slide-up bottom sheet.
 *
 * Surfaces key appointment metrics fetched from GET /doctor/stats.
 * Two segmented tabs split the view into historical and forward-looking figures:
 *
 *   Past tab  — "How has my clinic been performing?"
 *     • Appointments completed this month and this week
 *     • Average session duration (computed by backend from booking timestamps)
 *     • Cancellation count (all-time or current month — backend decision)
 *     • Notes sent count (proxy for engagement / follow-up quality)
 *
 *   Future tab — "What's my upcoming load?"
 *     • Total forward bookings (all confirmed future appointments)
 *     • Bookings in the current calendar week
 *     • Next available slot (first slot with no confirmed booking)
 *     • First fully booked day (useful for planning leave)
 *     • Average daily patient load across the 28-day booking window
 *
 * Props:
 *   open        — boolean; controls the slide-up animation
 *   onClose     — dismiss callback (× button or overlay tap)
 *   doctorToken — string; forwarded to GET /doctor/stats as Authorization header
 *
 * Data fetching:
 *   Stats are fetched on every open event (not cached) to ensure freshness.
 *   The `[open, doctorToken]` dependency ensures a re-fetch if the token
 *   changes mid-session (edge case: doctor re-authenticates without page reload).
 *
 * Row data is declared as a `const` array of { label, value } objects.
 * This declarative pattern keeps the render loop trivial and makes it
 * straightforward to add/remove/reorder metrics without touching JSX structure.
 *
 * All values fall back to '—' when absent so the UI never shows "undefined".
 */
import { useState, useEffect } from 'react';
import { getDoctorStats } from '../api/doctor.js';

const TABS = ['Past', 'Future'];

export default function StatsSheet({ open, onClose, doctorToken }) {
  const [tab, setTab] = useState('Past');
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !doctorToken) return;
    setLoading(true);
    getDoctorStats(doctorToken)
      .then((data) => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, [open, doctorToken]);

  const past = stats?.past ?? {};
  const future = stats?.future ?? {};

  const pastRows = [
    { label: 'Completed this month', value: past.completed_month ?? '—' },
    { label: 'Completed this week', value: past.completed_week ?? '—' },
    { label: 'Avg session duration', value: past.avg_duration ?? '—' },
    { label: 'Cancellations', value: past.cancellations ?? '—' },
    { label: 'Notes sent', value: past.notes_sent ?? '—' },
  ];

  const futureRows = [
    { label: 'Forward bookings', value: future.forward_bookings ?? '—' },
    { label: 'Booked this week', value: future.this_week ?? '—' },
    { label: 'Next available slot', value: future.next_available ?? '—' },
    { label: 'First fully booked day', value: future.first_full_day ?? '—' },
    { label: 'Avg daily load', value: future.avg_daily_load ?? '—' },
  ];

  const rows = tab === 'Past' ? pastRows : futureRows;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 z-34 transition-all duration-300 pointer-events-${open ? 'auto' : 'none'}`}
        style={{ background: 'rgba(0,0,0,0)', borderRadius: '42px' }}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[50] bg-white rounded-t-[22px] flex flex-col transition-transform duration-300 ease-out"
        style={{
          maxHeight: '68%',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
        }}
        role="dialog"
        aria-label="Statistics"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-[38px] h-1 bg-gray-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-[18px] pb-[6px] pt-[8px] border-b border-gray-100 flex-shrink-0">
          <h3 className="text-[14px] font-extrabold text-stone-950">Appointment History</h3>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-[20px] text-gray-400 cursor-pointer px-1 leading-none"
          >
            ×
          </button>
        </div>

        {/* Segmented switcher */}
        <div className="px-[18px]">
          <div className="seg-bar">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`seg-btn ${tab === t ? 'active' : ''}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Stat rows */}
        <div className="flex-1 overflow-y-auto px-[18px] py-3">
          {loading ? (
            <p className="text-[12px] text-gray-400 text-center py-4">Loading…</p>
          ) : (
            <div className="flex flex-col gap-[2px]">
              {rows.map(({ label, value }) => (
                <div
                  key={label}
                  className="flex justify-between items-center py-[10px] border-b border-gray-50 last:border-b-0"
                >
                  <span className="text-[12.5px] text-gray-500 font-medium">{label}</span>
                  <span className="text-[13px] font-bold text-stone-950">{value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
