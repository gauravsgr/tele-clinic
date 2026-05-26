/**
 * date.js — IST-aware date and time helpers.
 *
 * All datetimes stored/received from the backend use ISO 8601 with +05:30.
 * All UI display times are in IST. The frontend never uses bare UTC strings.
 */

import { BOOKING_WINDOW_DAYS, CUTOFF_MIN, IST_OFFSET_MS } from './constants.js';

/** Return the current moment as a Date adjusted to IST. */
export function nowIST() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

/**
 * Convert any Date (or ISO string) to a YYYY-MM-DD string in IST.
 * e.g. new Date('2026-05-25T23:30:00Z') → '2026-05-26' (it's already next day in IST)
 */
export function toISTDateStr(dateOrStr) {
  const d = typeof dateOrStr === 'string' ? new Date(dateOrStr) : dateOrStr;
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return ist.toISOString().slice(0, 10);
}

/**
 * Format a slot ISO string to a human-readable time in IST.
 * e.g. '2026-05-25T10:15:00+05:30' → '10:15 AM'
 */
export function formatSlotTime(isoStr) {
  const d = new Date(isoStr);
  // Convert to IST
  const ist = new Date(d.getTime() + IST_OFFSET_MS - d.getTimezoneOffset() * 60_000);
  // Use the ISO string hours/minutes directly since the backend stores +05:30
  const parts = isoStr.match(/T(\d{2}):(\d{2})/);
  if (!parts) return '';
  let h = parseInt(parts[1], 10);
  const m = parts[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Format an ISO date or date string to a long display string.
 * e.g. '2026-05-25' → 'Monday, 25 May 2026'
 */
export function formatDisplayDate(isoStr) {
  // Parse as noon IST to avoid timezone boundary issues
  const d = new Date(isoStr + 'T12:00:00+05:30');
  return d.toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Short display date: e.g. 'Tue, 19 May'
 */
export function formatShortDate(isoStr) {
  const d = new Date(isoStr + 'T12:00:00+05:30');
  return d.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * Returns true if two ISO strings fall on the same calendar date in IST.
 */
export function isSameISTDate(isoA, isoB) {
  return toISTDateStr(isoA) === toISTDateStr(isoB);
}

/**
 * Returns true if the slot ISO string is within the 28-day booking window.
 */
export function isWithinBookingWindow(slotISO) {
  const slotDate = new Date(slotISO);
  const now = new Date();
  const maxDate = new Date(now.getTime() + BOOKING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return slotDate <= maxDate;
}

/**
 * Returns true if the slot is within the 1-hour cutoff (cannot be booked).
 */
export function isPastCutoff(slotISO) {
  const slotMs = new Date(slotISO).getTime();
  const nowMs  = Date.now();
  return slotMs - nowMs < CUTOFF_MIN * 60 * 1000;
}

/**
 * 11:59 PM IST today as a Date.
 */
export function endOfDayIST() {
  const ist = nowIST();
  // Set to 23:59:00 IST
  const y = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d  = String(ist.getUTCDate()).padStart(2, '0');
  return new Date(`${y}-${mo}-${d}T23:59:00+05:30`);
}

/**
 * Generate an array of { dateStr: 'YYYY-MM-DD', dayLabel: 'Mon', dayNum: '19' }
 * for the next BOOKING_WINDOW_DAYS days starting from today (IST).
 */
export function generateDateStrip() {
  const days = [];
  const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const now = nowIST();
  // Zero out the time in IST to get today's date at midnight IST
  const todayIST = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );

  for (let i = 0; i < BOOKING_WINDOW_DAYS; i++) {
    const d = new Date(todayIST.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ...
    days.push({
      dateStr,
      dayLabel: DAY_LABELS[dayOfWeek],
      dayNum: String(d.getUTCDate()),
      dayOfWeek,
    });
  }
  return days;
}

/**
 * Generate the morning slot times for a given date.
 * Returns ISO 8601 strings with +05:30 offset.
 * Morning: 10:00–11:45 (8 slots × 15 min)
 */
export function generateMorningSlots(dateStr) {
  return generateSlotsForRange(dateStr, 10, 0, 11, 45);
}

/**
 * Evening: 16:00–18:45 (12 slots × 15 min)
 */
export function generateEveningSlots(dateStr) {
  return generateSlotsForRange(dateStr, 16, 0, 18, 45);
}

function generateSlotsForRange(dateStr, startH, startM, endH, endM) {
  const slots = [];
  let h = startH, m = startM;
  while (h < endH || (h === endH && m <= endM)) {
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    slots.push(`${dateStr}T${hh}:${mm}:00+05:30`);
    m += 15;
    if (m >= 60) { m -= 60; h += 1; }
  }
  return slots;
}
