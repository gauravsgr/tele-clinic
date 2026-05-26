/**
 * SettingsPanel — Clinic configuration panel that slides in from the right edge.
 *
 * Triggered by the hamburger / gear icon in the DashboardPage header. This is
 * the doctor's control room for two destructive-ish operations:
 *   1. CancellationEngine — cancel a whole day or individual time slots
 *   2. WeeklySchedule     — toggle which days of the week the clinic is open
 *
 * Layout:
 *   Overlay (dark 32% opacity scrim) + Panel (86% width, slides from right)
 *   The 14% left gap is intentional: it signals to the doctor that the main
 *   dashboard is still underneath, and tapping that gap closes the panel.
 *
 *   Width = 86% rather than 100%: a full-width panel would feel modal / blocking.
 *   The partial reveal keeps context and is consistent with iOS's "action sheet"
 *   pattern for settings that modify but don't navigate away.
 *
 * Props:
 *   open        — boolean; drives translateX(0) ↔ translateX(100%) transition
 *   onClose     — dismiss callback; also wired to the dark overlay tap
 *   doctorToken — string; forwarded down to child engines for their API calls
 *
 * Success splash:
 *   When either CancellationEngine or WeeklySchedule completes successfully,
 *   they call `onSuccess()`. The panel renders a full-panel white overlay with
 *   a green checkmark for 2.5 seconds, then auto-removes. This provides instant,
 *   unambiguous feedback for destructive actions without leaving the panel.
 *
 *   Why 2.5s?  Long enough to read "Changes Saved!", short enough not to block
 *   the doctor from making additional changes immediately afterward.
 *
 * The panel itself doesn't call any APIs — it delegates entirely to its children.
 * This keeps the panel lightweight and the engines independently testable.
 */
import { useState } from 'react';
import CancellationEngine from './CancellationEngine.jsx';
import WeeklySchedule from './WeeklySchedule.jsx';

export default function SettingsPanel({ open, onClose, doctorToken }) {
  const [showSuccess, setShowSuccess] = useState(false);

  function handleSuccess() {
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 2500);
  }

  return (
    <>
      {/* Dark overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 z-[60] transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.32)' }}
        aria-hidden="true"
      />

      {/* Panel — slides from right */}
      <div
        className="absolute top-0 bottom-0 right-0 z-[70] bg-[#f9f8f7] flex flex-col transition-transform duration-300 ease-out overflow-hidden"
        style={{
          width: '86%',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          borderTopLeftRadius: '22px',
          borderBottomLeftRadius: '22px',
        }}
        role="dialog"
        aria-label="Clinic settings"
        data-testid="gear-panel"
      >
        {/* Sticky header */}
        <div className="px-[18px] pt-[52px] pb-[16px] flex items-center justify-between border-b border-[#f0ede9] bg-white sticky top-0 z-10">
          <div>
            <p className="text-[9px] font-bold text-gray-400 uppercase tracking-[0.1em] mb-[3px]">
              Clinic Settings
            </p>
            <h2 className="text-[15px] font-extrabold text-stone-950 tracking-tight leading-snug">
              ⚙️ Clinic Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="gear-btn flex-shrink-0"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-[18px] flex flex-col gap-4">
          <CancellationEngine doctorToken={doctorToken} onSuccess={handleSuccess} />
          <WeeklySchedule doctorToken={doctorToken} onSuccess={handleSuccess} />
        </div>

        {/* Success splash overlay (inside panel) */}
        {showSuccess && (
          <div className="absolute inset-0 z-20 bg-white/95 flex flex-col items-center justify-center">
            <div className="w-[72px] h-[72px] rounded-full bg-[#dcfce7] flex items-center justify-center mb-4">
              <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
                <path d="M7 18L14 25L27 10" stroke="#16a34a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <p className="text-[18px] font-extrabold text-stone-950 tracking-tight">Changes Saved!</p>
          </div>
        )}
      </div>
    </>
  );
}
