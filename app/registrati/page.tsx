"use client";

import Link from "next/link";
import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Section, SectionHeading, BUTTON_STYLES } from "@/components/site/Section";
import { IconBadge } from "@/components/site/icons";
import { useLocale } from "@/components/site/LocaleProvider";
import { ROUTES } from "@/lib/site-routes";

/**
 * Interim destination for every "Registrati" CTA.
 *
 * The registration funnel is being built separately. This page exists so those
 * CTAs go somewhere true: it says plainly that sign-up is not open yet and
 * offers the route that does work today. The alternatives were a `#` that goes
 * nowhere, or pointing the CTA at the quote form -- which would be the wrong
 * destination dressed up as the right one.
 *
 * It is deliberately NOT a form. A registration screen that collects details
 * and cannot create an account would be a fake experience.
 *
 * When the real funnel lands, REGISTER_HREF in src/lib/site-routes.ts moves to
 * it and this page can go.
 */
export default function RegisterPage() {
  const { copy } = useLocale();

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader showBack />

      <main className="flex flex-1 flex-col">
        <Section>
          <div className="max-w-2xl">
            <SectionHeading
              title={copy.registerPageTitle}
              lede={copy.registerPageLede}
              level={1}
              size="xl"
            />

            <div className="mt-10 rounded-2xl border border-steel-soft bg-surface-soft p-6 sm:p-7">
              <div className="flex items-start gap-4">
                <IconBadge name="message" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
                    {copy.registerPageQuoteHint}
                  </p>
                  <p className="mt-1 text-[17px] font-bold leading-snug text-ink">
                    {copy.navQuote}
                  </p>
                  <Link href={ROUTES.quote} className={`${BUTTON_STYLES.primary} mt-5`}>
                    {copy.heroCta}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
