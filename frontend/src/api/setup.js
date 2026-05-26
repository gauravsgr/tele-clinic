/**
 * setup.js — Google OAuth + setup status endpoints.
 *
 * These endpoints are only called from SetupPage when the doctor navigates
 * to the WhatsApp & Google Setup section of the dashboard.
 *
 * Google Contacts integration flow:
 *   1. Doctor clicks "Connect Google Contacts"
 *   2. Frontend calls initiateGoogleAuth → receives { auth_url }
 *   3. Frontend redirects to auth_url (Google's OAuth consent screen)
 *   4. After consent, Google redirects to /oauth2callback on the FastAPI backend
 *   5. Backend stores the refresh token in .env; redirects browser to
 *      http://localhost:5173/doctor?google=connected
 *   6. SetupPage detects the ?google=connected query param and shows "Connected"
 */
import { apiFetch } from './_base.js';

/**
 * Check whether Google OAuth has been configured and is still valid.
 *
 * @returns {{ connected: boolean, email?: string }}
 */
export async function getGoogleStatus(doctorToken) {
  return apiFetch('/setup/google-status', {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
}

/**
 * Begin the Google OAuth flow — returns the URL to redirect the browser to.
 *
 * The redirect URI configured in Google Cloud Console must be
 * http://localhost:8000/oauth2callback (FastAPI port, not Vite port).
 *
 * @returns {{ auth_url: string }} — the Google OAuth consent page URL
 */
export async function initiateGoogleAuth(doctorToken) {
  return apiFetch('/setup/google-auth', {
    headers: { Authorization: `Bearer ${doctorToken}` },
  });
}
