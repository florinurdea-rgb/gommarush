"use client";

import { useLocale } from "@/components/site/LocaleProvider";

/**
 * The delivery-area section.
 *
 * The message has one thing it must not get wrong: we cover the WHOLE
 * province of Vicenza plus 50 km past its borders — not a 50 km radius
 * drawn from the city. A circle would say exactly the wrong thing, so the
 * diagram is an irregular province outline with a band offset from its
 * edge, and the copy states the distinction in words as well. Anyone
 * reading only the picture, only the heading, or only the fine print
 * arrives at the same understanding.
 */

/**
 * Stylised province outline with a 50 km buffer following its border.
 *
 * Deliberately not a map: an inaccurate real outline invites "is my town
 * inside that line?", which is a question a landing page cannot answer. An
 * obviously schematic shape communicates the RELATIONSHIP (whole area, plus
 * a margin all the way around) without pretending to precision it lacks.
 */
function CoverageDiagram({ alt }: { alt: string }) {
  // Inner shape and an outer copy scaled 1.25 about the centroid, so the
  // band tracks the border at a constant-ish offset rather than ballooning
  // into a circle.
  const province =
    "M100,22 L134,40 L150,72 L146,110 L160,134 L132,166 L96,176 L66,158 L52,124 L58,86 L74,54 Z";
  const buffer =
    "M100,2.5 L142.5,25 L162.5,65 L157.5,112.5 L175,142.5 L140,182.5 L95,195 L57.5,172.5 L40,130 L47.5,82.5 L67.5,42.5 Z";

  return (
    <svg
      role="img"
      aria-label={alt}
      viewBox="-8 -8 216 216"
      className="h-auto w-full max-w-[280px] sm:max-w-[340px]"
    >
      <path
        d={buffer}
        className="fill-accent/[0.07] stroke-accent/45"
        strokeWidth="2"
        strokeDasharray="7 6"
        strokeLinejoin="round"
      />
      <path
        d={province}
        className="fill-accent-light stroke-accent"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Vicenza itself, marked so the shape reads as a province around a
          city rather than an abstract blob. */}
      <circle cx="100" cy="94" r="4.5" className="fill-accent-dark" />
      <text
        x="100"
        y="116"
        textAnchor="middle"
        className="fill-accent-dark text-[13px] font-bold"
        style={{ fontFamily: "inherit" }}
      >
        Vicenza
      </text>
    </svg>
  );
}

export function CoverageArea() {
  const { copy } = useLocale();

  return (
    <section
      aria-labelledby="coverage-title"
      className="border-t border-ink/10 bg-surface-soft/60"
    >
      <div className="mx-auto w-full max-w-content px-4 py-12 sm:px-6 sm:py-16">
        <div className="grid items-center gap-8 sm:gap-12 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-accent-dark">
              {copy.coverageEyebrow}
            </p>

            <h2
              id="coverage-title"
              className="mt-3 text-balance text-2xl font-extrabold leading-[1.2] tracking-tight text-ink sm:text-3xl"
            >
              {copy.coverageTitle}
            </h2>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
              {copy.coverageBody}
            </p>

            <p className="mt-4 max-w-xl border-l-2 border-accent/40 pl-4 text-sm leading-relaxed text-ink">
              {copy.coverageClarify}
            </p>

            <p className="mt-6 inline-flex flex-wrap items-center gap-x-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-ink ring-1 ring-inset ring-ink/10">
              {copy.coverageBadge}
            </p>
          </div>

          {/* Diagram second in the DOM, so a phone reads the words first and
              the picture confirms them. */}
          <div className="flex flex-col items-center gap-4 lg:items-start">
            <CoverageDiagram alt={copy.coverageDiagramAlt} />

            <ul className="w-full max-w-[340px] space-y-2 text-sm">
              <li className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-1 h-3 w-3 flex-none rounded-[3px] border-2 border-accent bg-accent-light"
                />
                <span className="text-ink">{copy.coverageAreaLabel}</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span
                  aria-hidden="true"
                  className="mt-1 h-3 w-3 flex-none rounded-[3px] border-2 border-dashed border-accent/60"
                />
                <span className="text-ink-soft">{copy.coverageBufferLabel}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
