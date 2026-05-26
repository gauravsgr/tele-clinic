/**
 * Doctor flow tests — Vitest + React Testing Library
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ── Mock Socket.io ─────────────────────────────────────────────────────────
const mockSocket = {
  on: vi.fn(),
  off: vi.fn(),
  disconnect: vi.fn(),
  emit: vi.fn(),
};
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

// ── Mock API calls ──────────────────────────────────────────────────────────
vi.mock('../../api/auth.js', () => ({
  sendOTP: vi.fn().mockResolvedValue({ sent: true }),
  verifyOTP: vi.fn().mockResolvedValue({ session_token: 'doc-tok-abc', verified: true }),
}));

vi.mock('../../api/doctor.js', () => ({
  getDoctorSchedule: vi.fn().mockResolvedValue({ appointments: [], server_time: new Date().toISOString() }),
  getDoctorAppointments: vi.fn().mockResolvedValue({ appointments: [] }),
  getDoctorStats: vi.fn().mockResolvedValue({ past: {}, future: {} }),
  cancelDay: vi.fn().mockResolvedValue({}),
  cancelSlots: vi.fn().mockResolvedValue({}),
  sendNotes: vi.fn().mockResolvedValue({ sent: true }),
}));

vi.mock('../../api/schedule.js', () => ({
  getWeeklySchedule: vi.fn().mockResolvedValue({ schedule: { Mon: true, Tue: false } }),
  saveWeeklySchedule: vi.fn().mockResolvedValue({ saved: true }),
}));

vi.mock('../../api/setup.js', () => ({
  getGoogleStatus: vi.fn().mockResolvedValue({ connected: false }),
  initiateGoogleAuth: vi.fn().mockResolvedValue({ auth_url: 'https://google.com/auth' }),
}));

import OTPGate from '../OTPGate.jsx';
import SetupPage from '../SetupPage.jsx';
import AppointmentSlot from '../AppointmentSlot.jsx';
import NotesSheet from '../NotesSheet.jsx';
import DashboardPage from '../DashboardPage.jsx';
import SettingsPanel from '../SettingsPanel/index.jsx';

// ════════════════════════════════════════════════════════════════════════════
// OTPGate
// ════════════════════════════════════════════════════════════════════════════

describe('OTPGate', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the login overlay', () => {
    render(<OTPGate onVerified={() => {}} />);
    expect(screen.getByTestId('otp-gate')).toBeInTheDocument();
  });

  it('renders the greeting text', () => {
    render(<OTPGate onVerified={() => {}} />);
    expect(screen.getByText(/Dr\. Lakshimi Sagar/)).toBeInTheDocument();
  });

  it('renders 4 OTP input boxes', () => {
    render(<OTPGate onVerified={() => {}} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
  });

  it('verify button is disabled when OTP is incomplete', () => {
    render(<OTPGate onVerified={() => {}} />);
    const btn = screen.getByRole('button', { name: /Login to Dashboard/i });
    expect(btn).toBeDisabled();
  });

  it('calls onVerified with session token after successful verify', async () => {
    const onVerified = vi.fn();
    // Wrap render in act so the sendOTP mount effect resolves before we interact
    await act(async () => {
      render(<OTPGate onVerified={onVerified} />);
    });

    // Fill 4 OTP digits
    const inputs = screen.getAllByRole('textbox');
    await act(async () => {
      fireEvent.input(inputs[0], { target: { value: '1' } });
      fireEvent.input(inputs[1], { target: { value: '2' } });
      fireEvent.input(inputs[2], { target: { value: '3' } });
      fireEvent.input(inputs[3], { target: { value: '4' } });
    });

    // Click verify — button should now be enabled (sending=false, otp.length=4)
    const btn = screen.getByRole('button', { name: /Login to Dashboard/i });
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(onVerified).toHaveBeenCalledWith('doc-tok-abc');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SetupPage
// ════════════════════════════════════════════════════════════════════════════

describe('SetupPage', () => {
  beforeEach(() => {
    // Reset socket mock handlers each test
    mockSocket.on.mockClear();
    mockSocket.off.mockClear();
    mockSocket.disconnect.mockClear();
  });

  it('renders the WhatsApp section', () => {
    render(<SetupPage doctorToken="doc-tok" />);
    expect(screen.getByText('WhatsApp Link')).toBeInTheDocument();
  });

  it('renders the Google Contacts section', () => {
    render(<SetupPage doctorToken="doc-tok" />);
    expect(screen.getByText('Google Contacts')).toBeInTheDocument();
  });

  it('shows the pairing code when pairing_code socket event fires', () => {
    render(<SetupPage doctorToken="doc-tok" />);

    // Find the pairing_code handler that was registered
    const handlers = {};
    mockSocket.on.mock.calls.forEach(([event, handler]) => {
      handlers[event] = handler;
    });

    act(() => {
      handlers['pairing_code']?.('ABCD-1234');
    });

    expect(screen.getByTestId('pairing-code')).toHaveTextContent('ABCD-1234');
  });

  it('shows auth_ready banner when auth_ready event fires', () => {
    vi.useFakeTimers();
    render(<SetupPage doctorToken="doc-tok" />);

    const handlers = {};
    mockSocket.on.mock.calls.forEach(([event, handler]) => {
      handlers[event] = handler;
    });

    act(() => {
      handlers['auth_ready']?.();
    });

    expect(screen.getByText('WhatsApp Connected')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows auth_disconnected banner when auth_disconnected event fires', () => {
    render(<SetupPage doctorToken="doc-tok" />);

    const handlers = {};
    mockSocket.on.mock.calls.forEach(([event, handler]) => {
      handlers[event] = handler;
    });

    act(() => {
      handlers['auth_disconnected']?.();
    });

    expect(screen.getByText(/Session lost/)).toBeInTheDocument();
  });

  it('disconnects socket on unmount', () => {
    const { unmount } = render(<SetupPage doctorToken="doc-tok" />);
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AppointmentSlot
// ════════════════════════════════════════════════════════════════════════════

describe('AppointmentSlot', () => {
  const baseAppt = {
    id: 'a1',
    slotTime: '2026-05-25T10:15:00+05:30',
    patientName: 'Priya Mehta',
    phone: '+91 98765 43210',
    reason: 'Follow-up',
  };

  it('renders DONE slot with reduced opacity', () => {
    render(<AppointmentSlot appointment={baseAppt} status="done" />);
    const slot = screen.getByTestId('slot-done');
    expect(slot.style.opacity).toBe('0.56');
  });

  it('renders ACTIVE NOW pill', () => {
    render(<AppointmentSlot appointment={{ ...baseAppt, progressPercent: 60, minsRemaining: 6 }} status="active" />);
    expect(screen.getByText('ACTIVE NOW')).toBeInTheDocument();
  });

  it('renders WhatsApp Call button for active slot', () => {
    render(<AppointmentSlot appointment={{ ...baseAppt, progressPercent: 60, minsRemaining: 6 }} status="active" />);
    expect(screen.getByText('Start WhatsApp Call')).toBeInTheDocument();
  });

  it('renders NEXT UP pill', () => {
    render(<AppointmentSlot appointment={baseAppt} status="next" />);
    expect(screen.getByText('NEXT UP')).toBeInTheDocument();
  });

  it('renders UPCOMING pill', () => {
    render(<AppointmentSlot appointment={baseAppt} status="upcoming" />);
    expect(screen.getByText('UPCOMING')).toBeInTheDocument();
  });

  it('calls onNotes when notes button is clicked on active slot', () => {
    const onNotes = vi.fn();
    render(
      <AppointmentSlot
        appointment={{ ...baseAppt, progressPercent: 60, minsRemaining: 6 }}
        status="active"
        onNotes={onNotes}
      />
    );
    fireEvent.click(screen.getByText(/Consultation Notes/));
    expect(onNotes).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NotesSheet
// ════════════════════════════════════════════════════════════════════════════

describe('NotesSheet', () => {
  const patient = { name: 'Priya Mehta', slotTime: '2026-05-25T10:15:00+05:30' };

  it('renders the textarea when open', () => {
    render(
      <NotesSheet
        open
        onClose={() => {}}
        activePatient={patient}
        appointmentId="a1"
        doctorToken="doc-tok"
      />
    );
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows patient name in header', () => {
    render(
      <NotesSheet
        open
        onClose={() => {}}
        activePatient={patient}
        appointmentId="a1"
        doctorToken="doc-tok"
      />
    );
    expect(screen.getByText('Priya Mehta')).toBeInTheDocument();
  });

  it('send button is disabled when textarea is empty', () => {
    render(
      <NotesSheet
        open
        onClose={() => {}}
        activePatient={patient}
        appointmentId="a1"
        doctorToken="doc-tok"
      />
    );
    const btn = screen.getByRole('button', { name: /Send Notes/i });
    expect(btn).toBeDisabled();
  });

  it('calls sendNotes API and shows confirmation when sent', async () => {
    const { sendNotes } = await import('../../api/doctor.js');
    render(
      <NotesSheet
        open
        onClose={() => {}}
        activePatient={patient}
        appointmentId="a1"
        doctorToken="doc-tok"
      />
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Patient has fever.' } });

    const btn = screen.getByRole('button', { name: /Send Notes/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(sendNotes).toHaveBeenCalledWith('a1', 'Patient has fever.', 'doc-tok');
    });

    await waitFor(() => {
      expect(screen.getByText(/Notes sent via WhatsApp/)).toBeInTheDocument();
    });
  });

  it('is hidden when open=false', () => {
    render(
      <NotesSheet
        open={false}
        onClose={() => {}}
        activePatient={patient}
        appointmentId="a1"
        doctorToken="doc-tok"
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.transform).toBe('translateY(100%)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SettingsPanel
// ════════════════════════════════════════════════════════════════════════════

describe('SettingsPanel', () => {
  it('renders the gear panel when open', () => {
    render(<SettingsPanel open onClose={() => {}} doctorToken="doc-tok" />);
    expect(screen.getByTestId('gear-panel')).toBeInTheDocument();
  });

  it('panel is translated off-screen when closed', () => {
    render(<SettingsPanel open={false} onClose={() => {}} doctorToken="doc-tok" />);
    const panel = screen.getByTestId('gear-panel');
    expect(panel.style.transform).toBe('translateX(100%)');
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(<SettingsPanel open onClose={onClose} doctorToken="doc-tok" />);
    const overlay = screen.getByTestId('gear-panel').previousSibling;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DashboardPage
// ════════════════════════════════════════════════════════════════════════════

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSocket.on.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the doctor greeting', async () => {
    render(<DashboardPage doctorToken="doc-tok" />);
    expect(screen.getByText(/Hello, Dr\. Lakshimi Sagar/)).toBeInTheDocument();
  });

  it('renders the Online badge', () => {
    render(<DashboardPage doctorToken="doc-tok" />);
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('renders the gear button', () => {
    render(<DashboardPage doctorToken="doc-tok" />);
    expect(screen.getByTestId('gear-button')).toBeInTheDocument();
  });

  it('opens gear panel when gear button is clicked', () => {
    render(<DashboardPage doctorToken="doc-tok" />);
    const gearBtn = screen.getByTestId('gear-button');
    fireEvent.click(gearBtn);
    const panel = screen.getByTestId('gear-panel');
    expect(panel.style.transform).toBe('translateX(0)');
  });
});
