import { Quantity } from "../lib/types";

const OPTIONS: Quantity[] = [1, 2, 4];

interface QuantitySelectorProps {
  value: Quantity;
  onChange: (quantity: Quantity) => void;
}

export function QuantitySelector({ value, onChange }: QuantitySelectorProps) {
  return (
    <div>
      <span className="mb-2 block text-sm font-semibold text-ink">Quantit&agrave;</span>
      <div role="radiogroup" aria-label="Quantità" className="inline-flex rounded-xl border border-ink/15 bg-white p-1">
        {OPTIONS.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={`h-11 min-w-[52px] rounded-lg px-3 text-sm font-semibold transition-colors ${
                selected ? "bg-accent text-white" : "text-ink hover:bg-surface-soft"
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
