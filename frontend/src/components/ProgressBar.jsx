/**
 * ProgressBar — Shimmer-animated green fill bar.
 *
 * Props:
 *   percent   — 0–100 (values outside this range are clamped)
 *   className — additional classes on the outer container
 *
 * Used by AppointmentSlot to display the active session timer:
 *   0% when the slot just started, 100% when 15 minutes have elapsed.
 *   The width transitions over 1s (transition-[width] duration-1000) to avoid
 *   jumpy updates when the parent re-calculates progress every 30 seconds.
 *
 * The `.shimmer-fill` class (defined in index.css) applies a moving gradient
 * that sweeps left-to-right over the filled portion, giving a "loading" feel
 * that signals an active, ongoing session.
 *
 * Accessibility: role="progressbar" + aria-valuenow/min/max allow screen
 * readers to announce the current progress value.
 */
export default function ProgressBar({ percent = 0, className = '' }) {
  // Clamp to [0, 100] so callers don't need to guard against edge values.
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <div className={`w-full h-[6px] bg-gray-100 rounded-full overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full shimmer-fill transition-[width] duration-1000"
        style={{ width: `${clamped}%` }}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
