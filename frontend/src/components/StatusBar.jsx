/**
 * StatusBar — Fixed-time iOS-style status bar at the top of each screen.
 *
 * Props:
 *   side — 'patient' | 'doctor' (default 'patient')
 *          Controls text colour: stone-800 on the warmer doctor screen,
 *          gray-900 on the cooler patient screen.
 *
 * Height: 80px total (52px padding-top to clear the dynamic island notch + 28px content).
 * The 52px top padding aligns the content below the 34px island + ~18px gap.
 *
 * The clock shows "9:41" — Apple's traditional demo time, used here because
 * this is a design prototype with a static phone shell. A real production app
 * would read from `new Date()` but that would cause hydration mismatches and
 * unnecessary re-renders in the phone mockup context.
 *
 * SVG icons are inlined (no icon library dependency) and match the shapes
 * used in the HTML prototypes exactly.
 */
export default function StatusBar({ side = 'patient' }) {
  // Doctor screen uses warmer text (stone-800) against the off-white #f7f6f4 bg.
  // Patient screen uses slightly darker gray-900 against the white card bg.
  const textColor = side === 'doctor' ? 'text-stone-800' : 'text-gray-900';

  return (
    <div className={`flex items-center justify-between px-6 pt-[52px] pb-2 h-[80px] flex-shrink-0 ${textColor}`}>
      {/* Static demo time — see module docstring for rationale */}
      <span className="text-[15px] font-semibold tracking-tight">9:41</span>

      {/* Status icons — signal bars, wifi, battery */}
      <div className="flex items-center gap-[6px]">
        {/* Cellular signal — 4 bars with increasing opacity */}
        <svg width="17" height="12" viewBox="0 0 17 12" fill="currentColor">
          <rect x="0"    y="6" width="3" height="6"  rx="1" opacity="0.4" />
          <rect x="4.5"  y="4" width="3" height="8"  rx="1" opacity="0.6" />
          <rect x="9"    y="2" width="3" height="10" rx="1" opacity="0.8" />
          <rect x="13.5" y="0" width="3" height="12" rx="1" />
        </svg>

        {/* Wi-Fi arcs */}
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M1 4.5C3.5 2 12.5 2 15 4.5"    opacity="0.4" />
          <path d="M3.5 7C5.2 5.3 10.8 5.3 12.5 7" opacity="0.7" />
          <path d="M6 9.5C7 8.5 9 8.5 10 9.5" />
          <circle cx="8" cy="11.5" r="0.7" fill="currentColor" stroke="none" />
        </svg>

        {/* Battery — outer rectangle + fill bar + terminal nub */}
        <div className="flex items-center gap-[1px]">
          <div className="relative w-[25px] h-[12px] border border-current rounded-[3px] opacity-80">
            {/* Fill bar: right: 2px leaves room for the terminal nub illusion */}
            <div className="absolute inset-[1.5px] bg-current rounded-[1.5px]" style={{ right: '2px' }} />
          </div>
          {/* Terminal nub */}
          <div className="w-[2px] h-[5px] bg-current rounded-r-[1px] opacity-60" />
        </div>
      </div>
    </div>
  );
}
