/**
 * CancellationEngine — Precision cancellation accordion within the SettingsPanel.
 *
 * Allows the doctor to block out time by cancelling confirmed appointments.
 * This is typically used for sick leave, urgent personal appointments, or
 * public holidays not already reflected in the weekly schedule.
 *
 * Props:
 *   doctorToken — string; bearer token for API calls
 *   onSuccess   — called when a cancellation completes; triggers the gear panel's
 *                 full-panel "Changes Saved!" success splash
 *
 * Two cancellation scopes are offered via a segmented control:
 *
 *   Scope A — "Cancel Entire Selected Day(s)":
 *     Calls POST /doctor/cancel-day with the selected date.
 *     Backend cancels ALL confirmed appointments for that date, sends each
 *     patient a WhatsApp cancellation message, and marks the day unavailable.
 *
 *   Scope B — "Select Individual Slots to Cancel":
 *     Displays a 3-column checkbox grid of every slot for the selected date
 *     (morning: 10:00–11:45, evening: 16:00–18:45, 15-min spacing).
 *     Calls POST /doctor/cancel-slots with an array of ISO time strings.
 *
 * Safety UX:
 *   The confirm card (red border, ⚠️ icon, descriptive summary) only appears
 *   AFTER the doctor has both: (a) selected a date AND (b) either chosen Scope A
 *   or selected at least one slot in Scope B. This prevents accidental submissions
 *   from an empty state.
 *
 * ALL_SLOTS helper:
 *   Lazily computes the slot grid for a given date using the same generators
 *   (generateMorningSlots, generateEveningSlots) as BookingPage — ensuring the
 *   doctor sees exactly the slots that patients can book.
 *
 * After a successful cancellation, state is reset (date cleared, selection
 * cleared) so the engine is ready for another operation without a sheet close/open.
 */
import { useState } from 'react';
import { cancelDay, cancelSlots } from '../../api/doctor.js';
import { generateMorningSlots, generateEveningSlots, formatSlotTime } from '../../utils/date.js';

// Generates the complete ordered list of bookable slots for a given date.
// Returns an empty array when no date is selected — the slot grid is then hidden.
// Using spread to concat arrays (rather than Array.concat) keeps the pattern
// consistent with how BookingPage builds its slot lists.
const ALL_SLOTS = (dateStr) => dateStr
  ? [...generateMorningSlots(dateStr), ...generateEveningSlots(dateStr)]
  : [];

export default function CancellationEngine({ doctorToken, onSuccess }) {
  const [expanded, setExpanded] = useState(false);
  const [scope, setScope] = useState('A'); // 'A' = whole day, 'B' = individual slots
  const [date, setDate] = useState('');
  const [selectedSlots, setSelectedSlots] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const slots = ALL_SLOTS(date);
  const showConfirm = !!date && (scope === 'A' || selectedSlots.size > 0);

  // Immutable Set toggle: we cannot mutate `prev` directly because React's
  // state diffing on Sets uses reference equality. Spreading into a new Set
  // guarantees a new reference and triggers a re-render.
  function toggleSlot(iso) {
    setSelectedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }

  async function handleConfirm() {
    if (!date || loading) return;
    setLoading(true);
    setError('');
    try {
      if (scope === 'A') {
        await cancelDay(date, doctorToken);
      } else {
        await cancelSlots(Array.from(selectedSlots), doctorToken);
      }
      onSuccess?.();
      // Reset
      setDate('');
      setSelectedSlots(new Set());
    } catch (err) {
      setError(err.error ?? 'Cancellation failed.');
    } finally {
      setLoading(false);
    }
  }

  const confirmSummary = scope === 'A'
    ? `All appointments on ${date || 'the selected date'} will be cancelled and patients notified via WhatsApp.`
    : `${selectedSlots.size} slot${selectedSlots.size !== 1 ? 's' : ''} on ${date || 'the selected date'} will be cancelled.`;

  return (
    <div>
      {/* Accordion header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full bg-transparent border-none cursor-pointer p-0 mb-[10px] flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <div className="w-[3px] h-4 rounded-full bg-amber-400 flex-shrink-0" />
          <p className="text-[9.5px] font-extrabold text-stone-950 uppercase tracking-[0.08em]">
            Precision Cancellation Engine
          </p>
        </div>
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none"
          className="flex-shrink-0 text-gray-400 transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div className="bg-white rounded-2xl border border-[#e8e5e1] shadow-sm overflow-hidden">
          <div className="p-[12px_14px_10px] border-b border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.08em]">
              Cancel Appointments &amp; Block Time
            </p>
          </div>

          <div className="p-[14px]">
            {/* Scope selector */}
            <p className="text-[11px] font-bold text-[#44403c] mb-2">Cancellation Scope</p>
            <div className="seg-bar mb-[14px]">
              <button
                onClick={() => setScope('A')}
                className={`seg-btn ${scope === 'A' ? 'active' : ''} text-[10.5px] leading-snug`}
              >
                Cancel Entire<br />Selected Day(s)
              </button>
              <button
                onClick={() => { setScope('B'); setSelectedSlots(new Set()); }}
                className={`seg-btn ${scope === 'B' ? 'active' : ''} text-[10.5px] leading-snug`}
              >
                Select Individual<br />Slots to Cancel
              </button>
            </div>

            {/* Date picker */}
            <p className="text-[11px] font-bold text-[#44403c] mb-[7px]">Target Date</p>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setSelectedSlots(new Set()); }}
              className="date-input mb-[14px]"
            />

            {/* Slot grid (scope B) */}
            {scope === 'B' && date && (
              <div className="mb-[14px]">
                <p className="text-[11px] font-bold text-[#44403c] mb-2">Select Slots to Disable</p>
                <div className="grid grid-cols-3 gap-[5px]">
                  {slots.map((iso) => (
                    <label
                      key={iso}
                      className="flex items-center gap-[5px] p-[7px_8px] bg-[#f9f8f7] rounded-[9px] border-[1.5px] border-[#e5e7eb] cursor-pointer text-[10.5px] font-bold text-[#44403c]"
                      style={{
                        borderColor: selectedSlots.has(iso) ? '#22c55e' : '#e5e7eb',
                        background: selectedSlots.has(iso) ? '#f0fdf4' : '#f9f8f7',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSlots.has(iso)}
                        onChange={() => toggleSlot(iso)}
                        className="w-[13px] h-[13px] flex-shrink-0"
                        style={{ accentColor: '#22c55e' }}
                      />
                      {formatSlotTime(iso)}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Confirm card */}
            {showConfirm && (
              <div className="bg-[#fff5f5] border-[1.5px] border-[#fca5a5] rounded-[14px] p-[14px]">
                <div className="flex items-start gap-[10px] mb-3">
                  <span className="text-[18px] flex-shrink-0 leading-tight">⚠️</span>
                  <div>
                    <p className="text-[12px] font-extrabold text-[#991b1b] mb-[3px]">Review Before Confirming</p>
                    <p className="text-[10.5px] text-[#b91c1c] leading-relaxed">{confirmSummary}</p>
                  </div>
                </div>
                {error && <p className="text-[11px] text-red-600 mb-2">{error}</p>}
                <button
                  onClick={handleConfirm}
                  disabled={loading}
                  className="w-full py-[13px] bg-[#dc2626] text-white border-none rounded-[11px] font-extrabold text-[13px] cursor-pointer disabled:opacity-60"
                  style={{ boxShadow: '0 4px 14px rgba(220,38,38,.28)', letterSpacing: '-0.01em' }}
                >
                  {loading ? 'Cancelling…' : '📅 Cancel Appointments'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
