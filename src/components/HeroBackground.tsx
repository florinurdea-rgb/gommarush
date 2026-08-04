export function HeroBackground() {
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
    >
      <style>{`
        .gr-van { animation: gr-drive 9s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 50%; }
        .gr-wheel { animation: gr-spin 0.7s linear infinite; transform-box: fill-box; transform-origin: 50% 50%; }
        .gr-cargo-tyre { animation: gr-sway 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 50%; }
        .gr-delivered-tyre { animation: gr-arrive 9s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100%; }

        @keyframes gr-drive {
          0%   { transform: translateX(-300px); opacity: 0; }
          10%  { opacity: 1; }
          42%  { transform: translateX(0); opacity: 1; }
          60%  { transform: translateX(0); opacity: 1; }
          78%  { transform: translateX(60px); opacity: 0; }
          100% { transform: translateX(-300px); opacity: 0; }
        }
        @keyframes gr-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes gr-sway {
          0%, 100% { transform: rotate(-10deg); }
          50% { transform: rotate(-4deg); }
        }
        @keyframes gr-arrive {
          0%, 46% { transform: translateY(-26px) scale(0.85); opacity: 0; }
          56%     { transform: translateY(4px) scale(1.04); opacity: 1; }
          62%     { transform: translateY(0) scale(1); opacity: 1; }
          94%     { transform: translateY(0) scale(1); opacity: 1; }
          100%    { transform: translateY(-8px) scale(0.97); opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .gr-van, .gr-wheel, .gr-cargo-tyre, .gr-delivered-tyre { animation: none; }
          .gr-van { transform: translateX(0); opacity: 1; }
          .gr-delivered-tyre { transform: translateY(0) scale(1); opacity: 1; }
        }
      `}</style>

      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Workshop floor */}
      <rect x="0" y="640" width="1600" height="360" fill="#F6F8FB" />
      <line x1="0" y1="640" x2="1600" y2="640" stroke="#152238" strokeOpacity="0.08" strokeWidth="2" />
      <line
        x1="0"
        y1="820"
        x2="1600"
        y2="820"
        stroke="#152238"
        strokeOpacity="0.05"
        strokeWidth="10"
        strokeDasharray="46 34"
      />

      {/* Fitting shop, right side */}
      <g opacity="0.09">
        <rect x="1205" y="456" width="372" height="26" rx="4" fill="#152238" />
        <rect x="1224" y="482" width="334" height="158" fill="#152238" />
        <rect x="1250" y="512" width="76" height="54" fill="#F6F8FB" stroke="#152238" strokeWidth="4" />
      </g>
      <g opacity="0.12">
        <rect x="1396" y="556" width="146" height="84" rx="4" fill="#152238" />
        {Array.from({ length: 5 }).map((_, i) => (
          <line
            key={i}
            x1="1396"
            y1={572 + i * 14}
            x2="1542"
            y2={572 + i * 14}
            stroke="#F6F8FB"
            strokeWidth="3"
          />
        ))}
      </g>
      <rect x="1450" y="430" width="20" height="26" rx="2" fill="#1E5FD9" opacity="0.16" />

      {/* Tyres stacked outside the shop */}
      <g opacity="0.13">
        <circle cx="1300" cy="606" r="32" fill="none" stroke="#152238" strokeWidth="13" />
        <circle cx="1300" cy="606" r="12" fill="none" stroke="#152238" strokeWidth="6" />
        <circle cx="1334" cy="606" r="32" fill="none" stroke="#152238" strokeWidth="13" />
        <circle cx="1334" cy="606" r="12" fill="none" stroke="#152238" strokeWidth="6" />
      </g>
      <g className="gr-delivered-tyre" opacity="0.16">
        <circle cx="1368" cy="606" r="32" fill="none" stroke="#1E5FD9" strokeWidth="13" />
        <circle cx="1368" cy="606" r="12" fill="none" stroke="#1E5FD9" strokeWidth="6" />
      </g>

      {/* Delivery van driving in from the left */}
      <g className="gr-van" opacity="0.16">
        <rect x="1040" y="560" width="150" height="64" rx="10" fill="#152238" />
        <rect x="1178" y="576" width="46" height="48" rx="6" fill="#152238" />
        <rect x="1186" y="584" width="28" height="20" rx="3" fill="#F6F8FB" />

        <g className="gr-cargo-tyre" transform="translate(1090,542)">
          <circle r="19" fill="none" stroke="#1E5FD9" strokeWidth="8" />
          <circle r="7" fill="none" stroke="#1E5FD9" strokeWidth="4" />
        </g>

        <g className="gr-wheel">
          <circle cx="1075" cy="634" r="21" fill="#F6F8FB" stroke="#152238" strokeWidth="9" />
          <circle cx="1075" cy="634" r="5" fill="#152238" />
        </g>
        <g className="gr-wheel">
          <circle cx="1196" cy="634" r="21" fill="#F6F8FB" stroke="#152238" strokeWidth="9" />
          <circle cx="1196" cy="634" r="5" fill="#152238" />
        </g>
      </g>

      {/* Small tyre silhouette, left side */}
      <g transform="translate(190,760)" opacity="0.06">
        <circle r="130" fill="none" stroke="#152238" strokeWidth="26" />
        <circle r="60" fill="none" stroke="#152238" strokeWidth="10" />
      </g>

      <rect x="0" y="0" width="1600" height="1000" fill="url(#fade)" />
    </svg>
  );
}
