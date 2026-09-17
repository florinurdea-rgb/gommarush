"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { Icon, type IconName } from "@/components/site/icons";

export interface JourneyStep {
  icon: IconName;
  label: string;
  body: string;
}

/**
 * The ordering journey, as a journey rather than four boxes.
 *
 * The connecting line is the point of this component. Four cards in a row
 * communicate "four features"; a line running through four numbered stops
 * communicates "this happens in order, and it ends with you receiving the
 * tyres" -- which is the actual claim.
 *
 * The line is drawn with a border on a pseudo-free wrapper rather than an SVG
 * so it reflows with the grid, and it is hidden below `lg` where the journey
 * turns vertical and the numbers carry the sequence on their own.
 *
 * Numbering is real information here (a process has an order), which is the
 * test for whether numbered markers are justified rather than decorative.
 */
export function ProcessJourney({ steps }: { steps: JourneyStep[] }) {
  const { copy } = useLocale();
  void copy;

  return (
    <ol className="relative mt-12 grid gap-8 lg:mt-14 lg:grid-cols-4 lg:gap-6">
      {/* The rail. Sits behind the markers, inset by half a column so it
          starts and ends at the first and last marker rather than at the
          section edge. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 right-0 top-5 hidden lg:block"
      >
        <div className="mx-auto h-px w-[75%] bg-steel-soft" />
      </div>

      {steps.map((step, index) => (
        <li key={step.label} className="relative flex gap-4 lg:flex-col lg:gap-0">
          {/* Marker: number on a white ground so the rail passes behind it
              cleanly without a mask. */}
          <div className="flex flex-none flex-col items-center lg:block">
            <span className="relative z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-steel-soft bg-white font-mono text-[13px] font-bold tabular-nums text-accent">
              {String(index + 1).padStart(2, "0")}
            </span>
            {/* Vertical rail for the stacked layout. */}
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="mt-1 w-px flex-1 bg-steel-soft lg:hidden" />
            )}
          </div>

          <div className="pb-2 lg:mt-6 lg:pb-0">
            <div className="flex items-center gap-2">
              <span className="text-accent">
                <Icon name={step.icon} className="h-[1.05rem] w-[1.05rem]" />
              </span>
              <h3 className="text-[17px] font-bold leading-tight text-ink">{step.label}</h3>
            </div>
            <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-ink-soft">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
