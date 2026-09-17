"use client";

import Link from "next/link";
import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Section, SectionHeading, BUTTON_STYLES } from "@/components/site/Section";
import { ProcessJourney } from "@/components/site/ProcessJourney";
import { OrderMockup } from "@/components/site/OrderMockup";
import { DeliveryModes } from "@/components/site/DeliveryModes";
import { ConversionCta } from "@/components/site/ConversionCta";
import { useLocale } from "@/components/site/LocaleProvider";
import { REGISTER_HREF } from "@/lib/site-routes";

/**
 * Come funziona.
 *
 * Five steps rather than the homepage's four: this page starts at "Registrati",
 * because someone who navigated here is deciding whether to open an account,
 * not just wondering what ordering looks like.
 *
 * Kept visual and short on purpose. It explains what the shop does and gets
 * back, never how sourcing works internally -- that is our problem, and a
 * gommista reading this page is not shopping for supply-chain architecture.
 */
export default function HowItWorksPage() {
  const { copy } = useLocale();

  const steps = [
    { icon: "simple" as const, label: copy.howStepRegisterLabel, body: copy.howStepRegisterBody },
    { icon: "find" as const, label: copy.step1Label, body: copy.step1Body },
    { icon: "choose" as const, label: copy.step2Label, body: copy.step2Body },
    { icon: "order" as const, label: copy.step3Label, body: copy.step3Body },
    { icon: "receive" as const, label: copy.step4Label, body: copy.step4Body },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader showBack />

      <main className="flex flex-1 flex-col">
        <Section>
          <SectionHeading
            title={copy.howPageTitle}
            lede={copy.howPageLede}
            level={1}
            size="xl"
          />

          {/* Five across is too many columns for the 4-up rail, so this one
              stays two rows on lg and reads vertically below it. */}
          <div className="lg:[&>ol]:grid-cols-5">
            <ProcessJourney steps={steps} />
          </div>

          <p className="mt-12 max-w-xl text-lg font-bold leading-snug text-ink">
            {copy.howClosing}
          </p>

          <Link href={REGISTER_HREF} className={`${BUTTON_STYLES.primary} mt-6`}>
            {copy.ctaRegisterFree}
          </Link>
        </Section>

        <Section tone="soft" bordered>
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <SectionHeading
              eyebrow={copy.simpleEyebrow}
              title={copy.simpleTitle}
              lede={copy.simpleLede}
            />
            <OrderMockup />
          </div>
        </Section>

        <Section>
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
