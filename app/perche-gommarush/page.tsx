"use client";

import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Section, SectionHeading } from "@/components/site/Section";
import { ImagePlaceholder } from "@/components/site/ImagePlaceholder";
import { FlowDiagram } from "@/components/site/FlowDiagram";
import { ConversionCta } from "@/components/site/ConversionCta";
import { IconBadge, type IconName } from "@/components/site/icons";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * Perche GommaRush.
 *
 * Goes deeper than the homepage pillars rather than restating them: each
 * reason gets a paragraph that says something the one-line version could not.
 * The homepage says "Consegne chiare"; this page says why a stated time beats
 * an estimate -- because a shop books a customer in around it.
 *
 * The opening line concedes that GommaRush is not the largest distributor in
 * Italy. That is the honest position and a stronger one: the claim being made
 * is ease of working together, and a page that opened by implying scale would
 * be competing on the one axis where it would lose.
 *
 * Alternating text/image rows keep it visual without six more cards.
 */
export default function WhyPage() {
  const { copy } = useLocale();

  const reasons: { icon: IconName; title: string; body: string }[] = [
    { icon: "simple", title: copy.whyPageOrderingTitle, body: copy.whyPageOrderingBody },
    { icon: "price", title: copy.whyPagePriceTitle, body: copy.whyPagePriceBody },
    { icon: "availability", title: copy.whyPageSourcingTitle, body: copy.whyPageSourcingBody },
    { icon: "delivery48", title: copy.whyPageDeliveryTitle, body: copy.whyPageDeliveryBody },
    { icon: "support", title: copy.whyPageSupportTitle, body: copy.whyPageSupportBody },
    { icon: "reliable", title: copy.whyPageLogisticsTitle, body: copy.whyPageLogisticsBody },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader showBack />

      <main className="flex flex-1 flex-col">
        <Section>
          <SectionHeading
            title={copy.whyPageTitle}
            lede={copy.whyPageLede}
            level={1}
            size="xl"
          />
        </Section>

        <Section tone="soft" bordered>
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <dl className="flex flex-col gap-8">
              {reasons.slice(0, 3).map((reason) => (
                <div key={reason.title} className="flex gap-4">
                  <IconBadge name={reason.icon} />
                  <div className="min-w-0">
                    <dt className="text-[17px] font-bold leading-tight text-ink">{reason.title}</dt>
                    <dd className="mt-2 text-[15.5px] leading-relaxed text-ink-soft">
                      {reason.body}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>

            <ImagePlaceholder
              ratio="portrait"
              intent="[IMAGE PLACEHOLDER - Titolare di gommista che riceve una consegna GommaRush: pneumatici appena scaricati, bolla di consegna firmata, officina reale sullo sfondo]"
            />
          </div>
        </Section>

        <Section>
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <ImagePlaceholder
              ratio="portrait"
              intent="[IMAGE PLACEHOLDER - Operativita del deposito GommaRush: pile di pneumatici ordinate per zona, operatore che prepara il giro di consegna, magazzino pulito e organizzato]"
              className="lg:order-first"
            />

            <dl className="flex flex-col gap-8">
              {reasons.slice(3).map((reason) => (
                <div key={reason.title} className="flex gap-4">
                  <IconBadge name={reason.icon} />
                  <div className="min-w-0">
                    <dt className="text-[17px] font-bold leading-tight text-ink">{reason.title}</dt>
                    <dd className="mt-2 text-[15.5px] leading-relaxed text-ink-soft">
                      {reason.body}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>
          </div>
        </Section>

        <Section tone="soft" bordered>
          <SectionHeading
            eyebrow={copy.sourcingEyebrow}
            title={copy.sourcingTitle}
            lede={copy.sourcingBody}
          />
          <div className="mt-10">
            <FlowDiagram
              nodes={[
                { icon: "availability", label: copy.sourcingFlowSuppliers },
                { icon: "depot", label: copy.sourcingFlowUs, emphasis: true },
                { icon: "simple", label: copy.sourcingFlowYou },
              ]}
            />
          </div>
          <p className="mt-6 max-w-2xl text-[14.5px] leading-relaxed text-ink-soft">
            {copy.sourcingNote}
          </p>
        </Section>

        <ConversionCta />
      </main>

      <SiteFooter />
    </div>
  );
}
