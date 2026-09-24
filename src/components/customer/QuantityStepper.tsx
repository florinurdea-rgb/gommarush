"use client";
import { useEffect, useState } from "react";
import { CommerceMinusIcon, CommercePlusIcon } from "@/components/customer/CommerceIcons";
import { clampQuantity, parseQuantity, QUANTITY_MAX, QUANTITY_MIN } from "@/lib/customer/quantity";

/**
 * The commerce quantity control: [ − ] [ editable ] [ + ].
 *
 * ONE CONTROL FOR THREE SCREENS — catalogue, basket and checkout — because a
 * tyre shop that learns it once should not meet a different one a click later.
 *
 * It is NOT src/components/QuantitySelector.tsx, which belongs to the public
 * quote form: that one carries a fixed DOM id, its own label and its own
 * helper sentence, so a second instance on a page of results would emit
 * duplicate ids and repeat a sentence twenty times. Reusing it here would have
 * meant gutting the thing it was written for.
 *
 * TYPING IS NOT FOUGHT. The box holds the raw string while it is being edited,
 * so clearing it to type "12" does not snap back to 1 between keystrokes. The
 * value is only normalised on blur and on the +/- buttons, which is where an
 * integer is genuinely needed.
 *
 * Commit timing is the caller's business. The catalogue commits on Aggiungi;
 * the basket debounces typing and commits immediately on +/-. That difference
 * is real — one is composing an order line, the other is changing one that
 * already exists and costs a validation round trip.
 */

export function QuantityStepper({
  value,
  onChange,
  onCommit,
  disabled,
  label,
  size = "md",
}: {
  value: number;
  /** Fires on every accepted change, including each keystroke. */
  onChange: (quantity: number) => void;
  /** Fires when the number is settled: a +/- press, or blur after typing. */
  onCommit?: (quantity: number) => void;
  disabled?: boolean;
  /** Accessible name; every instance on a page of results needs its own. */
  label: string;
  size?: "md" | "sm";
}) {
  const [draft, setDraft] = useState(String(value));

  // Follows the value when it changes from outside — a validation that
  // corrected it, or the basket reloading — but never mid-edit, because the
  // draft is what the customer is currently typing.
  useEffect(() => setDraft(String(value)), [value]);

  const height = size === "sm" ? "h-10" : "h-11";
  // 44px on touch: the brief's floor, and the reason the buttons are not
  // icon-sized squares.
  const button =
    "flex w-11 flex-none items-center justify-center text-ink-soft transition-colors hover:bg-surface-soft active:bg-surface-soft disabled:text-ink/25 disabled:hover:bg-transparent";

  const step = (delta: number) => {
    const next = clampQuantity((parseQuantity(draft) ?? value) + delta);
    setDraft(String(next));
    onChange(next);
    onCommit?.(next);
  };

  return (
    <div
      className={`inline-flex ${height} items-stretch overflow-hidden rounded-xl border border-ink/15 bg-white focus-within:border-accent`}
    >
      <button
        type="button"
        aria-label={`− ${label}`}
        className={button}
        disabled={disabled || value <= QUANTITY_MIN}
        onClick={() => step(-1)}
      >
        <CommerceMinusIcon className="h-4 w-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        className="w-12 border-x border-ink/10 bg-transparent text-center text-[15px] font-bold text-ink outline-none disabled:text-ink/40"
        disabled={disabled}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          setDraft(raw);
          const parsed = parseQuantity(raw);
          if (parsed !== null) onChange(parsed);
        }}
        onBlur={() => {
          const parsed = parseQuantity(draft) ?? QUANTITY_MIN;
          setDraft(String(parsed));
          onChange(parsed);
          onCommit?.(parsed);
        }}
      />
      <button
        type="button"
        aria-label={`+ ${label}`}
        className={button}
        disabled={disabled || value >= QUANTITY_MAX}
        onClick={() => step(1)}
      >
        <CommercePlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
