/**
 * _base.js — Shared fetch wrapper for all API calls.
 *
 * All API modules (appointments.js, auth.js, doctor.js, …) call apiFetch
 * instead of fetch directly. This centralises:
 *   - The /api prefix (Vite proxies /api/* → FastAPI at localhost:8000)
 *   - The Content-Type header
 *   - Non-2xx error normalisation into a consistent shape:
 *       { code: string, error: string, status: number }
 *
 * Why throw an object rather than an Error instance?
 *   Callers destructure the error payload to display user-facing messages and
 *   branch on machine codes (e.g. 'duplicate_date', 'hold_expired'). An Error
 *   subclass would work but adds unnecessary prototype overhead for what is
 *   essentially a structured data transfer.
 *
 * Why not call updateActivity() here?
 *   updateActivity() resets the patient's 10-minute inactivity timer. Doctor
 *   API functions should not touch the patient session, so the call lives in
 *   each patient API function (appointments.js) rather than here.
 */

export async function apiFetch(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    // Try to parse the FastAPI error envelope { error, message } or { code, error }.
    // Fall back to generic values if the response body is not valid JSON.
    let payload = { code: 'unknown_error', error: res.statusText };
    try {
      payload = await res.json();
    } catch {
      // Non-JSON error body (e.g. a 502 from Nginx) — use the defaults above.
    }

    // Normalise: the FastAPI backend sometimes uses `error` as the machine code
    // (e.g. `{ "error": "duplicate_date", "message": "..." }`) and sometimes
    // has a separate `code` field. Prefer `code`; fall back to `error`.
    const err = {
      code:   payload.code   ?? payload.error ?? 'unknown_error',
      error:  payload.error  ?? res.statusText,
      status: res.status,
    };
    throw err;
  }

  return res.json();
}
