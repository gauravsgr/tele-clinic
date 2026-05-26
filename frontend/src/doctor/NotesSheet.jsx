/**
 * NotesSheet — Slide-up bottom sheet for live consultation notes.
 *
 * Allows the doctor to type clinical observations mid-session and send them
 * directly to the patient over WhatsApp. This is the primary channel for
 * post-consultation instructions (e.g. prescriptions, test referrals, advice).
 *
 * Props:
 *   open          — boolean; controls slide-up/down animation
 *   onClose       — called when the × button or overlay is tapped;
 *                   also called automatically after 3s on successful send
 *   activePatient — { name: string, slotTime: ISO string } used in the header;
 *                   if null, falls back to 'Active patient'
 *   appointmentId — string; required by POST /doctor/notes to attach notes
 *                   to the correct appointment record
 *   doctorToken   — string; bearer token for the API call
 *
 * State machine:
 *   Idle    → doctor types in textarea   → loading → sent (success state)
 *          → sent state auto-closes after 3s           ↑
 *          →        error stays visible, doctor retries ┘
 *
 * UX notes:
 *   - The textarea is disabled while loading or after successful send, preventing
 *     accidental duplicate sends while the auto-close timer is ticking.
 *   - The send button morphs to a green "Notes Sent!" confirmation card so the
 *     doctor has unambiguous visual confirmation before the sheet closes.
 *   - This sheet does NOT use the shared BottomSheet component because it needs
 *     its own transparent overlay behaviour (clicking the overlay closes without
 *     navigating away from an active call).
 *
 * Sheet geometry:
 *   maxHeight: 72% — keeps the sheet comfortably above the WhatsApp call button
 *   that the doctor may have visible on-screen during an active session.
 */
import { useState, useEffect } from 'react';
import { sendNotes } from '../api/doctor.js';
import { formatSlotTime } from '../utils/date.js';

export default function NotesSheet({ open, onClose, activePatient, appointmentId, doctorToken }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset the textarea and status flags each time the sheet opens so the doctor
  // always starts with a fresh canvas, rather than seeing yesterday's notes.
  // We gate on `open` (not on unmount) because this component stays mounted in
  // the DOM when closed — CSS-only slide-out, no remount.
  useEffect(() => {
    if (open) {
      setText('');
      setSent(false);
      setError('');
    }
  }, [open]);

  async function handleSend() {
    // Guard: empty text, concurrent in-flight request, or already sent.
    // The `sent` guard prevents a second send after the success card renders
    // but before the 3s auto-close fires.
    if (!text.trim() || loading || sent) return;
    setLoading(true);
    setError('');
    try {
      await sendNotes(appointmentId, text.trim(), doctorToken);
      setSent(true);
      // Auto-close after 3s — gives the doctor enough time to read the
      // confirmation without requiring a manual tap. 3s is short enough not to
      // feel sluggish but long enough to read "Notes sent via WhatsApp".
      setTimeout(() => {
        setSent(false);
        onClose();
      }, 3000);
    } catch (err) {
      setError(err.error ?? 'Failed to send notes.');
    } finally {
      setLoading(false);
    }
  }

  const patientName = activePatient?.name ?? 'Active patient';
  const slotLabel = activePatient?.slotTime ? formatSlotTime(activePatient.slotTime) : '';

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        className={`absolute inset-0 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0)' }}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        className="absolute bottom-0 left-0 right-0 z-50 bg-white rounded-t-[22px] flex flex-col transition-transform duration-300 ease-out"
        style={{
          maxHeight: '72%',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
        }}
        role="dialog"
        aria-label="Consultation notes"
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-[18px] pb-[12px] pt-[8px] border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-[3px] h-4 rounded-full bg-[#22c55e] flex-shrink-0" />
            <h3 className="text-[14px] font-extrabold text-stone-950">Live Consultation Notes</h3>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent border-none text-[20px] text-gray-400 cursor-pointer px-1 leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-[18px] pt-[14px] pb-2">
          <p className="text-[11.5px] text-stone-400 mb-[10px]">
            Active session: <strong className="text-[#15803d]">{patientName}</strong>
            {slotLabel ? ` · ${slotLabel}` : ''}
          </p>

          <textarea
            className="notes-area w-full"
            rows={5}
            placeholder="Type clinical observations, symptoms, or instructions here…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={loading || sent}
          />

          {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}

          {/* Send button or sent confirmation */}
          {sent ? (
            <div className="flex items-center gap-[10px] bg-[#f0fdf4] border border-[#bbf7d0] rounded-[13px] p-[12px_14px] mt-3 mb-3">
              <div className="w-7 h-7 rounded-full bg-[#22c55e] flex items-center justify-center flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7l4 4 6-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div>
                <p className="text-[12.5px] font-bold text-[#15803d] leading-tight">Notes sent via WhatsApp</p>
                <p className="text-[11px] text-[#4b7c56] mt-[2px]">{patientName} will receive them shortly</p>
              </div>
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!text.trim() || loading}
              className="btn-push mt-3 mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="16" fill="#25D366" />
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M22.7 9.3A9.35 9.35 0 0 0 16 6.6c-5.19 0-9.4 4.21-9.4 9.4 0 1.66.44 3.28 1.27 4.7l-1.37 5 5.16-1.35a9.38 9.38 0 0 0 4.34 1.1c5.19 0 9.4-4.21 9.4-9.4 0-2.51-.98-4.87-2.7-6.65z"
                  fill="white"
                />
              </svg>
              {loading ? 'Sending…' : 'Send Notes to Patient'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
