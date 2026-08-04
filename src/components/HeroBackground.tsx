export function HeroBackground() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Workshop floor line */}
      <rect x="0" y="640" width="1600" height="360" fill="#F6F8FB" />
      <line x1="0" y1="640" x2="1600" y2="640" stroke="#152238" strokeOpacity="0.06" strokeWidth="2" />

      {/* Large tyre silhouette, right side */}
      <g transform="translate(1180,470)" opacity="0.08">
        <circle r="300" fill="none" stroke="#152238" strokeWidth="42" />
        <circle r="300" fill="none" stroke="#152238" strokeWidth="2" strokeDasharray="4 26" />
        <circle r="150" fill="none" stroke="#152238" strokeWidth="14" />
        {Array.from({ length: 10 }).map((_, i) => (
          <line
            key={i}
            x1="0"
            y1="0"
            x2={150 * Math.cos((i * Math.PI) / 5)}
            y2={150 * Math.sin((i * Math.PI) / 5)}
            stroke="#152238"
            strokeWidth="10"
          />
        ))}
      </g>

      {/* Small tyre silhouette, left side */}
      <g transform="translate(190,760)" opacity="0.06">
        <circle r="130" fill="none" stroke="#152238" strokeWidth="26" />
        <circle r="60" fill="none" stroke="#152238" strokeWidth="10" />
      </g>

      {/* Tool / wrench accent */}
      <g transform="translate(430,560) rotate(24)" opacity="0.07">
        <rect x="-14" y="-160" width="28" height="220" rx="14" fill="#1E5FD9" />
        <circle cx="0" cy="-170" r="34" fill="none" stroke="#1E5FD9" strokeWidth="16" />
      </g>

      <rect x="0" y="0" width="1600" height="1000" fill="url(#fade)" />
    </svg>
  );
}
