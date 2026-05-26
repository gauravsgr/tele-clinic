/**
 * BottomSheet — Slide-up overlay panel (the "modal sheet" pattern on iOS).
 *
 * Props:
 *   open      — boolean controls visibility and slide position
 *   onClose   — called when the backdrop is tapped (not the panel itself)
 *   children  — sheet content
 *   maxHeight — CSS string, e.g. '85%' (default). Override for taller sheets
 *               like LookupSheet which uses '88%'.
 *
 * Animation strategy:
 *   The backdrop and panel are always in the DOM; visibility is toggled purely
 *   via CSS (opacity + pointer-events for the backdrop, translateY for the panel).
 *   This avoids React mount/unmount flickering and ensures Tailwind's
 *   transition-transform class has a stable element to animate.
 *
 *   Keeping sheets mounted also preserves form state across open/close cycles —
 *   the parent explicitly resets field state in useEffect when `open` changes.
 *
 * Accessibility:
 *   role="dialog" + aria-modal="true" tells screen readers to trap focus inside.
 *   The backdrop has aria-hidden="true" so assistive technology ignores it.
 */
export default function BottomSheet({ open, onClose, children, maxHeight = '85%' }) {
  return (
    <>
      {/* Semi-transparent backdrop — clicking it closes the sheet.
          pointer-events:none when closed prevents accidental taps on content
          beneath the invisible overlay. */}
      <div
        onClick={onClose}
        className={`absolute inset-0 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        style={{ background: 'rgba(0,0,0,0.45)' }}
        aria-hidden="true"
      />

      {/* Panel — anchored to the bottom edge, slides up into view.
          overflow-hidden clips child content at the rounded top corners. */}
      <div
        role="dialog"
        aria-modal="true"
        className="absolute bottom-0 left-0 right-0 z-50 bg-white rounded-t-[28px] transition-transform duration-300 ease-out overflow-hidden flex flex-col"
        style={{
          maxHeight,
          // Fully off-screen when closed; translate-y(0) reveals the sheet.
          transform: open ? 'translateY(0)' : 'translateY(100%)',
        }}
      >
        {/* Drag handle — visual affordance for "swipeable" sheet (not wired to
            gesture events; close is triggered by the backdrop tap only). */}
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-[4px] bg-gray-200 rounded-full" />
        </div>

        {children}
      </div>
    </>
  );
}
