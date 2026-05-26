/**
 * AppointmentSlot — One appointment row in the doctor's today-timeline.
 *
 * Props:
 *   appointment — {
 *     id, slotTime, patientName, phone, reason,
 *     progressPercent?,  // 0–100; only provided when status='active'
 *     minsRemaining?,    // integer minutes left; only provided when status='active'
 *     startTime?,        // display string e.g. '10:15 AM'; optional
 *     endTime?           // display string e.g. '10:30 AM'; optional
 *   }
 *   status   — 'done' | 'active' | 'next' | 'upcoming'
 *   onNotes  — called to open NotesSheet (only wired for status='active')
 *   isLast   — boolean; suppresses the timeline connector line after the last slot
 *
 * Status visual mapping (extracted verbatim from doctor.html):
 *   done     — 0.56 opacity, gray dot, "DONE" grey pill
 *   active   — .active-slot class (green gradient + pulse-glow), animated live dot,
 *              "ACTIVE NOW" green pill, WhatsApp Call button, shimmer progress bar
 *   next     — amber pill/border, "NEXT UP"
 *   upcoming — sky-blue pill/border, "UPCOMING"
 *
 * WhatsApp call button:
 *   Renders as a button (no href) in the current implementation. In a production
 *   build, it would be an <a href={`https://wa.me/${phone}`}> deep-link that
 *   opens the native WhatsApp app pre-loaded with the patient's chat.
 *
 * `data-testid={`slot-${status}`}` enables test assertions like:
 *   screen.getByTestId('slot-done'), screen.getByTestId('slot-active'), etc.
 */
import ProgressBar from '../components/ProgressBar.jsx';
import { formatSlotTime } from '../utils/date.js';

function WAIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <circle cx="16" cy="16" r="14" fill="rgba(255,255,255,0.18)" />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M22.7 9.3A9.35 9.35 0 0 0 16 6.6c-5.19 0-9.4 4.21-9.4 9.4 0 1.66.44 3.28 1.27 4.7l-1.37 5 5.16-1.35a9.38 9.38 0 0 0 4.34 1.1c5.19 0 9.4-4.21 9.4-9.4 0-2.51-.98-4.87-2.7-6.65zm-6.7 14.45a7.8 7.8 0 0 1-3.97-1.08l-.28-.17-2.93.77.78-2.86-.19-.3a7.8 7.8 0 0 1-1.2-4.21c0-4.31 3.51-7.82 7.82-7.82 2.09 0 4.05.81 5.53 2.29a7.77 7.77 0 0 1 2.29 5.54c0 4.32-3.51 7.84-7.85 7.84z"
        fill="white"
      />
    </svg>
  );
}

// Status pill config
const STATUS_CONFIG = {
  done: {
    pillBg: '#f3f4f6',
    pillColor: '#9ca3af',
    label: 'DONE',
    dotBg: '#d1d5db',
    connectorBg: '#e5e7eb',
    rowBg: '#f9f8f7',
    rowBorder: '#f0ede9',
    opacity: 0.56,
  },
  active: {
    pillBg: '#22c55e',
    pillColor: 'white',
    label: 'ACTIVE NOW',
    dotBg: '#22c55e',
    connectorBg: '#86efac',
    rowBg: null,  // active-slot class handles this
    rowBorder: null,
    opacity: 1,
  },
  next: {
    pillBg: '#fff7ed',
    pillColor: '#c2410c',
    pillBorder: '#fed7aa',
    label: 'NEXT UP',
    dotBg: '#e5e7eb',
    connectorBg: '#e5e7eb',
    rowBg: '#fafaf9',
    rowBorder: '#f0ede9',
    opacity: 1,
  },
  upcoming: {
    pillBg: '#f0f9ff',
    pillColor: '#0369a1',
    pillBorder: '#bae6fd',
    label: 'UPCOMING',
    dotBg: '#e5e7eb',
    connectorBg: '#e5e7eb',
    rowBg: '#fafaf9',
    rowBorder: '#f0ede9',
    opacity: 1,
  },
};

export default function AppointmentSlot({ appointment, status = 'upcoming', onNotes, isLast = false }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.upcoming;
  const {
    slotTime,
    patientName,
    phone,
    reason,
    progressPercent = 0,
    minsRemaining,
    startTime,
    endTime,
  } = appointment ?? {};

  const timeLabel = slotTime ? formatSlotTime(slotTime) : '—';
  const isActive = status === 'active';

  return (
    <div
      className={`flex items-start gap-[9px] p-[12px_13px] rounded-[14px] flex-shrink-0 ${isActive ? 'active-slot' : ''}`}
      style={
        !isActive
          ? {
              background: cfg.rowBg,
              border: `1px solid ${cfg.rowBorder}`,
              opacity: cfg.opacity,
            }
          : undefined
      }
      data-testid={`slot-${status}`}
    >
      {/* Timeline dot + connector */}
      <div className="flex flex-col items-center flex-shrink-0 pt-[2px]">
        <div
          className={`w-[10px] h-[10px] rounded-full border-[2px] border-white ${isActive ? 'animate-dot-pulse' : ''}`}
          style={{
            background: cfg.dotBg,
            boxShadow: isActive ? '0 0 0 2px #86efac' : `0 0 0 1px ${cfg.dotBg}`,
            width: isActive ? '12px' : '10px',
            height: isActive ? '12px' : '10px',
          }}
        />
        {!isLast && (
          <div
            className="w-px mt-[3px]"
            style={{ height: '26px', background: cfg.connectorBg }}
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Time + status pill */}
        <div className="flex items-center justify-between gap-[5px] mb-[2px]">
          <span
            className={`text-[11.5px] font-bold tabular-nums ${
              isActive ? 'text-[#14532d] font-extrabold' : 'text-gray-600'
            }`}
          >
            {timeLabel}
          </span>
          <span
            className="status-pill"
            style={{
              background: cfg.pillBg,
              color: cfg.pillColor,
              border: cfg.pillBorder ? `1px solid ${cfg.pillBorder}` : 'none',
            }}
          >
            {cfg.label}
          </span>
        </div>

        {/* Patient name */}
        <p
          className={`text-[${isActive ? '13' : '15'}px] font-${isActive ? 'extrabold' : 'semibold'} ${
            isActive ? 'text-[#15803d]' : status === 'done' ? 'text-gray-500' : 'text-stone-950'
          }`}
        >
          {patientName ?? 'Unknown'}
        </p>

        {/* Phone + reason */}
        {isActive ? (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {phone && (
              <span className="text-[10px] font-semibold text-[#166534] bg-[#f0fdf4] border border-[#bbf7d0] rounded-[5px] px-[6px] py-[1px] whitespace-nowrap">
                📱 {phone}
              </span>
            )}
            {reason && (
              <span className="text-[10px] text-[#4b7c56] whitespace-nowrap overflow-hidden text-ellipsis max-w-[130px]">
                💬 {reason}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[11.5px] text-gray-400 mt-[3px] truncate">
            {[phone, reason].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Active slot extras */}
        {isActive && (
          <>
            {/* WhatsApp Call button */}
            <button
              className="w-full mt-[9px] h-[56px] border-none rounded-[14px] font-bold text-[13.5px] text-white cursor-pointer flex items-center justify-center gap-[9px]"
              style={{
                background: '#25D366',
                boxShadow: '0 8px 24px rgba(37,211,102,.38), 0 2px 8px rgba(37,211,102,.18)',
                letterSpacing: '-0.01em',
                fontFamily: 'DM Sans, sans-serif',
              }}
            >
              <WAIcon size={22} />
              <span>Start WhatsApp Call</span>
            </button>

            {/* Session progress */}
            <div className="mt-[9px] pt-[9px] border-t border-[#bbf7d0]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9.5px] font-bold text-[#15803d] uppercase tracking-[0.05em]">
                  Session Progress
                </span>
                {minsRemaining != null && (
                  <span className="text-[10px] font-extrabold text-[#15803d] tabular-nums">
                    {minsRemaining} mins remaining
                  </span>
                )}
              </div>
              <div className="w-full bg-[rgba(187,247,208,0.55)] rounded-full overflow-hidden h-[6px]">
                <div
                  className="shimmer-fill h-full rounded-full transition-[width] duration-1000"
                  style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
                />
              </div>
              {(startTime || endTime) && (
                <div className="flex justify-between mt-[3px]">
                  {startTime && <span className="text-[9px] text-[#4b7c56] font-medium">Started {startTime}</span>}
                  {endTime && <span className="text-[9px] text-[#4b7c56] font-medium">Ends {endTime}</span>}
                </div>
              )}
            </div>

            {/* Notes button */}
            {onNotes && (
              <button
                onClick={onNotes}
                className="w-full mt-[9px] py-[10px] rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d] font-semibold text-[12.5px] cursor-pointer"
              >
                📝 Add Consultation Notes
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
