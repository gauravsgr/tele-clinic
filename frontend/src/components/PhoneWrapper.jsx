/**
 * PhoneWrapper — Responsive iPhone-style shell for desktop preview.
 *
 * On mobile (≤480 px wide): renders children directly, no shell.
 *   The page fills the screen naturally; the body gradient acts as the background.
 *
 * On desktop/tablet (> 480 px): renders a matte-black iPhone mockup (393 × 812 px)
 *   centred in the viewport. The shell includes:
 *     - Outer body with rounded corners and side buttons (decorative)
 *     - Dynamic island notch (centered at top)
 *     - 393 × 812 px screen area (all content is clipped to this)
 *
 * Dimensions are taken verbatim from the HTML prototypes (index.html /
 * doctor.html) which were designed for iPhone 15 Pro dimensions.
 *
 * Why useEffect + window.addEventListener instead of CSS media query?
 *   The phone shell is a structural React wrapper, not just a visual change.
 *   On mobile we want no extra DOM nodes at all (lighter tree, no stacking
 *   context issues). CSS alone can't conditionally omit the parent divs.
 *   The resize listener keeps isMobile in sync when the window is resized.
 */
import { useEffect, useState } from 'react';

export default function PhoneWrapper({ children }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 480);
    check(); // run once synchronously to avoid a flash of the wrong layout
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Mobile: no shell — children fill the viewport directly.
  if (isMobile) {
    return <>{children}</>;
  }

  // Desktop: full iPhone shell.
  return (
    <div className="flex items-start justify-center min-h-screen pt-8">
      {/* .phone-wrap applies the drop-shadow "floating phone" filter (see index.css).
          The @media (max-height) rules in index.css scale it down on short screens. */}
      <div className="phone-wrap">
        {/* Matte black phone body — 415px wide to account for 11px padding on each side */}
        <div
          className="relative bg-[#1a1a1a] rounded-[55px] p-[11px]"
          style={{ width: '415px' }}
        >
          {/* Decorative side buttons — left side: mute + volume up + volume down */}
          <div className="absolute -left-[3px] top-[116px] w-[3px] h-[34px] bg-[#2d2d2d] rounded-l-[2px]" />
          <div className="absolute -left-[3px] top-[164px] w-[3px] h-[64px] bg-[#2d2d2d] rounded-l-[2px]" />
          <div className="absolute -left-[3px] top-[242px] w-[3px] h-[64px] bg-[#2d2d2d] rounded-l-[2px]" />
          {/* Right side: power button */}
          <div className="absolute -right-[3px] top-[180px] w-[3px] h-[80px] bg-[#2d2d2d] rounded-r-[2px]" />

          {/* Screen area — all app content renders inside this clipping container */}
          <div
            className="relative bg-white rounded-[42px] overflow-hidden"
            style={{ width: '393px', height: '812px' }}
          >
            {/* Dynamic island — sits above the status bar (z-50 so it's always on top) */}
            <div className="absolute top-[12px] left-1/2 -translate-x-1/2 w-[120px] h-[34px] bg-black rounded-full z-50" />
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
