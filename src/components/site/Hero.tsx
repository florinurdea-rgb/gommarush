"use client";

import Link from "next/link";
import { useLocale } from "@/components/site/LocaleProvider";
import { Section, BUTTON_STYLES } from "@/components/site/Section";
import { OverlayStatus } from "@/components/site/ImagePlaceholder";
import { REGISTER_HREF, ROUTES } from "@/lib/site-routes";

const heroVanFleet = "/images/hero-van-fleet.webp";

/**
 * The homepage hero.
 *
 * Copy-left, image-right at `lg`, stacked below, with the image SECOND in the
 * DOM so a phone reads the proposition and reaches the CTA before scrolling
 * past a picture. The brief's "obvious Register CTA on mobile" is mostly a
 * source-order decision rather than a styling one.
 *
 * The photograph is the real branded fleet image the site already ships, not a
 * placeholder: there is no reason to reserve a box for a picture that exists.
 * It moves from a washed-out full-bleed backdrop into a framed composition,
 * where it can be seen instead of being faded to near-white to keep text
 * readable over it.
 *
 * Two CTAs, not three. The tyre finder used to sit here as a third action and
 * has moved to the "Trova" step of the ordering section, where a shop looking
 * up a specific size actually is -- the feature is preserved and better
 * placed, and the hero keeps one dominant action.
 *
 * Height comes from content, never the viewport: a 100vh hero would push the
 * value strip below the fold, and that strip is the fastest part of the page
 * to understand.
 */
export function Hero() {
  const { copy } = useLocale();

  return (
    <Section>
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
        <div>
          <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-[-0.025em] text-ink sm:text-5xl lg:text-[3.5rem]">
            {copy.homeHeroTitle}
          </h1>

          <p className="mt-5 text-xl font-bold leading-snug tracking-[-0.01em] text-accent sm:text-2xl">
            {copy.homeHeroLede}
          </p>

          <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
            {copy.homeHeroBody}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={REGISTER_HREF} className={BUTTON_STYLES.primary}>
              {copy.ctaRegisterFree}
            </Link>
            <Link href={ROUTES.howItWorks} className={BUTTON_STYLES.secondary}>
              {copy.ctaDiscoverHow}
            </Link>
          </div>
        </div>

        <div className="relative">
          {/* Aspect-locked wrapper: the intrinsic size is known, so the box is
              reserved before the image decodes and nothing shifts. */}
          <div className="relative w-full overflow-hidden rounded-2xl border border-steel-soft bg-surface-soft aspect-[4/3]">
            <img
              src={heroVanFleet}
              alt={copy.heroImageAlt}
              width={1600}
              height={1200}
              decoding="async"
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <OverlayStatus label={copy.heroStatusLabel} value={copy.heroStatusValue} />
          </div>
        </div>
      </div>
    </Section>
  );
}
