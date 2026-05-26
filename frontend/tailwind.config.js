/**
 * tailwind.config.js — Design system tokens for TeleClinic.
 *
 * Design source: index.html (patient) and doctor.html (doctor) in the repo root.
 * Those files are the canonical UX reference; all colour values, radii, and
 * animations below are extracted verbatim from their inline styles.
 *
 * Colour naming convention:
 *   p-*  → patient side (blue accent, used in booking flow)
 *   d-*  → doctor side (green accent, used in dashboard)
 *   wa-* → WhatsApp brand colour (#25D366)
 *
 * Why custom border-radius tokens?
 *   Tailwind ships with rounded-xl (12px) and rounded-2xl (16px) but not the
 *   42px (phone screen inner) or 55px (phone body outer) values from the HTML
 *   prototype. Rather than sprinkling arbitrary [42px] throughout components,
 *   the named tokens (5xl, 7xl) keep components readable.
 *
 * Animation inventory (all extracted from the HTML prototypes):
 *   pulse-glow  — green shadow pulse on the ACTIVE NOW appointment slot
 *   dot-pulse   — live indicator dot scale animation
 *   shimmer     — moving gradient on the session progress bar
 *   draw-check  — SVG stroke animation for the booking success checkmark
 *   pop-circle  — scale-in of the green success circle (uses spring easing)
 *   fade-up-1/2/3/4 — staggered element entrance on the success screen
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  // Only generate CSS for classes that are actually used — keeps the bundle small.
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],

  theme: {
    extend: {
      // DM Sans is loaded via <link> in index.html (Google Fonts).
      // Declaring it here makes `font-sans` resolve to DM Sans instead of the
      // Tailwind default (Inter / system-ui).
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },

      colors: {
        // ── Patient (blue) side ───────────────────────────────────────────────
        'p-accent':       '#2563eb',   // primary CTA, selected slots, progress rings
        'p-accent-light': '#eff6ff',   // tinted backgrounds (sheet headers, etc.)

        // ── Doctor (green) side ───────────────────────────────────────────────
        'd-accent':       '#22c55e',   // primary CTA, active slot border
        'd-accent-dk':    '#16a34a',   // dark variant for progress bars, icons
        'd-accent-dkr':   '#15803d',   // darker still for text on light green bg
        'd-accent-light': '#f0fdf4',   // tinted card backgrounds

        // ── Shared warm neutrals (from doctor.html body/card colour palette) ─
        'stone-950':      '#1c1917',   // primary text + dark buttons
        'warm-bg':        '#f7f6f4',   // doctor screen background (not pure white)
        'warm-border':    '#f0ede9',   // card dividers

        // ── WhatsApp brand ────────────────────────────────────────────────────
        'wa-green':       '#25D366',   // call button, badge backgrounds
      },

      borderRadius: {
        '4xl': '2rem',        // 32px — bottom sheet panel top corners
        '5xl': '2.625rem',    // 42px — phone screen inner radius (from HTML prototype)
        '7xl': '3.4375rem',   // 55px — phone body outer radius (from HTML prototype)
      },

      // Hard-coded phone mockup dimensions from the HTML prototypes.
      // Used by PhoneWrapper on desktop (≥480px viewport).
      width:     { '393': '393px' },
      height:    { '812': '812px' },
      maxHeight: { '350': '350px' },

      // ── Animations ────────────────────────────────────────────────────────
      // Each animation is a CSS class (e.g. `animate-pulse-glow`) that
      // references a keyframes block defined below.
      animation: {
        // Doctor dashboard — active appointment slot
        'pulse-glow': 'pulse-glow 2.2s ease-in-out infinite',
        // Live dot inside the active slot header
        'dot-pulse':  'dot-pulse 1.8s ease-in-out infinite',
        // Session progress bar shimmer sweep
        'shimmer':    'shimmer 2.5s linear infinite',
        // Booking success screen — animated checkmark path
        'draw-check': 'draw-check 0.45s 0.3s ease forwards',
        // Booking success screen — green circle pop-in
        'pop-circle': 'pop-circle 0.5s cubic-bezier(.34,1.56,.64,1) forwards',
        // Booking success screen — staggered card rows (4 tiers of delay)
        'fade-up-1':  'fade-up 0.4s 0.55s ease both',
        'fade-up-2':  'fade-up 0.4s 0.70s ease both',
        'fade-up-3':  'fade-up 0.4s 0.85s ease both',
        'fade-up-4':  'fade-up 0.4s 1.00s ease both',
      },

      keyframes: {
        // Green box-shadow pulse: ambient glow oscillates between 28% and 40% opacity.
        'pulse-glow': {
          '0%,100%': {
            boxShadow: '0 16px 40px -8px rgba(16,185,129,.28), 0 4px 12px rgba(16,185,129,.14), 0 0 0 0 rgba(34,197,94,.20)',
          },
          '50%': {
            boxShadow: '0 22px 52px -8px rgba(16,185,129,.40), 0 4px 12px rgba(16,185,129,.18), 0 0 0 5px rgba(34,197,94,.08)',
          },
        },
        // Simple scale pulse for the live indicator dot.
        'dot-pulse': {
          '0%,100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.45)' },
        },
        // Background-position sweep: the gradient moves left-to-right to create
        // the moving shimmer effect. background-size:200% set in .shimmer-fill.
        'shimmer': {
          '0%':   { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition:  '200% center' },
        },
        // SVG stroke-dashoffset animation: path is hidden at offset=80 and fully
        // drawn at offset=0. The SVG must set strokeDasharray="80".
        'draw-check': {
          from: { strokeDashoffset: '80' },
          to:   { strokeDashoffset: '0' },
        },
        // Spring-like scale from 0.6 → slight overshoot (1.08) → settle at 1.
        // cubic-bezier(.34,1.56,.64,1) is the standard iOS spring curve.
        'pop-circle': {
          '0%':   { transform: 'scale(0.6)', opacity: '0' },
          '60%':  { transform: 'scale(1.08)' },
          '100%': { transform: 'scale(1)',   opacity: '1' },
        },
        // Translate + fade in from 14px below; 'both' fill-mode keeps elements
        // invisible before their delay fires.
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },

  plugins: [],
};
