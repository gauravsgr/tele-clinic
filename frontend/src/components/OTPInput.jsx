/**
 * OTPInput — 4-box OTP entry component.
 *
 * Props:
 *   value    — controlled string of up to 4 digits (e.g. '' | '12' | '1234')
 *   onChange — called with the new digit string on every change
 *   accent   — hex colour for filled/focused border (default: '#2563eb' patient blue)
 *   disabled — boolean; disables all boxes during API calls
 *
 * Behaviour:
 *   - Digit-only: non-digit keystrokes are silently ignored.
 *   - Auto-advance: entering a digit focuses the next box automatically.
 *   - Backspace: if current box is empty, clears the previous box and moves focus back.
 *   - Paste: strips non-digits, fills up to 4 boxes, focuses the last filled box.
 *
 * Why `Array.from({ length: 4 }, (_, i) => value[i] || '')` instead of
 * `value.padEnd(4, '').split('')`?
 *   padEnd(4, '') does nothing when the fill string is an empty string — the
 *   ECMAScript spec defines fillString as '' → no padding is inserted. So
 *   ''.padEnd(4, '') === '', and split('') gives [], making chars an empty array.
 *   Array.from always produces exactly 4 elements regardless of value.length.
 *
 * Accent colour + Tailwind:
 *   Tailwind's JIT cannot generate `border-[#2563eb]` from a runtime prop.
 *   We use a single CSS custom property wrapper (`style={{ '--accent': accent }}`)
 *   and reference it via inline style on each input. This is the only `style={{}}`
 *   exception to the Tailwind-only rule in this codebase.
 */
import { useRef } from 'react';

const BOXES = [0, 1, 2, 3];

export default function OTPInput({ value = '', onChange, accent = '#2563eb', disabled = false }) {
  const refs = useRef([]);

  // Always produce exactly 4 character slots, even when value is shorter.
  // Index access on a shorter string returns undefined, which || '' coerces to ''.
  const chars = Array.from({ length: 4 }, (_, i) => value[i] || '');

  function handleKeyDown(e, idx) {
    if (e.key === 'Backspace') {
      // Prevent the browser from navigating back when the input is empty.
      e.preventDefault();
      if (chars[idx]) {
        // There is a digit in this box — clear it and stay focused here.
        const next = chars.map((c, i) => (i === idx ? '' : c)).join('').trimEnd();
        onChange(next);
      } else if (idx > 0) {
        // Current box is already empty — shift focus left and clear that box.
        refs.current[idx - 1]?.focus();
        const next = chars.map((c, i) => (i === idx - 1 ? '' : c)).join('').trimEnd();
        onChange(next);
      }
    }
  }

  function handleInput(e, idx) {
    // Strip non-digits. If the user types multiple chars (e.g. autocomplete fills
    // the field), take only the last digit — prevents jumbled multi-char strings.
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    const digit = raw[raw.length - 1];
    const next = chars.map((c, i) => (i === idx ? digit : c));
    onChange(next.join(''));
    // Auto-advance focus to the next box (but don't go past index 3).
    if (idx < 3) refs.current[idx + 1]?.focus();
  }

  function handlePaste(e) {
    e.preventDefault();
    // Accept pasted content; strip non-digits and truncate to 4 characters.
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    onChange(pasted);
    // Focus the last filled box (or the 4th box if fully filled).
    const focusIdx = Math.min(pasted.length, 3);
    refs.current[focusIdx]?.focus();
  }

  // Select-all on focus so re-entry immediately overwrites the existing digit.
  function handleFocus(e) {
    e.target.select();
  }

  return (
    // The --accent CSS custom property is the only style prop in this project.
    // See module docstring above for the Tailwind-JIT limitation rationale.
    <div className="flex justify-center gap-3" style={{ '--accent': accent }}>
      {BOXES.map((idx) => {
        const filled = !!chars[idx];
        return (
          <input
            key={idx}
            ref={(el) => (refs.current[idx] = el)}
            type="text"
            inputMode="numeric"   // shows numeric keyboard on iOS/Android
            pattern="[0-9]*"     // additional iOS Safari numeric keyboard hint
            maxLength={1}
            value={chars[idx] || ''}
            disabled={disabled}
            aria-label={`OTP digit ${idx + 1}`}
            className={`otp-box ${filled ? 'filled' : ''}`}
            style={{
              // Override the green default border with the runtime accent colour.
              // .otp-box.filled in index.css sets border-color: #22c55e;
              // this inline value wins for non-doctor accents (e.g. patient blue).
              borderColor: filled ? 'var(--accent)' : undefined,
            }}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            onInput={(e) => handleInput(e, idx)}
            onPaste={handlePaste}
            onFocus={handleFocus}
            onChange={() => {}} // controlled component — suppress React's uncontrolled input warning
          />
        );
      })}
    </div>
  );
}
