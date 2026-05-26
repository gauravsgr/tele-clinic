/**
 * SuccessScreen — Full booking confirmation view.
 *
 * Replaces the BookingPage content entirely (not a sheet) after a successful
 * booking. It is not a route — BookingPage sets `screen = 'success'` and
 * renders SuccessScreen instead of the slot grid.
 *
 * Props:
 *   appointment — { name, date, time, duration, doctorName }
 *   onReset     — called when "Book Another Appointment" is pressed;
 *                 resets BookingPage back to the scheduler view
 *
 * Animation sequence (all Tailwind custom animations from tailwind.config.js):
 *   1. Green circle: animate-pop-circle (spring scale from 0.6 → overshoot → 1.0)
 *   2. SVG checkmark path: animate-draw-check (stroke-dashoffset 80 → 0)
 *      Both fire simultaneously; draw-check has a 0.3s delay so the circle
 *      appears first, then the check draws inside it.
 *   3. "Appointment Confirmed!" heading: animate-fade-up-1 (delay 0.55s)
 *   4. Sub-label + booking card: animate-fade-up-2 (delay 0.70s)
 *   5. WhatsApp notice banner: animate-fade-up-3 (delay 0.85s)
 *   6. "Book Another Appointment" button: animate-fade-up-4 (delay 1.00s)
 *
 * The staggered delays create a cascading entrance effect that guides the
 * patient's eye from the confirmation visual down through the booking details.
 */

/** Inline WhatsApp brand icon — used in the "no app downloads needed" banner. */
function WAIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="16" fill="#25D366" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.7 9.3A9.35 9.35 0 0 0 16 6.6c-5.19 0-9.4 4.21-9.4 9.4 0 1.66.44 3.28 1.27 4.7l-1.37 5 5.16-1.35a9.38 9.38 0 0 0 4.34 1.1c5.19 0 9.4-4.21 9.4-9.4 0-2.51-.98-4.87-2.7-6.65zm-6.7 14.45a7.8 7.8 0 0 1-3.97-1.08l-.28-.17-2.93.77.78-2.86-.19-.3a7.8 7.8 0 0 1-1.2-4.21c0-4.31 3.51-7.82 7.82-7.82 2.09 0 4.05.81 5.53 2.29a7.77 7.77 0 0 1 2.29 5.54c0 4.32-3.51 7.84-7.85 7.84z"
        fill="white"
      />
    </svg>
  );
}

export default function SuccessScreen({ appointment, onReset }) {
  const { name, date, time, duration = '15 min', doctorName } = appointment ?? {};

  // Booking card rows — declarative so adding/removing a row is a one-liner.
  const rows = [
    { icon: '👤',  label: 'Patient',  value: name },
    { icon: '📅',  label: 'Date',     value: date },
    { icon: '🕐',  label: 'Time',     value: time },
    { icon: '⏱',   label: 'Duration', value: duration },
    { icon: '👩‍⚕️', label: 'Doctor',   value: doctorName },
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 pb-0 overflow-hidden">
      {/* ── Animated checkmark ── */}
      <div
        className="w-24 h-24 rounded-full bg-[#dcfce7] flex items-center justify-center mb-6 animate-pop-circle"
        aria-label="Booking confirmed"
      >
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
          {/* strokeDasharray="80" sets the path length so the draw animation works.
              strokeDashoffset starts at 80 (fully hidden) and animates to 0 (fully visible). */}
          <path
            className="animate-draw-check"
            d="M10 27L22 39L42 15"
            stroke="#16a34a"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="80"
            strokeDashoffset="80"
          />
        </svg>
      </div>

      {/* Heading — fade-up-1 fires at 0.55s, after the circle animation completes */}
      <div className="text-center mb-[6px] animate-fade-up-1">
        <h2 className="text-[22px] font-extrabold text-gray-900 tracking-tight leading-tight">
          Appointment Confirmed!
        </h2>
      </div>

      {/* Sub-label */}
      <p className="text-[13.5px] text-gray-500 text-center mb-[22px] leading-relaxed animate-fade-up-2">
        We&apos;ve saved your slot with {doctorName}
      </p>

      {/* Booking summary card */}
      <div className="w-full bg-[#f9fafb] rounded-[18px] p-[16px_18px] mb-5 border border-gray-100 animate-fade-up-2">
        {rows.map(({ icon, label, value }) => (
          <div
            key={label}
            className="flex justify-between items-center py-[7px] border-b border-gray-100 last:border-b-0"
          >
            <span className="text-[12.5px] text-gray-400 font-medium">
              {icon} {label}
            </span>
            <span className="text-[13px] font-semibold text-gray-900 max-w-[58%] text-right">
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* WhatsApp notice — explains the call mechanism to first-time patients */}
      <div className="w-full bg-[#f0fdf4] rounded-2xl p-[14px_16px] flex gap-3 items-start mb-5 border border-[#bbf7d0] animate-fade-up-3">
        <div className="flex-shrink-0 mt-[2px]">
          <WAIcon size={28} />
        </div>
        <div>
          <p className="font-bold text-[13px] text-[#15803d] mb-[3px]">No app downloads needed</p>
          <p className="text-[12px] text-[#166534] leading-relaxed">
            The doctor will call you directly on WhatsApp video at your appointment time. Keep your phone nearby!
          </p>
        </div>
      </div>

      {/* Reset CTA */}
      <div className="w-full animate-fade-up-4 pb-2">
        <button
          onClick={onReset}
          className="w-full py-[14px] rounded-[14px] border-none bg-p-accent text-white font-bold text-[15px] cursor-pointer"
          style={{ boxShadow: '0 6px 22px rgba(37,99,235,0.26)', letterSpacing: '-0.01em' }}
        >
          Book Another Appointment
        </button>
      </div>
    </div>
  );
}
