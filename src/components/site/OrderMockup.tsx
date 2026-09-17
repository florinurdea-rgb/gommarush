"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { Icon } from "@/components/site/icons";

/**
 * A conceptual visual of what ordering is meant to feel like.
 *
 * Deliberately NOT a screenshot of the real product, and deliberately not
 * dressed up as one: no window chrome, no fake cursor, no traffic lights. It
 * is a diagram of an interaction, rendered in the site's own type and colour,
 * which is honest about being an illustration while still making the point.
 *
 * Every price is an em dash and availability is a delivery window rather than
 * a stock figure. Inventing "12 disponibili" or "EUR 84,50" would be
 * fabricating commercial data, and a gommista who later saw different numbers
 * would be right to distrust everything else on the page. The dashes still
 * carry the argument -- the reader is looking at how few steps there are, not
 * at the figures.
 *
 * The brand names are real manufacturers whose logos the site already
 * displays; they name the kind of tyre a shop searches for, and imply no
 * commercial relationship that the logo strip does not already imply.
 */

const EXAMPLE_ROWS = [
  { brand: "Pirelli", window: "48h" },
  { brand: "Michelin", window: "7 gg" },
  { brand: "Continental", window: "48h" },
] as const;

export function OrderMockup() {
  const { copy } = useLocale();

  return (
    <figure className="w-full">
      <div className="overflow-hidden rounded-2xl border border-steel-soft bg-white shadow-card">
        {/* Search row */}
        <div className="border-b border-steel-soft bg-surface-soft px-4 py-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
            {copy.mockupSizeLabel}
          </p>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-steel">
              <Icon name="find" className="h-[1.1rem] w-[1.1rem]" />
            </span>
            <span className="font-mono text-lg font-bold tabular-nums tracking-tight text-ink sm:text-xl">
              205 / 55 R16
            </span>
          </div>
        </div>

        {/* Results */}
        <div className="px-4 pt-4 sm:px-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
            {copy.mockupResultsLabel}
          </p>
        </div>

        <ul className="divide-y divide-steel-soft px-4 sm:px-5">
          {EXAMPLE_ROWS.map((row) => (
            <li key={row.brand} className="flex items-center justify-between gap-4 py-3.5">
              <span className="text-[15px] font-bold text-ink">{row.brand}</span>

              <span className="flex items-center gap-3 sm:gap-4">
                {/* Price withheld on purpose -- see the note above. */}
                <span aria-hidden="true" className="font-mono text-[15px] text-steel">
                  &euro; &mdash;
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-accent-light px-2.5 py-1 text-[12px] font-bold text-accent">
                  <Icon name="delivery48" className="h-3.5 w-3.5" />
                  {row.window}
                </span>
              </span>
            </li>
          ))}
        </ul>

        {/* Action */}
        <div className="flex items-center justify-end px-4 py-4 sm:px-5">
          <span
            aria-hidden="true"
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-accent px-4 text-[14px] font-bold text-white"
          >
            <Icon name="order" className="h-4 w-4" />
            {copy.mockupOrderCta}
          </span>
        </div>
      </div>

      <figcaption className="mt-3 text-[13px] leading-snug text-ink-soft">
        {copy.mockupDisclaimer}
      </figcaption>
    </figure>
  );
}
