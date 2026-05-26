/**
 * Toast — Transient notification banner inside the phone screen.
 *
 * Props:
 *   message   — text to display
 *   variant   — 'success' | 'error' (default 'success')
 *   visible   — boolean; triggers the slide-in animation and auto-dismiss timer
 *   onDismiss — called after the 3-second auto-dismiss (parent hides it)
 *
 * Design decisions:
 *   - Positioned absolutely at top-[90px] so it clears the StatusBar (80px)
 *     and appears just below the dynamic island area.
 *   - `translate-y-0 opacity-100` when visible; `-translate-y-4 opacity-0`
 *     when hidden. The 300ms CSS transition produces the slide-in effect.
 *   - `pointer-events-none` when hidden prevents the invisible element from
 *     blocking touches on the content beneath it.
 *   - The auto-dismiss timer is reset every time `visible` changes to true,
 *     so rapid successive toasts each get their own 3-second window.
 *
 * aria-live="polite" announces the message to screen readers without
 * interrupting ongoing speech.
 */
import { useEffect } from 'react';

export default function Toast({ message, variant = 'success', visible, onDismiss }) {
  // Start a 3-second auto-dismiss timer each time the toast becomes visible.
  // The cleanup function cancels the timer if the component unmounts or if
  // `visible` flips back to false before the 3 seconds elapse.
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => onDismiss?.(), 3000);
    return () => clearTimeout(id);
  }, [visible, onDismiss]);

  const bg = variant === 'error' ? 'bg-red-600' : 'bg-[#16a34a]';
  const icon = variant === 'error' ? '✕' : '✓';

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`absolute top-[90px] left-4 right-4 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-lg transition-all duration-300 ${bg} ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'
      }`}
    >
      <span className="font-bold text-base leading-none">{icon}</span>
      <span>{message}</span>
    </div>
  );
}
