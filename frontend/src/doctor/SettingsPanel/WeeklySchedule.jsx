/**
 * WeeklySchedule — 7-day recurring availability toggle within the SettingsPanel.
 *
 * Controls which days of the week the clinic is open. The backend uses this
 * schedule to determine which dates appear as bookable in the patient's date
 * strip. Changes here do NOT retroactively affect existing bookings; they take
 * effect after the current 28-day booking window closes.
 *
 * Props:
 *   doctorToken — string; bearer token for GET /doctor/weekly-schedule and
 *                 PUT /doctor/weekly-schedule
 *   onSuccess   — called after a successful save; triggers the gear panel's
 *                 "Changes Saved!" success splash
 *
 * Lazy loading:
 *   The schedule is fetched from the backend only when the accordion is first
 *   expanded (`expanded` flips to true). This avoids an unnecessary API call if
 *   the doctor opens the gear panel but never touches the schedule section.
 *   The `[expanded, doctorToken]` dependency ensures a fresh fetch if the doctor
 *   collapses and re-expands (handles the case where another admin changed the
 *   schedule elsewhere).
 *
 * Dirty-state tracking:
 *   `schedule` — current (potentially modified) day toggles
 *   `original` — the last-saved state from the server (set on load + on save)
 *   `hasChanges` — derived boolean: any day in schedule !== original
 *   The Save button only appears when `hasChanges` is true, preventing spurious
 *   API calls from save-happy doctors. Once saved, `original` is updated to match
 *   `schedule`, so `hasChanges` returns to false and the button disappears.
 *
 * 28-day effective notice:
 *   The amber banner is a critical UX feature. Without it, a doctor might toggle
 *   Saturday off, save, and be confused that patients can still book Saturdays
 *   for the next few weeks. The notice prevents support queries.
 *
 * Toggle implementation:
 *   Each day row uses a custom toggle button (toggle-track + toggle-thumb classes
 *   from index.css) with `role="switch"` and `aria-pressed` for accessibility.
 *   The thumb slides via `left: 3px` (off) → `left: 19px` (on), driven by CSS.
 *   See index.css for the exact pixel math.
 */
import { useState, useEffect } from 'react';
import { getWeeklySchedule, saveWeeklySchedule } from '../../api/schedule.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function WeeklySchedule({ doctorToken, onSuccess }) {
  const [expanded, setExpanded] = useState(false);
  const [schedule, setSchedule] = useState({});
  const [original, setOriginal] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load schedule when expanded
  useEffect(() => {
    if (!expanded || !doctorToken) return;
    setLoading(true);
    getWeeklySchedule(doctorToken)
      .then((data) => {
        const s = data.schedule ?? {};
        setSchedule(s);
        setOriginal(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [expanded, doctorToken]);

  // Derived: true if any day differs from the last-saved server state.
  // Using Array.some short-circuits on the first changed day, which is
  // faster than Object.keys comparison and avoids the need for deep equality.
  const hasChanges = DAYS.some((d) => schedule[d] !== original[d]);

  function toggleDay(day) {
    setSchedule((prev) => ({ ...prev, [day]: !prev[day] }));
  }

  async function handleSave() {
    if (!hasChanges || saving) return;
    setSaving(true);
    setError('');
    try {
      await saveWeeklySchedule(schedule, doctorToken);
      // Update `original` to the newly saved state so `hasChanges` resets to
      // false and the Save button disappears — confirming the save visually.
      setOriginal({ ...schedule });
      onSuccess?.();
    } catch (err) {
      setError(err.error ?? 'Failed to save schedule.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Accordion header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full bg-transparent border-none cursor-pointer p-0 mb-[10px] flex items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2">
          <div className="w-[3px] h-4 rounded-full bg-[#22c55e] flex-shrink-0" />
          <p className="text-[9.5px] font-extrabold text-stone-950 uppercase tracking-[0.08em]">
            Weekly Schedule Management
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
        <div>
          {/* 28-day effective notice */}
          <div className="flex items-start gap-[9px] bg-amber-50 border border-amber-200 rounded-xl p-[11px_13px] mb-[10px]">
            <span className="text-[14px] flex-shrink-0 leading-tight">⏳</span>
            <p className="text-[11px] text-amber-800 leading-relaxed font-medium">
              Schedule changes take effect <strong>after the next 4 weeks</strong>. Existing bookings within that window will not be affected.
            </p>
          </div>

          {loading ? (
            <p className="text-[12px] text-gray-400 text-center py-3">Loading…</p>
          ) : (
            <div className="flex flex-col gap-[5px] mb-[12px]">
              {DAYS.map((day) => {
                const on = !!schedule[day];
                return (
                  <div
                    key={day}
                    className="flex items-center justify-between p-[11px_13px] bg-white rounded-[13px] border border-[#f0ede9]"
                  >
                    <span className="text-[13px] font-semibold text-stone-950">{day}</span>
                    {/* Toggle */}
                    <button
                      onClick={() => toggleDay(day)}
                      className="toggle-track"
                      style={{ background: on ? '#22c55e' : '#e5e7eb' }}
                      aria-pressed={on}
                      aria-label={`Toggle ${day}`}
                      role="switch"
                    >
                      <div
                        className="toggle-thumb"
                        style={{ left: on ? '19px' : '3px' }}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}

          {/* Save button — only when changes detected */}
          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-push disabled:opacity-60"
            >
              {saving ? 'Saving…' : '💾 Save Schedule'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
