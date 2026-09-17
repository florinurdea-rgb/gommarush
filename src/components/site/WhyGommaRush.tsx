"use client";

import { useLocale } from "@/components/site/LocaleProvider";

/**
 * Three benefits directly under the hero. Deliberately compact — a strong
 * icon, a short heading and one line each, not oversized cards competing
 * with the hero's single CTA.
 */

function ShieldIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <path
        d="M12 3l7 2.5v5.2c0 4.4-2.9 8.4-7 9.8-4.1-1.4-7-5.4-7-9.8V5.5L12 3z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <circle cx="12" cy="12" r="8.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 7.4V12l3 1.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-7 w-7">
      <path
        d="M4 11.4V5a1 1 0 011-1h6.4a1 1 0 01.7.3l7.3 7.3a1 1 0 010 1.4l-6.4 6.4a1 1 0 01-1.4 0L4.3 12.1a1 1 0 01-.3-.7z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <circle cx="8.4" cy="8.4" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function WhyGommaRush() {
  const { copy } = useLocale();

  const benefits = [
    { icon: <ShieldIcon />, title: copy.whyReliableTitle, body: copy.whyReliableBody },
    { icon: <ClockIcon />, title: copy.whyFastTitle, body: copy.whyFastBody },
    { icon: <TagIcon />, title: copy.whyPriceTitle, body: copy.whyPriceBody },
  ];

  return (
    <section
      aria-labelledby="why-gommarush-title"
      className="border-t border-ink/10 bg-white"
    >
      <div className="mx-auto w-full max-w-content px-4 py-12 sm:px-6 sm:py-16">
        <h2
          id="why-gommarush-title"
          className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl"
        >
          {copy.whyTitle}
        </h2>

        <ul className="mt-8 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {benefits.map((benefit) => (
            <li key={benefit.title} className="flex gap-4 sm:flex-col sm:gap-3">
              <span
                aria-hidden="true"
                className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-accent-light text-accent-dark"
              >
                {benefit.icon}
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ink">{benefit.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{benefit.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
