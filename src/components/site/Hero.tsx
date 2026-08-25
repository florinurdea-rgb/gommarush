"use client";

import Link from "next/link";
import { HeroBackground } from "@/components/HeroBackground";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * The homepage hero. One dominant CTA ("Richiedi un'offerta") and nothing
 * competing with it — the driver/staff entrances live in the hamburger menu.
 *
 * Reuses the existing branded fleet photograph via <HeroBackground>, which
 * already handles the white wash that keeps the copy readable.
 */
export function Hero() {
  const { copy } = useLocale();

  return (
    <section className="relative flex flex-1 flex-col justify-center overflow-hidden">
      <HeroBackground />

      <div className="relative mx-auto flex w-full max-w-content flex-col items-start px-4 py-16 sm:px-6 sm:py-24">
        <h1 className="max-w-2xl text-[26px] font-extrabold leading-[1.15] tracking-tight text-ink sm:text-[34px] lg:text-5xl">
          {copy.heroTitle}
        </h1>

        {/* A real <h2>, not a styled paragraph: it is the page's second
            heading level and carries the coverage claim, so it belongs in
            the document outline. Weight and size keep it subordinate to the
            h1 visually. */}
        <h2 className="mt-4 max-w-xl text-base font-normal leading-relaxed text-ink-soft sm:text-lg">
          {copy.heroSubtitle}
        </h2>

        <Link
          href="/richiedi-offerta"
          className="mt-8 inline-flex min-h-[52px] items-center justify-center rounded-xl bg-accent px-8 text-base font-bold text-white shadow-sm transition-all duration-150 hover:bg-accent-dark active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 sm:text-lg"
        >
          {copy.heroCta}
        </Link>
      </div>
    </section>
  );
}
