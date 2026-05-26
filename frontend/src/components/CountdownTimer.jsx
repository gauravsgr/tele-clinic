/**
 * CountdownTimer — Self-ticking countdown display.
 *
 * Props:
 *   seconds   — initial count in seconds (positive integer)
 *   onExpire  — called when the counter reaches 0 (optional)
 *   className — additional Tailwind/CSS classes on the <span>
 *
 * Display format:
 *   ≥ 60 s  →  "M:SS"  (e.g. "1:59")
 *   < 60 s  →  "Xs"    (e.g. "42s")
 *
 * Implementation note — why chained setTimeout instead of setInterval:
 *   setInterval fires at a fixed wall-clock period that doesn't account for
 *   React re-render time. When this component is used under fake timers in
 *   tests (vi.useFakeTimers), a single advanceTimersByTime(2000) call won't
 *   chain two separate 1000ms ticks because the second setTimeout is only
 *   registered after the first state update is processed (which requires a
 *   re-render). Using chained setTimeout means each tick depends on the
 *   previous render, which is both more accurate in production and easier
 *   to drive in tests (advance one tick at a time).
 *
 * The `key` prop pattern:
 *   Parent components bump a `cdKey` integer whenever they want to reset the
 *   timer (e.g. after OTP resend). React treats a changed key as unmount +
 *   remount, which re-initialises `remaining` to `seconds` cleanly.
 */
import { useState, useEffect } from 'react';

export default function CountdownTimer({ seconds, onExpire, className = '' }) {
  const [remaining, setRemaining] = useState(seconds);

  // Sync remaining when the initial `seconds` prop changes (e.g. resend resets to 59).
  useEffect(() => {
    setRemaining(seconds);
  }, [seconds]);

  // Each tick registers a new 1-second timeout that decrements remaining by 1.
  // The effect re-runs whenever `remaining` changes (chained-setTimeout pattern).
  useEffect(() => {
    if (remaining <= 0) {
      onExpire?.();
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id); // cleanup prevents double-tick on strict-mode double invocation
  }, [remaining, onExpire]);

  function format(s) {
    if (s >= 60) {
      const m = Math.floor(s / 60);
      const sec = String(s % 60).padStart(2, '0');
      return `${m}:${sec}`;
    }
    return `${s}s`;
  }

  return (
    <span className={className} data-testid="countdown">
      {format(remaining)}
    </span>
  );
}
