/**
 * Small monoline glyphs for the Sumar KPI tiles — same style as
 * TyreIcon/VehicleIcon (single stroke, no fill), just enough to give each
 * number a recognizable shape at a glance.
 */

export function OrdersIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function PickupIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M4 15V8.5a1 1 0 0 1 .55-.9L7 6.3a2 2 0 0 1 .9-.3h6.4a2 2 0 0 1 1.5.68L18.5 9.7a1 1 0 0 0 .75.3H20a1 1 0 0 1 1 1V15a1 1 0 0 1-1 1h-1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M4 15h1M14 16H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="8" cy="16" r="1.7" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="16" r="1.7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 5l1.5 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function ProfitIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M14.5 9.3a2.6 2.6 0 0 0-2.3-1.3c-1.5 0-2.7 1-2.7 2.3 0 1.2 1 1.7 2.5 2 1.7.4 2.7.9 2.7 2.1 0 1.3-1.2 2.3-2.7 2.3a2.7 2.7 0 0 1-2.4-1.3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M12 6.6v1M12 16.4v1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function TrophyIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M7 4h10v4.5a5 5 0 0 1-10 0V4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7 5.5H4.8a1.5 1.5 0 0 0-1.4 2.1l.6 1.4A2.5 2.5 0 0 0 6.3 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 5.5h2.2a1.5 1.5 0 0 1 1.4 2.1l-.6 1.4a2.5 2.5 0 0 1-2.3 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 13v3M9 19h6M10 19v-2.3M14 19v-2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function BuildingIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect x="5" y="3.5" width="10" height="17" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15 10h4v10.5h-4M8 7.5h1M11.5 7.5h1M8 11h1M11.5 11h1M8 14.5h1M11.5 14.5h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 20.5V17h3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
