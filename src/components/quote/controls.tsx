"use client";

import { useId } from "react";

/**
 * Small shared form primitives for the quote builder.
 *
 * SegmentedControl is a real radiogroup rather than styled divs: arrow keys
 * move between options, the group is labelled, and the selected state is
 * exposed through aria-checked instead of colour alone.
 */

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  error,
  describedBy,
}: {
  label: string;
  options: SegmentOption<T>[];
  /** null renders nothing selected — used where a choice is required. */
  value: T | null;
  onChange: (next: T) => void;
  name: string;
  error?: string;
  describedBy?: string;
}) {
  const labelId = useId();

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const currentIndex = options.findIndex((option) => option.value === value);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const base = currentIndex === -1 ? (forward ? -1 : 0) : currentIndex;
    const nextIndex = (base + (forward ? 1 : -1) + options.length) % options.length;
    onChange(options[nextIndex].value);
  }

  return (
    <div>
      <div id={labelId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-describedby={[error ? `${labelId}-error` : null, describedBy].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : undefined}
        onKeyDown={onKeyDown}
        className={`inline-flex w-full gap-1 rounded-xl border p-1 ${
          error ? "border-state-danger" : "border-ink/15"
        } bg-surface-soft`}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              name={name}
              tabIndex={selected || (value === null && option === options[0]) ? 0 : -1}
              onClick={() => onChange(option.value)}
              className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                selected ? "bg-white text-accent-dark shadow-sm" : "text-ink-soft hover:text-ink"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p id={`${labelId}-error`} className="mt-1 text-xs font-semibold text-state-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * −  2  + with a directly editable number, so desktop users can type "12"
 * instead of clicking eleven times. Clamps to >= 1 on blur rather than
 * fighting the user mid-keystroke.
 */
export function QuantityStepper({
  label,
  value,
  onChange,
  decreaseLabel,
  increaseLabel,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const inputId = useId();

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </label>
      <div className="inline-flex items-stretch rounded-xl border border-ink/15 bg-white">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          aria-label={decreaseLabel}
          disabled={value <= 1}
          className="inline-flex h-12 w-12 items-center justify-center rounded-l-xl text-lg font-bold text-ink-soft transition-colors hover:bg-surface-soft disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          −
        </button>
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={1}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          onBlur={(event) => {
            const next = Math.trunc(Number(event.target.value));
            onChange(Number.isFinite(next) && next >= 1 ? next : 1);
          }}
          className="h-12 w-16 border-x border-ink/15 text-center text-base font-bold text-ink outline-none focus:bg-accent-light/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => onChange(value + 1)}
          aria-label={increaseLabel}
          className="inline-flex h-12 w-12 items-center justify-center rounded-r-xl text-lg font-bold text-ink-soft transition-colors hover:bg-surface-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Text/number input with a real <label>, and errors tied via aria-describedby. */
export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-soft">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs font-semibold text-state-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass =
  "h-12 w-full rounded-xl border border-ink/15 bg-white px-3 text-base text-ink outline-none transition-colors focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/40";

export const inputErrorClass =
  "h-12 w-full rounded-xl border border-state-danger bg-white px-3 text-base text-ink outline-none transition-colors focus:border-state-danger focus-visible:ring-2 focus-visible:ring-state-danger/40";
