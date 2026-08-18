/**
 * A minimal vehicle glyph for the vehicle board's column headers — a single
 * monoline icon in a soft rounded tile, with a number bubble centered
 * directly above it ("Mașina 1", "Mașina 2", …), the way an app icon carries
 * a notification badge. Deliberately plain: this is a label, not an
 * illustration, so it reads instantly at a glance.
 */
export function VehicleIcon({ number, className = "" }: { number: number; className?: string }) {
  return (
    <div className={`flex flex-col items-center ${className}`}>
      <span className="mb-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-bold tabular-nums text-white">
        {number}
      </span>
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-light">
        <svg viewBox="0 0 24 24" className="h-6 w-6 text-accent" fill="none" aria-hidden="true">
          <path
            d="M4 16V9.5a1 1 0 0 1 .55-.9L7 7.3a2 2 0 0 1 .9-.3h6.4a2 2 0 0 1 1.5.68L18.5 10.7a1 1 0 0 0 .75.3H20a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1h-1"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M4 16h1M14 17H10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="17" r="1.8" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="17" cy="17" r="1.8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </span>
    </div>
  );
}
