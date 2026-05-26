/**
 * schedule.js — Doctor weekly schedule management.
 *
 * The weekly schedule defines which days of the week the doctor is open.
 * Changes take effect 28 days from today (effective_from field) to avoid
 * disrupting already-booked future appointments.
 *
 * The schedule is stored as 7 rows in the weekly_schedule DB table
 * (day_of_week 0=Monday … 6=Sunday), not as a bitmask, to make partial
 * updates and human-readable queries straightforward.
 */
import { apiFetch } from './_base.js';

/**
 * Fetch the current 7-day weekly schedule.
 *
 * @returns {{ schedule: { Mon: bool, Tue: bool, Wed: bool, Thu: bool, Fri: bool, Sat: bool, Sun: bool } }}
 */
export async function getWeeklySchedule(doctorToken) {
  return apiFetch('/doctor/weekly-schedule', {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
}

/**
 * Persist an updated weekly schedule.
 *
 * The effective_from date is computed by the backend (today + 28 days).
 * The doctor UI displays this date as an informational notice so the
 * doctor knows their changes won't affect the current booking window.
 *
 * @param {{ Mon: bool, Tue: bool, … }} schedule — day-label → open boolean map
 * @returns {{ saved: boolean, effective_from: string }} effective_from in 'YYYY-MM-DD'
 */
export async function saveWeeklySchedule(schedule, doctorToken) {
  return apiFetch('/doctor/weekly-schedule', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${doctorToken}` },
    body: JSON.stringify({ schedule }),
  });
}
