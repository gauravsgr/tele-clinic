/**
 * AppointmentCard — A single appointment row in the LookupSheet results view.
 *
 * Renders two visually distinct variants based on the `type` prop:
 *
 *   'upcoming':
 *     - Green status dot (live indicator)
 *     - "UPCOMING SESSION" label
 *     - "Confirmed" pill (green badge)
 *     - Bold date/time display
 *     - "Cancel Appointment" destructive button (right-aligned)
 *     - Bottom border separating it from the last_visit card below
 *
 *   'last_visit':
 *     - Gray status dot (completed)
 *     - "LAST COMPLETED VISIT" label
 *     - No action button (past appointments are read-only)
 *     - Slightly lighter text weight than upcoming
 *
 * Props:
 *   type      — 'upcoming' | 'last_visit'; controls all visual differentiation
 *   dateTime  — pre-formatted human-readable string from the parent (LookupSheet
 *               formats it via formatAppt before passing down). Example:
 *               "Saturday, May 23 at 10:15 AM"
 *   onCancel  — optional callback; if absent, no cancel button is rendered.
 *               This lets the parent decide whether cancellation is possible
 *               (e.g. past the 11:59 PM deadline the backend would reject it anyway).
 *
 * Touch target sizing:
 *   The cancel button has `min-w-[44px] min-h-[44px]` to meet Apple HIG's
 *   44×44pt minimum tap target size. The `flex items-center` ensures the
 *   text baseline is centred in that tap area even when the text is shorter.
 *
 * This component is intentionally presentation-only — no state, no API calls.
 * All interaction logic lives in LookupSheet.
 */
export default function AppointmentCard({ type, dateTime, onCancel }) {
  const isUpcoming = type === 'upcoming';

  return (
    <div className={`py-[14px] px-[16px] ${isUpcoming ? 'border-b border-gray-100' : ''}`}>
      <div className="flex items-center justify-between mb-[5px]">
        <div className="flex items-center gap-[6px]">
          {/* Status dot */}
          <div
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
              isUpcoming ? 'bg-[#22c55e]' : 'bg-gray-300'
            }`}
          />
          <span className="text-[10.5px] font-bold text-gray-500 uppercase tracking-[0.06em]">
            {isUpcoming ? 'Upcoming Session' : 'Last Completed Visit'}
          </span>
        </div>

        {/* Confirmed pill (upcoming only) */}
        {isUpcoming && (
          <div className="inline-flex items-center gap-1 bg-[#dcfce7] rounded-full px-[9px] py-[3px]">
            <div className="w-[5px] h-[5px] rounded-full bg-[#16a34a]" />
            <span className="text-[11px] font-bold text-[#15803d]">Confirmed</span>
          </div>
        )}
      </div>

      {/* Date / time */}
      <div
        className={`text-[13.5px] leading-snug ${
          isUpcoming
            ? 'font-bold text-gray-900 mb-[10px]'
            : 'font-semibold text-gray-700'
        }`}
      >
        {dateTime}
      </div>

      {/* Cancel link (upcoming only) */}
      {isUpcoming && onCancel && (
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="bg-transparent border-none cursor-pointer font-medium text-[13px] text-[#D93025] min-w-[44px] min-h-[44px] flex items-center"
          >
            Cancel Appointment
          </button>
        </div>
      )}
    </div>
  );
}
