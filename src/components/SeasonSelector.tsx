import { Season, SEASON_LABELS } from "../lib/types";

const SEASONS: Season[] = ["estivo", "invernale", "quattro-stagioni"];

const ICONS: Record<Season, JSX.Element> = {
  estivo: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8L6 18M18 6l1.8-1.8"
      />
    </svg>
  ),
  invernale: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        d="M12 2v20M4.5 6.5l15 11M19.5 6.5l-15 11M6 4l1 3-3 1M18 4l-1 3 3 1M6 20l1-3-3-1M18 20l-1-3 3-1"
      />
    </svg>
  ),
  "quattro-stagioni": (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M12 3v18M3 12h18" />
    </svg>
  ),
};

interface SeasonSelectorProps {
  value: Season | null;
  onChange: (season: Season) => void;
  error?: string;
}

export function SeasonSelector({ value, onChange, error }: SeasonSelectorProps) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">
        Stagione <span className="text-accent">*</span>
      </legend>
      <div
        role="radiogroup"
        aria-required="true"
        aria-invalid={!!error}
        className="grid grid-cols-1 gap-2.5 sm:grid-cols-3"
      >
        {SEASONS.map((season) => {
          const selected = value === season;
          return (
            <button
              key={season}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(season)}
              className={`flex h-14 items-center justify-center gap-2 rounded-xl border-2 px-3 text-sm font-semibold transition-colors ${
                selected
                  ? "border-accent bg-accent-light text-accent-dark"
                  : "border-ink/15 bg-white text-ink hover:border-ink/30"
              }`}
            >
              <span className={selected ? "text-accent" : "text-ink-soft"}>{ICONS[season]}</span>
              {SEASON_LABELS[season]}
              {selected ? (
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-accent">
                  <path d="M4 10.5l3.5 3.5L16 5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
