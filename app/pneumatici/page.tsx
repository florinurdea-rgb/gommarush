"use client";

import Link from "next/link";
import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Section, SectionHeading, BUTTON_STYLES } from "@/components/site/Section";
import { BrandMarquee } from "@/components/site/BrandMarquee";
import { OrderMockup } from "@/components/site/OrderMockup";
import { DeliveryModes } from "@/components/site/DeliveryModes";
import { TyreFinder } from "@/components/site/TyreFinder";
import { ConversionCta } from "@/components/site/ConversionCta";
import { useLocale } from "@/components/site/LocaleProvider";
import { REGISTER_HREF } from "@/lib/site-routes";

/**
 * Pneumatici.
 *
 * The product-facing page. It deliberately does NOT pretend to be a public
 * catalogue: browsing with real prices is behind registration, and building a
 * page that looks like a shop front but cannot quote anything would be the
 * fake experience the brief rules out.
 *
 * So it does the two honest things available -- it lets a shop look up a
 * specific tyre through the live finder, and it shows which manufacturers turn
 * up in what we supply -- then asks them to register for prices.
 */
export default function TyresPage() {
  const { copy } = useLocale();

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader showBack />

      <main className="flex flex-1 flex-col">
        <Section>
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div>
              <SectionHeading
                title={copy.navTyres}
                lede={copy.finderIntro}
                level={1}
                size="xl"
              />

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <TyreFinder triggerClassName="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-bold text-white transition-colors hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2" />
                <Link href={REGISTER_HREF} className={BUTTON_STYLES.secondary}>
                  {copy.ctaRegister}
                </Link>
              </div>
            </div>

            <OrderMockup />
          </div>
        </Section>

        <BrandMarquee />

        <Section tone="soft" bordered>
          <SectionHeading
            eyebrow={copy.deliveryEyebrow}
            title={copy.deliveryTitle}
            lede={copy.deliveryBody}
          />
          <div className="mt-12">
            <DeliveryModes />
          </div>
        </Section>

        <ConversionCta />
      </main>

      <SiteFooter />
    </div>
  );
}
