/**
 * phone.js — E.164 phone number helpers for Indian numbers.
 *
 * Storage format: pure digits, no '+', e.g. '919876543210'
 * Display format: '+91 XXXXX XXXXX'
 */

/**
 * Convert a 10-digit Indian mobile number to E.164 storage format.
 * Accepts '9876543210' → '919876543210'
 * Also accepts numbers already prefixed with '91' or '+91' — normalises them.
 */
export function toE164(input) {
  if (!input) return '';
  // Strip all non-digits
  const digits = String(input).replace(/\D/g, '');
  if (digits.length === 10) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  // fallback: return as-is (validation is caller's responsibility)
  return digits;
}

/**
 * Convert E.164 storage format to human-readable display.
 * '919876543210' → '+91 98765 43210'
 */
export function toDisplayPhone(e164) {
  if (!e164) return '';
  const digits = String(e164).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2); // 10-digit local number
    return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
  }
  return '+' + digits;
}

/**
 * Mask an E.164 number for privacy display.
 * '919876543210' → '+91 •••••43210'
 */
export function maskPhone(e164) {
  if (!e164) return '';
  const digits = String(e164).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2); // 10-digit local number
    return `+91 •••••${local.slice(5)}`;
  }
  return '•••••••••••';
}
