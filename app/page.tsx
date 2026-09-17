"use client";

import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Hero } from "@/components/site/Hero";
import { ValueStrip } from "@/components/site/ValueStrip";
import { BrandMarquee } from "@/components/site/BrandMarquee";
import { Section, SectionHeading } from "@/components/site/Section";
import { ProcessJourney } from "@/components/site/ProcessJourney";
import { OrderMockup } from "@/components/site/OrderMockup";
import { FlowDiagram } from "@/components/site/FlowDiagram";
import { DeliveryModes } from "@/components/site/DeliveryModes";
import { PillarGrid } from "@/components/site/PillarGrid";
import { ConversionCta } from "@/components/site/ConversionCta";
import { ImagePlaceholder } from "@/components/site/ImagePlaceholder";
import { TyreFinder } from "@/components/site/TyreFinder";
import { IconBadge } from "@/components/site/icons";
import { useLocale } from "@/components/site/LocaleProvider";

/**
 * The public landing page.
 *
 * Section order follows the question a gommista is actually asking, in order:
 * what is this (hero), what do I get (value strip), is ordering really simpler
 * (process + product visual), will you have my size (sourcing), when does it
 * arrive (delivery), what if something goes wrong (support), why you
 * (pillars), who do you carry (brands), sign me up (conversion).
 *
 * Tones alternate white/soft so sections separate without a border on every
 * one, and the ink tone appears exactly once, at the close.
 *
 * Navigation: the marketing nav is in the header from `lg`, and the hamburger
 * is present at every breakpoint because it is the only route to the admin
 * dashboard, the driver area and the language switch.
 */
export default function Landing() {
  const { copy } = useLocale();

  const journeySteps = [
    { icon: "find" as const, label: copy.step1Label, body: copy.step1Body },
    { icon: "choose" as const, label: copy.step2Label, body: copy.step2Body },
    { icon: "order" as const, label: copy.step3Label, body: copy.step3Body },
    { icon: "receive" as const, label: copy.step4Label, body: copy.step4Body },
  ];

  const supportPoints = [
    { icon: "message" as const, text: copy.supportPointMessage },
    { icon: "phone" as const, text: copy.supportPointPhone },
    { icon: "support" as const, text: copy.supportPointPerson },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader />

      <main className="flex flex-1 flex-col">
        <Hero />
        <ValueStrip />

        {/* --- Ordering simplicity: the strongest differentiator --------- */}
        <Section>
          <SectionHeading
            eyebrow={copy.simpleEyebrow}
            title={copy.simpleTitle}
            lede={copy.simpleLede}
            size="xl"
          />

          <ProcessJourney steps={journeySteps} />

          <div className="mt-14 grid items-center gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div>
              <h3 className="text-2xl font-extrabold leading-tight tracking-[-0.015em] text-ink">
                {copy.finderTitle}
              </h3>
              <p className="mt-3 max-w-md text-[16px] leading-relaxed text-ink-soft">
                {copy.finderIntro}
              </p>
              {/* The live catalogue search, kept from the previous homepage and
                  placed at the step where a shop looking up a size actually is. */}
              <div className="mt-6">
                <TyreFinder triggerClassName="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-steel px-5 text-[15px] font-bold text-ink transition-colors hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2" />
              </div>
            </div>

            <OrderMockup />
          </div>
        </Section>

        {/* --- Sourcing proposition -------------------------------------- */}
        <Section tone="soft" bordered>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
            <SectionHeading
              eyebrow={copy.sourcingEyebrow}
              title={copy.sourcingTitle}
              lede={copy.sourcingBody}
            />

            <div className="flex flex-col justify-center">
              <FlowDiagram
                nodes={[
                  { icon: "availability", label: copy.sourcingFlowSuppliers },
                  { icon: "depot", label: copy.sourcingFlowUs, emphasis: true },
                  { icon: "simple", label: copy.sourcingFlowYou },
                ]}
              />
              <p className="mt-6 text-[14.5px] leading-relaxed text-ink-soft">{copy.sourcingNote}</p>
            </div>
          </div>
        </Section>

        {/* --- Delivery certainty ---------------------------------------- */}
        <Section>
          <SectionHeading
            eyebrow={copy.deliveryEyebrow}
            title={copy.deliveryTitle}
            lede={copy.deliveryBody}
            size="xl"
          />

          <div className="mt-12">
            <DeliveryModes />
          </div>

          <div className="mt-10 border-t border-steel-soft pt-10">
            <FlowDiagram
              nodes={[
                { icon: "availability", label: copy.deliveryFlowSupply },
                { icon: "depot", label: copy.deliveryFlowDepot, emphasis: true },
                { icon: "receive", label: copy.deliveryFlowShop },
              ]}
            />
          </div>
        </Section>

        {/* --- Human support -------------------------------------------- */}
        <Section tone="soft" bordered>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <ImagePlaceholder
              ratio="wide"
              intent="[IMAGE PLACEHOLDER - Interazione reale fra il team GommaRush e un gommista: due persone che parlano al banco dell'officina o accanto al furgone, documento di consegna in mano, tono cordiale e professionale]"
            />

            <div>
              <SectionHeading
                eyebrow={copy.supportEyebrow}
                title={copy.supportTitle}
                lede={copy.supportBody}
              />

              <ul className="mt-8 flex flex-col gap-4">
                {supportPoints.map((point) => (
                  <li key={point.text} className="flex items-center gap-3.5">
                    <IconBadge name={point.icon} />
                    <span className="text-[15.5px] font-medium leading-snug text-ink">
                      {point.text}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* --- Why GommaRush ------------------------------------------- */}
        <Section>
          <SectionHeading eyebrow={copy.pillarsEyebrow} title={copy.pillarsTitle} size="xl" />
          <PillarGrid />
        </Section>

        <BrandMarquee />

        <ConversionCta />
      </main>

      <SiteFooter />
    </div>
  );
}
