const logo = "/images/logo.jpg";

/**
 * A cargo-van glyph (Sprinter-style proportions) for the vehicle board's
 * column headers, carrying the GommaRush shield as its side decal and a
 * numbered badge above it ("Mașina 1", "Mașina 2", …) so columns are
 * recognizable at a glance without reading the vehicle name.
 *
 * Pure decoration — a generic van silhouette, not a depiction of any
 * specific manufacturer's vehicle or badge.
 */
export function VehicleIcon({ number, className = "" }: { number: number; className?: string }) {
  return (
    <div className={`relative inline-block ${className}`}>
      <svg viewBox="0 0 200 100" className="h-full w-full" aria-hidden="true">
        <ellipse cx="100" cy="90" rx="82" ry="5" className="fill-ink/10" />

        {/* Cab + hood, sharing the box's roofline (y=18) and bottom (y=70) */}
        <polygon points="55,18 28,18 14,42 14,70 55,70" fill="#FFFFFF" stroke="#152238" strokeWidth="3" strokeLinejoin="round" />
        {/* Windshield */}
        <polygon points="49,23 31,23 20,40 49,40" className="fill-accent-light" />

        {/* Cargo box */}
        <rect x="55" y="18" width="125" height="52" rx="5" fill="#FFFFFF" stroke="#152238" strokeWidth="3" />
        {/* Side door seams */}
        <line x1="100" y1="24" x2="100" y2="70" stroke="#152238" strokeOpacity="0.15" strokeWidth="1.5" />
        <line x1="140" y1="24" x2="140" y2="70" stroke="#152238" strokeOpacity="0.15" strokeWidth="1.5" />

        {/* Livery stripe */}
        <rect x="14" y="54" width="166" height="9" className="fill-accent" />

        {/* Bumpers */}
        <rect x="8" y="60" width="7" height="10" rx="2" fill="#152238" fillOpacity="0.75" />
        <rect x="180" y="60" width="7" height="10" rx="2" fill="#152238" fillOpacity="0.75" />

        {/* Wheels */}
        <circle cx="48" cy="78" r="13" fill="#152238" />
        <circle cx="48" cy="78" r="5" fill="#F6F8FB" />
        <circle cx="148" cy="78" r="13" fill="#152238" />
        <circle cx="148" cy="78" r="5" fill="#F6F8FB" />
      </svg>

      {/* GommaRush shield decal on the cargo box, same crop as <Logo /> */}
      <span
        aria-hidden="true"
        className="absolute h-[22%] w-[13%] bg-no-repeat"
        style={{
          left: "44%",
          top: "26%",
          backgroundImage: `url(${logo})`,
          backgroundSize: "278%",
          backgroundPosition: "50% 34%",
        }}
      />

      {/* Vehicle number badge */}
      <span
        className="absolute -top-2 -right-1 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-accent text-xs font-black text-white shadow-card ring-2 ring-white"
        aria-hidden="true"
      >
        {number}
      </span>
    </div>
  );
}
