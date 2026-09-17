"use client";

import Link from "next/link";
import { useLocale } from "@/components/site/LocaleProvider";
import { Section, BUTTON_STYLES } from "@/components/site/Section";
import { Icon } from "@/components/site/icons";
import { REGISTER_HREF } from "@/lib/site-routes";

/**
 * The closing conversion block.
 *
 * On the ink tone, which appears at most twice per page -- here and the
 * supplier hero. The headline is split across two lines in the copy itself
 * rather than relying on a `<br>`, because the contrast between the two halves
 * ("less time / more time") is the argument, and letting it wrap arbitrarily
 * mid-phrase loses it.
 *
 * The delivery mark on the right stops this being another rectangle with text
 * in it, and it is the service's own vocabulary rather than an abstract
 * graphic.
 */
export function ConversionCta() {
  const { copy } = useLocale();

  return (
    <Section tone="ink">
      <div className="grid items-center gap-10 lg:grid-cols-[1.4fr_1fr] lg:gap-16">
        <div>
          <h2 className="text-balance text-3xl font-extrabold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl lg:text-[2.75rem]">
            {copy.finalTitle}
            {/* Explicit space: the second half is a block-level span, so
                without it textContent reads "pneumatici.Piu" as one word to a
                screen reader even though it renders on two lines. */}{" "}
            <span className="mt-1 block text-accent-light">{copy.finalTitleSecond}</span>
          </h2>

          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-white/75">{copy.finalBody}</p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={REGISTER_HREF} className={BUTTON_STYLES.onInk}>
              {copy.ctaRegisterFree}
            </Link>
            <Link href="/come-funziona" className={BUTTON_STYLES.ghostOnInk}>
              {copy.ctaDiscoverHow}
            </Link>
          </div>
        </div>

        {/* A restrained delivery mark rather than an illustration. */}
        <div className="hidden lg:block">
          <div className="ml-auto max-w-[18rem] rounded-2xl border border-white/15 bg-white/[0.06] p-6">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white">
              <Icon name="receive" className="h-5 w-5" />
            </span>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-white/60">
              {copy.heroStatusLabel}
            </p>
            <p className="mt-1 text-[15px] font-bold leading-snug text-white">
              {copy.heroStatusValue}
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
