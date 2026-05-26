/**
 * SetupPage — WhatsApp pairing code display + Google OAuth connector.
 *
 * Accessible via the "WhatsApp & Google Setup" button on DashboardPage.
 * This is a full sub-page (not a sheet), rendered inside DashboardPage's
 * router when page === 'setup'.
 *
 * WhatsApp pairing flow (real mode):
 *   1. Component mounts → connects to whatsapp-worker via Socket.io.
 *   2. Worker emits `pairing_code` → display the 8-char code in large monospace text.
 *      Doctor types this code into WhatsApp → Linked Devices → Link a Device.
 *   3. Worker emits `auth_ready` → green "WhatsApp Connected" banner → auto-dismisses after 4s.
 *   4. If WhatsApp session drops later → `auth_disconnected` → persistent amber banner.
 *
 * WhatsApp pairing (mock mode, default dev setup):
 *   The worker emits 'ABCD-1234' after 1s and 'auth_ready' after 4s automatically.
 *   No real WhatsApp account is needed.
 *
 * Google OAuth flow:
 *   1. Doctor clicks "Connect Google Contacts" → initiateGoogleAuth → { auth_url }.
 *   2. Browser redirects to auth_url (Google's OAuth consent page).
 *   3. After consent, Google redirects to FastAPI /oauth2callback.
 *   4. FastAPI stores the refresh token and redirects to /doctor?google=connected.
 *   5. This component detects `?google=connected` in the URL params on mount.
 *
 * Socket.io connection:
 *   - Connects on mount, disconnects on unmount (cleanup function in useEffect).
 *   - The `bannerTimerRef` tracks the 4-second auth_ready auto-dismiss timeout
 *     so it can be cleared if the component unmounts before the 4s elapse.
 *   - transports: ['websocket'] skips the HTTP long-polling fallback, which is
 *     unnecessary for a localhost connection.
 */
import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { getGoogleStatus, initiateGoogleAuth } from '../api/setup.js';

export default function SetupPage({ doctorToken }) {
  const [pairingCode, setPairingCode] = useState('');
  // 'connecting' | 'pairing' | 'ready' | 'idle' | 'disconnected' | 'error'
  const [status, setStatus] = useState('connecting');
  const [statusMsg, setStatusMsg] = useState('');
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEmail, setGoogleEmail] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const socketRef    = useRef(null);
  const bannerTimerRef = useRef(null); // holds the auth_ready auto-dismiss timeout

  // Check ?google=connected param — set by the backend OAuth callback redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') {
      setGoogleConnected(true);
    }
  }, []);

  // Fetch current Google OAuth status from the backend (in case already connected).
  useEffect(() => {
    if (!doctorToken) return;
    getGoogleStatus(doctorToken)
      .then((data) => {
        setGoogleConnected(data.connected);
        if (data.email) setGoogleEmail(data.email);
      })
      .catch(() => {}); // silently ignore — UI will show "not connected" by default
  }, [doctorToken]);

  // Socket.io connection lifecycle.
  useEffect(() => {
    const socket = io('http://localhost:3001', { transports: ['websocket'] });
    socketRef.current = socket;

    socket.on('pairing_code', (code) => {
      setPairingCode(code);
      setStatus('pairing');
    });

    socket.on('auth_ready', () => {
      setStatus('ready');
      // Auto-dismiss the "WhatsApp Connected" banner after 4 seconds.
      // Clears to 'idle' so the banner disappears but the pairing code remains visible.
      bannerTimerRef.current = setTimeout(() => setStatus('idle'), 4000);
    });

    socket.on('auth_disconnected', () => {
      setStatus('disconnected');
      setStatusMsg('Session lost — re-link required');
    });

    socket.on('auth_error', (msg) => {
      setStatus('error');
      setStatusMsg(msg ?? 'An error occurred.');
    });

    // Connection-level errors — fires when the WhatsApp worker isn't running.
    socket.on('connect_error', () => {
      setStatus('error');
      setStatusMsg('WhatsApp worker not running. Start it with: cd whatsapp-worker && node server.js');
    });

    // Disconnect and clear the timer when navigating away from Setup.
    return () => {
      socket.disconnect();
      clearTimeout(bannerTimerRef.current);
    };
  }, []); // no deps — connect once per mount

  async function handleGoogleConnect() {
    if (!doctorToken || googleLoading) return;
    setGoogleLoading(true);
    try {
      const data = await initiateGoogleAuth(doctorToken);
      // Full-page redirect to the Google OAuth consent screen.
      if (data.auth_url) window.location.href = data.auth_url;
    } catch {
      // Silently fail — the button text reverts; doctor can retry.
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 bg-[#f7f6f4]">
      <h2 className="text-[18px] font-extrabold text-stone-950 tracking-tight mb-1">
        Setup &amp; Configuration
      </h2>
      <p className="text-[12px] text-stone-400 mb-5">Connect WhatsApp and Google services.</p>

      {/* ── WhatsApp Pairing Section ── */}
      <div className="card mb-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-[3px] h-4 rounded-full bg-[#25D366] flex-shrink-0" />
          <p className="text-[11px] font-extrabold text-stone-950 uppercase tracking-[0.08em]">
            WhatsApp Link
          </p>
        </div>

        {/* Status banners — only one is shown at a time based on socket events */}
        {status === 'connecting' && (
          <p className="text-[12px] text-stone-400 mb-3">Connecting to WhatsApp worker…</p>
        )}

        {/* Pairing code: large monospace text so it's easy to read and type */}
        {status === 'pairing' && pairingCode && (
          <div className="mb-3">
            <p className="text-[12px] text-stone-500 mb-2">
              Enter this code in WhatsApp → Linked Devices → Link a Device:
            </p>
            <p
              className="font-mono text-[32px] font-extrabold tracking-[0.3em] text-stone-950 text-center py-4 bg-[#f0fdf4] rounded-xl border border-[#bbf7d0]"
              data-testid="pairing-code"
              aria-label="Pairing code"
            >
              {pairingCode}
            </p>
          </div>
        )}

        {/* auth_ready: auto-dismisses after 4s (see useEffect above) */}
        {status === 'ready' && (
          <div className="flex items-center gap-2 p-3 bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl mb-3">
            <span className="text-[#22c55e] text-[16px]">✓</span>
            <p className="text-[12.5px] font-semibold text-[#15803d]">WhatsApp Connected</p>
          </div>
        )}

        {/* auth_disconnected: persistent — stays until the doctor re-pairs */}
        {status === 'disconnected' && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl mb-3">
            <span className="text-amber-500 text-[16px]">⚠</span>
            <p className="text-[12.5px] font-semibold text-amber-700">{statusMsg}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl mb-3">
            <span className="text-red-500 text-[16px]">✕</span>
            <p className="text-[12.5px] font-semibold text-red-700">{statusMsg}</p>
          </div>
        )}

        <p className="text-[11px] text-stone-400 leading-relaxed">
          WhatsApp must stay connected for appointment OTPs, confirmations, reminders, and consultation notes to reach patients.
        </p>
      </div>

      {/* ── Google Contacts Section ── */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-[3px] h-4 rounded-full bg-blue-500 flex-shrink-0" />
          <p className="text-[11px] font-extrabold text-stone-950 uppercase tracking-[0.08em]">
            Google Contacts
          </p>
        </div>

        {googleConnected ? (
          <div className="flex items-center gap-2 p-3 bg-[#f0fdf4] border border-[#bbf7d0] rounded-xl mb-3">
            <span className="text-[#22c55e] text-[16px]">✓</span>
            <div>
              <p className="text-[12.5px] font-semibold text-[#15803d]">Google Connected</p>
              {googleEmail && <p className="text-[11px] text-stone-400 mt-[1px]">{googleEmail}</p>}
            </div>
          </div>
        ) : (
          <button
            onClick={handleGoogleConnect}
            disabled={googleLoading}
            className="btn-push mb-3 disabled:opacity-60"
          >
            {googleLoading ? 'Redirecting…' : '🔗 Connect Google Contacts'}
          </button>
        )}

        <p className="text-[11px] text-stone-400 leading-relaxed">
          Used to temporarily add patients to your Google Contacts 5 minutes before their appointment, then automatically remove them 30 minutes after it ends.
        </p>
      </div>
    </div>
  );
}
