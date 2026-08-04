import { forwardRef } from "react";

interface QuantitySelectorProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
}

function step(value: string, delta: number): string {
  const current = parseInt(value, 10);
  const base = Number.isFinite(current) && current > 0 ? current : 0;
  const next = base + delta;
  return next >= 1 ? String(next) : "1";
}

export const QuantitySelector = forwardRef<HTMLInputElement, QuantitySelectorProps>(
  ({ value, onChange, onBlur, error }, ref) => {
    return (
      <div>
        <label htmlFor="tyre-quantity" className="mb-2 block text-sm font-semibold text-ink">
          Quantit&agrave; <span className="text-accent">*</span>
        </label>
        <div
          className={`inline-flex h-14 items-stretch overflow-hidden rounded-xl border bg-white ${
            error ? "border-red-400" : "border-ink/15 focus-within:border-accent"
          }`}
        >
          <button
            type="button"
            aria-label="Diminuisci quantit&agrave;"
            onClick={() => onChange(step(value, -1))}
            className="w-12 flex-none text-xl font-semibold text-ink-soft transition-colors hover:bg-surface-soft active:bg-surface-soft"
          >
            &minus;
          </button>
          <input
            ref={ref}
            id="tyre-quantity"
            type="text"
            inputMode="numeric"
            placeholder="1"
            aria-required="true"
            aria-invalid={!!error}
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={onBlur}
            className="w-16 border-x border-ink/10 bg-transparent text-center text-base font-semibold text-ink outline-none"
          />
          <button
            type="button"
            aria-label="Aumenta quantit&agrave;"
            onClick={() => onChange(step(value, 1))}
            className="w-12 flex-none text-xl font-semibold text-ink-soft transition-colors hover:bg-surface-soft active:bg-surface-soft"
          >
            +
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-1.5 text-sm text-red-600">
            {error}
          </p>
        ) : (
          <p className="mt-1.5 text-sm text-ink-soft">Inserisci la quantit&agrave; desiderata.</p>
        )}
      </div>
    );
  }
);
QuantitySelector.displayName = "QuantitySelector";
