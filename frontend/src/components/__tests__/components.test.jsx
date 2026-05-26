/**
 * Shared component tests — Vitest + React Testing Library
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OTPInput from '../OTPInput.jsx';
import PhoneInput from '../PhoneInput.jsx';
import BottomSheet from '../BottomSheet.jsx';
import CountdownTimer from '../CountdownTimer.jsx';
import Toast from '../Toast.jsx';
import ProgressBar from '../ProgressBar.jsx';

// ════════════════════════════════════════════════════════════════════════════
// OTPInput
// ════════════════════════════════════════════════════════════════════════════

describe('OTPInput', () => {
  it('renders 4 input boxes', () => {
    render(<OTPInput value="" onChange={() => {}} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
  });

  it('each box has the correct aria-label', () => {
    render(<OTPInput value="" onChange={() => {}} />);
    expect(screen.getByLabelText('OTP digit 1')).toBeInTheDocument();
    expect(screen.getByLabelText('OTP digit 4')).toBeInTheDocument();
  });

  it('ignores non-digit input', async () => {
    const onChange = vi.fn();
    render(<OTPInput value="" onChange={onChange} />);
    const box1 = screen.getByLabelText('OTP digit 1');
    // Simulate typing a letter — onInput fires with non-digit
    fireEvent.input(box1, { target: { value: 'a' } });
    // onChange should not be called with non-digit data
    // (the handler strips non-digits and returns early)
    expect(onChange).not.toHaveBeenCalled();
  });

  it('calls onChange with updated string on digit input', () => {
    const onChange = vi.fn();
    render(<OTPInput value="" onChange={onChange} />);
    const box1 = screen.getByLabelText('OTP digit 1');
    fireEvent.input(box1, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith('5');
  });

  it('reflects value prop in boxes', () => {
    render(<OTPInput value="12" onChange={() => {}} />);
    const box1 = screen.getByLabelText('OTP digit 1');
    const box2 = screen.getByLabelText('OTP digit 2');
    const box3 = screen.getByLabelText('OTP digit 3');
    expect(box1.value).toBe('1');
    expect(box2.value).toBe('2');
    expect(box3.value).toBe('');
  });

  it('clears current box on Backspace', () => {
    const onChange = vi.fn();
    render(<OTPInput value="12" onChange={onChange} />);
    const box2 = screen.getByLabelText('OTP digit 2');
    fireEvent.keyDown(box2, { key: 'Backspace' });
    // Should clear index 1 → result is '1'
    expect(onChange).toHaveBeenCalledWith('1');
  });

  it('handles paste of 4 digits', () => {
    const onChange = vi.fn();
    render(<OTPInput value="" onChange={onChange} />);
    const box1 = screen.getByLabelText('OTP digit 1');
    fireEvent.paste(box1, {
      clipboardData: { getData: () => '1234' },
    });
    expect(onChange).toHaveBeenCalledWith('1234');
  });

  it('strips non-digits from paste', () => {
    const onChange = vi.fn();
    render(<OTPInput value="" onChange={onChange} />);
    const box1 = screen.getByLabelText('OTP digit 1');
    fireEvent.paste(box1, {
      clipboardData: { getData: () => '12-34' },
    });
    expect(onChange).toHaveBeenCalledWith('1234');
  });

  it('is disabled when disabled prop is true', () => {
    render(<OTPInput value="" onChange={() => {}} disabled />);
    const inputs = screen.getAllByRole('textbox');
    inputs.forEach((input) => expect(input).toBeDisabled());
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PhoneInput
// ════════════════════════════════════════════════════════════════════════════

describe('PhoneInput', () => {
  it('renders the +91 country code', () => {
    render(<PhoneInput value="" onChange={() => {}} />);
    expect(screen.getByText('+91')).toBeInTheDocument();
  });

  it('calls onChange with only digits', () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'abc123' } });
    expect(onChange).toHaveBeenCalledWith('123');
  });

  it('caps input at 10 digits', () => {
    const onChange = vi.fn();
    render(<PhoneInput value="" onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '12345678901' } }); // 11 digits
    expect(onChange).toHaveBeenCalledWith('1234567890');
  });

  it('reflects value prop', () => {
    render(<PhoneInput value="9876543210" onChange={() => {}} />);
    const input = screen.getByRole('textbox');
    expect(input.value).toBe('9876543210');
  });

  it('is disabled when disabled prop is true', () => {
    render(<PhoneInput value="" onChange={() => {}} disabled />);
    const input = screen.getByRole('textbox');
    expect(input).toBeDisabled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// BottomSheet
// ════════════════════════════════════════════════════════════════════════════

describe('BottomSheet', () => {
  it('renders children when open', () => {
    render(
      <BottomSheet open onClose={() => {}}>
        <p>Sheet content</p>
      </BottomSheet>
    );
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
  });

  it('panel is translated when closed (not visible to user)', () => {
    render(
      <BottomSheet open={false} onClose={() => {}}>
        <p>Hidden</p>
      </BottomSheet>
    );
    // Content is in DOM but panel is translated out of view
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.transform).toBe('translateY(100%)');
  });

  it('panel is not translated when open', () => {
    render(
      <BottomSheet open onClose={() => {}}>
        <p>Visible</p>
      </BottomSheet>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.transform).toBe('translateY(0)');
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose}>
        <p>Content</p>
      </BottomSheet>
    );
    const backdrop = screen.getByRole('dialog').previousSibling;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// CountdownTimer
// ════════════════════════════════════════════════════════════════════════════

describe('CountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('displays MM:SS format for ≥60s', () => {
    render(<CountdownTimer seconds={90} onExpire={() => {}} />);
    expect(screen.getByTestId('countdown').textContent).toBe('1:30');
  });

  it('displays Xs format for <60s', () => {
    render(<CountdownTimer seconds={42} onExpire={() => {}} />);
    expect(screen.getByTestId('countdown').textContent).toBe('42s');
  });

  it('counts down by 1 each second', () => {
    render(<CountdownTimer seconds={5} onExpire={() => {}} />);
    expect(screen.getByTestId('countdown').textContent).toBe('5s');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('countdown').textContent).toBe('4s');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('countdown').textContent).toBe('3s');
  });

  it('calls onExpire when counter reaches 0', () => {
    const onExpire = vi.fn();
    render(<CountdownTimer seconds={2} onExpire={onExpire} />);
    // Advance one second at a time so state updates flush between ticks
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onExpire).toHaveBeenCalled();
  });

  it('resets when seconds prop changes', () => {
    const { rerender } = render(<CountdownTimer seconds={10} onExpire={() => {}} />);
    // Advance 3 seconds one tick at a time
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId('countdown').textContent).toBe('7s');
    rerender(<CountdownTimer seconds={59} onExpire={() => {}} />);
    expect(screen.getByTestId('countdown').textContent).toBe('59s');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Toast
// ════════════════════════════════════════════════════════════════════════════

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('shows message when visible', () => {
    render(<Toast message="Booking confirmed!" visible onDismiss={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Booking confirmed!');
  });

  it('is hidden (not interactive) when not visible', () => {
    render(<Toast message="Hidden" visible={false} onDismiss={() => {}} />);
    const alert = screen.getByRole('alert');
    expect(alert.className).toMatch(/pointer-events-none/);
  });

  it('calls onDismiss after 3 seconds when visible', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Test" visible onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onDismiss).toHaveBeenCalled();
  });

  it('uses error styling for variant=error', () => {
    render(<Toast message="Error!" variant="error" visible onDismiss={() => {}} />);
    expect(screen.getByRole('alert').className).toMatch(/red/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ProgressBar
// ════════════════════════════════════════════════════════════════════════════

describe('ProgressBar', () => {
  it('renders with correct aria attributes', () => {
    render(<ProgressBar percent={60} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '60');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps to 0 for negative percent', () => {
    render(<ProgressBar percent={-10} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.style.width).toBe('0%');
  });

  it('clamps to 100 for percent >100', () => {
    render(<ProgressBar percent={150} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.style.width).toBe('100%');
  });

  it('sets correct width style', () => {
    render(<ProgressBar percent={75} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.style.width).toBe('75%');
  });
});
