/**
 * PhoneInput — 🇮🇳 +91 country code pill + 10-digit mobile number input.
 *
 * Props:
 *   value       — controlled 10-digit string (no country code, no spaces)
 *   onChange    — called with the new digit-only string (max 10 digits)
 *   disabled    — boolean
 *   placeholder — string (default 'Mobile number')
 *
 * Why separate from a plain <input type="tel">?
 *   The design shows a fixed "+91" prefix visually fused to the input field.
 *   Using a composited div with a divider line matches the HTML prototype exactly
 *   and avoids the UX problem of users typing the country code themselves.
 *
 * The onChange handler strips all non-digits and hard-caps at 10 characters,
 * so the parent never sees a value longer than a valid Indian mobile number.
 * Normalisation to E.164 (prepending '91') happens in BookingSheet via toE164().
 *
 * focus-within on the outer container highlights the border when either the
 * flag text or the input is focused — matching the single-field focus ring
 * from the prototype.
 */
export default function PhoneInput({
  value = '',
  onChange,
  disabled = false,
  placeholder = 'Mobile number',
}) {
  function handleChange(e) {
    // Strip non-numeric characters and limit to 10 digits.
    // This prevents paste of formatted numbers like "+91 98765-43210".
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    onChange(digits);
  }

  return (
    <div className="flex items-center gap-2 w-full border border-gray-200 rounded-[14px] bg-[#fafafa] transition-all duration-[180ms] focus-within:bg-white focus-within:border-blue-500 px-3">
      {/* Country code pill — non-interactive, purely visual */}
      <div className="flex items-center gap-1 flex-shrink-0 text-gray-700 font-medium text-sm py-[13px]">
        <span className="text-base leading-none">🇮🇳</span>
        <span>+91</span>
      </div>

      {/* Visual divider between flag and input */}
      <div className="w-px h-5 bg-gray-200 flex-shrink-0" />

      {/* 10-digit number input.
          inputMode="numeric" shows the numeric keypad on mobile.
          type="tel" provides better autocomplete behaviour on desktop (browser
          may offer saved phone numbers). */}
      <input
        type="tel"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={10}
        className="flex-1 bg-transparent outline-none text-sm text-gray-900 py-[13px] min-w-0"
      />
    </div>
  );
}
