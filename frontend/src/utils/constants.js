// Slot / booking rules — these values are non-negotiable business rules
export const SLOT_DURATION = 15;          // minutes; never patient-configurable
export const BOOKING_WINDOW_DAYS = 28;    // max days ahead a patient can book
export const CUTOFF_MIN = 60;             // cannot book within this many minutes of slot start

// Accent colours (kept here so components don't hard-code hex values)
export const ACCENT_PATIENT = '#2563eb';
export const ACCENT_DOCTOR  = '#22c55e';

// Session constants
export const SESSION_KEY              = 'tele_session';
export const SESSION_INACTIVITY_MS    = 10 * 60 * 1000;   // 10 minutes

// IST offset
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;       // UTC+5:30
