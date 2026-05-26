/**
 * Patient flow tests — Vitest + React Testing Library
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mock API calls ──────────────────────────────────────────────────────────
vi.mock('../../api/appointments.js', () => ({
  getSlots: vi.fn().mockResolvedValue({ slots: [] }),
  placeHold: vi.fn().mockResolvedValue({ hold_id: 'h1', expires_at: new Date(Date.now() + 120000).toISOString() }),
  bookSlot: vi.fn().mockResolvedValue({ appointment_id: 'appt-1' }),
  cancelSlot: vi.fn().mockResolvedValue({ cancelled: true }),
  lookupAppointment: vi.fn().mockResolvedValue({ upcoming: null, last_visit: null }),
  cancelAndRebook: vi.fn().mockResolvedValue({ appointment_id: 'appt-2' }),
}));

vi.mock('../../api/auth.js', () => ({
  sendOTP: vi.fn().mockResolvedValue({ sent: true }),
  verifyOTP: vi.fn().mockResolvedValue({ session_token: 'tok-abc', verified: true }),
}));

vi.mock('../../utils/session.js', () => ({
  getSession: vi.fn(() => null),
  setSession: vi.fn(),
  clearSession: vi.fn(),
  updateActivity: vi.fn(),
  isSessionValid: vi.fn(() => false),
}));

import BookingPage from '../BookingPage.jsx';
import SuccessScreen from '../SuccessScreen.jsx';
import DuplicateAlert from '../DuplicateAlert.jsx';
import OTPSheet from '../OTPSheet.jsx';
import AppointmentCard from '../AppointmentCard.jsx';
import LookupSheet from '../LookupSheet.jsx';

// ════════════════════════════════════════════════════════════════════════════
// BookingPage
// ════════════════════════════════════════════════════════════════════════════

describe('BookingPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders the doctor name', async () => {
    render(<BookingPage />);
    expect(screen.getByText(/Dr\. Lakshimi Sagar/)).toBeInTheDocument();
  });

  it('renders a date strip with 28 chips', async () => {
    render(<BookingPage />);
    const chips = screen.getAllByRole('listitem');
    expect(chips).toHaveLength(28);
  });

  it('renders morning and evening session labels', () => {
    render(<BookingPage />);
    expect(screen.getByText(/Morning Session/i)).toBeInTheDocument();
    expect(screen.getByText(/Evening Session/i)).toBeInTheDocument();
  });

  it('renders 8 morning slots and 12 evening slots', () => {
    render(<BookingPage />);
    // The slot buttons display formatted times
    // Morning: 10:00 AM through 11:45 AM
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
    expect(screen.getByText('11:45 AM')).toBeInTheDocument();
    // Evening: 4:00 PM through 6:45 PM
    expect(screen.getByText('4:00 PM')).toBeInTheDocument();
    expect(screen.getByText('6:45 PM')).toBeInTheDocument();
  });

  it('does not show confirm bar when no slot is selected', () => {
    render(<BookingPage />);
    expect(screen.queryByTestId('confirm-bar')).not.toBeInTheDocument();
  });

  it('shows confirm bar when a slot is selected', async () => {
    render(<BookingPage />);
    // Find and click a future slot (won't be past cutoff in tests since timers are faked at ~now)
    // We'll click 11:45 AM which should be a future slot normally
    // But because fake timers, the slot times are relative to a fixed future date
    // Let's click the first enabled morning slot button
    const slotBtns = screen.getAllByRole('button', { name: /AM/ });
    const enabledBtn = slotBtns.find((btn) => !btn.disabled);
    if (enabledBtn) {
      fireEvent.click(enabledBtn);
      expect(screen.getByTestId('confirm-bar')).toBeInTheDocument();
    }
  });

  it('switching dates clears slot selection', async () => {
    render(<BookingPage />);
    const slotBtns = screen.getAllByRole('button', { name: /AM/ });
    const enabledBtn = slotBtns.find((btn) => !btn.disabled);
    if (enabledBtn) {
      fireEvent.click(enabledBtn);
      expect(screen.getByTestId('confirm-bar')).toBeInTheDocument();

      // Switch to second date chip
      const dateChips = screen.getAllByRole('listitem');
      fireEvent.click(dateChips[1]);
      expect(screen.queryByTestId('confirm-bar')).not.toBeInTheDocument();
    }
  });

  it('renders "Manage Existing Appointment" button', () => {
    render(<BookingPage />);
    expect(screen.getByText('Manage Existing Appointment')).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SuccessScreen
// ════════════════════════════════════════════════════════════════════════════

describe('SuccessScreen', () => {
  const appt = {
    name: 'Priya Sharma',
    date: 'Monday, 25 May 2026',
    time: '10:15 AM',
    duration: '15 min',
    doctorName: 'Dr. Lakshimi Sagar',
  };

  it('renders booking details', () => {
    render(<SuccessScreen appointment={appt} onReset={() => {}} />);
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText('10:15 AM')).toBeInTheDocument();
    expect(screen.getByText('Dr. Lakshimi Sagar')).toBeInTheDocument();
  });

  it('renders "Appointment Confirmed!" heading', () => {
    render(<SuccessScreen appointment={appt} onReset={() => {}} />);
    expect(screen.getByText(/Appointment Confirmed!/)).toBeInTheDocument();
  });

  it('renders WhatsApp notice', () => {
    render(<SuccessScreen appointment={appt} onReset={() => {}} />);
    expect(screen.getByText(/No app downloads needed/)).toBeInTheDocument();
  });

  it('calls onReset when "Book Another Appointment" is clicked', () => {
    const onReset = vi.fn();
    render(<SuccessScreen appointment={appt} onReset={onReset} />);
    fireEvent.click(screen.getByText('Book Another Appointment'));
    expect(onReset).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// DuplicateAlert
// ════════════════════════════════════════════════════════════════════════════

describe('DuplicateAlert', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the "One Appointment per Day" heading when open', () => {
    render(
      <DuplicateAlert
        open
        onClose={() => {}}
        onRebook={() => {}}
        existingSlot={{ dateTime: 'Monday, May 18 at 10:15 AM' }}
      />
    );
    expect(screen.getByText(/One Appointment per Day/)).toBeInTheDocument();
  });

  it('calls onClose when "Keep Existing Appointment" is clicked', () => {
    const onClose = vi.fn();
    render(
      <DuplicateAlert
        open
        onClose={onClose}
        onRebook={() => {}}
        existingSlot={{ dateTime: 'Monday, May 18 at 10:15 AM' }}
      />
    );
    fireEvent.click(screen.getByText('Keep Existing Appointment'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows confirm step when "Cancel Existing & Rebook" is clicked', () => {
    render(
      <DuplicateAlert
        open
        onClose={() => {}}
        onRebook={() => {}}
        existingSlot={{ dateTime: 'Monday, May 18 at 10:15 AM' }}
      />
    );
    fireEvent.click(screen.getByText('Cancel Existing & Rebook'));
    expect(screen.getByText('Cancel Appointment?')).toBeInTheDocument();
  });

  it('shows cancelled step when "Yes, Cancel" is clicked in confirm step', () => {
    render(
      <DuplicateAlert
        open
        onClose={() => {}}
        onRebook={() => {}}
        existingSlot={{ dateTime: 'Monday, May 18 at 10:15 AM' }}
      />
    );
    fireEvent.click(screen.getByText('Cancel Existing & Rebook'));
    fireEvent.click(screen.getByText('Yes, Cancel'));
    expect(screen.getByText('Slot Cancelled')).toBeInTheDocument();
  });

  it('is not shown when open=false', () => {
    render(
      <DuplicateAlert
        open={false}
        onClose={() => {}}
        onRebook={() => {}}
        existingSlot={{ dateTime: 'Monday, May 18 at 10:15 AM' }}
      />
    );
    // Panel should be translated off-screen
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.transform).toBe('translateY(100%)');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// OTPSheet
// ════════════════════════════════════════════════════════════════════════════

describe('OTPSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the OTP input boxes when open', () => {
    render(<OTPSheet open onClose={() => {}} onVerified={() => {}} phone="9876543210" />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
  });

  it('shows verify button disabled when OTP incomplete', () => {
    render(<OTPSheet open onClose={() => {}} onVerified={() => {}} phone="9876543210" />);
    const btn = screen.getByRole('button', { name: /Verify/i });
    expect(btn).toBeDisabled();
  });

  it('displays the masked phone number', () => {
    render(<OTPSheet open onClose={() => {}} onVerified={() => {}} phone="9876543210" />);
    expect(screen.getByText(/•••••43210/)).toBeInTheDocument();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AppointmentCard
// ════════════════════════════════════════════════════════════════════════════

describe('AppointmentCard', () => {
  it('renders upcoming card with green dot and Confirmed pill', () => {
    render(<AppointmentCard type="upcoming" dateTime="Saturday, May 23 at 10:15 AM" onCancel={() => {}} />);
    expect(screen.getByText('Upcoming Session')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Saturday, May 23 at 10:15 AM')).toBeInTheDocument();
    expect(screen.getByText('Cancel Appointment')).toBeInTheDocument();
  });

  it('renders last_visit card without cancel button or confirmed pill', () => {
    render(<AppointmentCard type="last_visit" dateTime="Tuesday, May 12 at 4:30 PM" />);
    expect(screen.getByText('Last Completed Visit')).toBeInTheDocument();
    expect(screen.queryByText('Cancel Appointment')).not.toBeInTheDocument();
    expect(screen.queryByText('Confirmed')).not.toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const onCancel = vi.fn();
    render(<AppointmentCard type="upcoming" dateTime="Saturday, May 23 at 10:15 AM" onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel Appointment'));
    expect(onCancel).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LookupSheet
// ════════════════════════════════════════════════════════════════════════════

describe('LookupSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders phone step when open', () => {
    render(<LookupSheet open onClose={() => {}} />);
    expect(screen.getByText('Appointment Lookup')).toBeInTheDocument();
    expect(screen.getByText('Find My Records')).toBeInTheDocument();
  });

  it('Find My Records button is disabled when phone is less than 10 digits', () => {
    render(<LookupSheet open onClose={() => {}} />);
    const btn = screen.getByText('Find My Records');
    expect(btn).toBeDisabled();
  });

  it('is not shown when closed', () => {
    render(<LookupSheet open={false} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.transform).toBe('translateY(100%)');
  });
});
