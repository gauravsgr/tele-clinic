/**
 * session.js — Patient session management.
 *
 * Stored in sessionStorage under key 'tele_session'.
 * Session expires on:
 *   - 10 minutes of inactivity (SESSION_INACTIVITY_MS)
 *   - 11:59 PM IST the same day it was created (hard daily cutoff)
 *
 * Doctor sessions are intentionally NOT managed here —
 * the doctor token is held in React component state only (cleared on reload by design).
 */

import { SESSION_KEY, SESSION_INACTIVITY_MS } from './constants.js';
import { endOfDayIST } from './date.js';

/**
 * Retrieve and validate the current session.
 * Returns the session object if valid, or null if expired/absent.
 */
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session || !session.phone || !session.lastActivity || !session.expiresAt) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Persist a new session. Call after successful OTP verification.
 * @param {{ phone: string, sessionToken: string }} data
 */
export function setSession(data) {
  const session = {
    ...data,
    lastActivity: Date.now(),
    expiresAt: endOfDayIST().getTime(), // 11:59 PM IST tonight
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Remove the session (on explicit logout or expiry detection).
 */
export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

/**
 * Refresh the lastActivity timestamp to reset the inactivity window.
 * Clears the session if it has already expired.
 */
export function updateActivity() {
  const session = getSession();
  if (!session) return;
  session.lastActivity = Date.now();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * Returns true if the session exists and has not expired.
 *
 * Two expiry conditions:
 *   1. Hard cutoff: current time >= expiresAt (11:59 PM IST)
 *   2. Inactivity: (now - lastActivity) >= SESSION_INACTIVITY_MS (10 min)
 */
export function isSessionValid() {
  const session = getSession();
  if (!session) return false;

  const now = Date.now();

  // Hard daily cutoff
  if (now >= session.expiresAt) {
    clearSession();
    return false;
  }

  // Inactivity timeout
  if (now - session.lastActivity >= SESSION_INACTIVITY_MS) {
    clearSession();
    return false;
  }

  return true;
}
