/**
 * App.jsx — Application root: route definitions and per-side app shells.
 *
 * Two completely separate React sub-trees share this file:
 *
 *   PatientApp  (route: /)
 *     - Sets `data-side="patient"` on <body> → index.css applies the blue
 *       radial gradient background on desktop around the phone shell.
 *     - Wraps BookingPage in PhoneWrapper (iPhone shell on desktop, native on mobile).
 *     - No authentication — patients interact without a prior login.
 *
 *   DoctorApp  (route: /doctor and /doctor/*)
 *     - Sets `data-side="doctor"` → green radial gradient background.
 *     - Maintains `doctorToken` in React state (intentionally not in localStorage
 *       or sessionStorage). Token cleared on page reload forces re-authentication,
 *       which is the desired security posture for a shared-device clinic tablet.
 *     - OTPGate renders as a full-screen overlay (`absolute inset-0`) on top of
 *       DashboardPage. When `doctorToken` is truthy, OTPGate is unmounted and
 *       DashboardPage becomes fully interactive.
 *
 * Why does DoctorApp render DashboardPage even before authentication?
 *   DashboardPage is rendered (but obscured) so it can pre-load its data while
 *   the doctor is entering the OTP. By the time they authenticate, the timeline
 *   is already populated — zero additional load time after login.
 *
 * data-side cleanup:
 *   The useEffect return function removes `data-side` when the component unmounts.
 *   This is a defensive measure; in practice, navigating between / and /doctor
 *   replaces one App child with the other, so both cleanup and re-set always
 *   run in the correct order.
 *
 * Route /doctor/* catches child routes that SetupPage or future sub-pages might
 * add. DoctorApp handles internal navigation with its own `page` state, not
 * with nested React Router routes.
 */
import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import PhoneWrapper from './components/PhoneWrapper.jsx';
import BookingPage from './patient/BookingPage.jsx';
import OTPGate from './doctor/OTPGate.jsx';
import DashboardPage from './doctor/DashboardPage.jsx';

// ── Patient App ──────────────────────────────────────────────────────────────
function PatientApp() {
  // data-side="patient" on <body> triggers the blue gradient background in index.css.
  // useEffect with empty deps fires once on mount and cleans up on unmount.
  useEffect(() => {
    document.body.setAttribute('data-side', 'patient');
    return () => document.body.removeAttribute('data-side');
  }, []);

  return (
    <PhoneWrapper>
      <BookingPage />
    </PhoneWrapper>
  );
}

// ── Doctor App ───────────────────────────────────────────────────────────────
function DoctorApp() {
  // In-memory only — purposely not persisted. A page reload forces re-auth,
  // which is the correct security behaviour for a clinic's shared device.
  const [doctorToken, setDoctorToken] = useState('');

  // data-side="doctor" → green gradient. Same pattern as PatientApp.
  useEffect(() => {
    document.body.setAttribute('data-side', 'doctor');
    return () => document.body.removeAttribute('data-side');
  }, []);

  return (
    <PhoneWrapper>
      {/*
        The `relative` container is necessary because OTPGate uses
        `absolute inset-0` to cover the full phone screen. Without `relative`
        on the parent, `inset-0` would be relative to the viewport, not the
        phone shell, and the OTP overlay would escape the phone frame on desktop.
      */}
      <div className="relative w-full h-full">
        {/* DashboardPage loads data in the background while OTPGate is visible */}
        <DashboardPage doctorToken={doctorToken} />
        {/* OTPGate unmounts (not hides) once the token is set, releasing its
            socket connection and freeing its memory. */}
        {!doctorToken && (
          <OTPGate onVerified={setDoctorToken} />
        )}
      </div>
    </PhoneWrapper>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<PatientApp />} />
      <Route path="/doctor" element={<DoctorApp />} />
      <Route path="/doctor/*" element={<DoctorApp />} />
    </Routes>
  );
}
