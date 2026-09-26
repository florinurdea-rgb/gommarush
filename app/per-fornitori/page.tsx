"use client";

import Link from "next/link";
import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Section, BUTTON_STYLES } from "@/components/site/Section";
import { ImagePlaceholder } from "@/components/site/ImagePlaceholder";
import { FlowDiagram } from "@/components/site/FlowDiagram";
import { IconBadge, type IconName } from "@/components/site/icons";
import { useLocale } from "@/components/site/LocaleProvider";
import { ROUTES } from "@/lib/site-routes";

/**
 * Per fornitori.
 *
 * Suppliers are the secondary audience, and this page is built not to compete
 * with the gommista journey: it is reachable from the nav and the footer, it
 * carries no "Registrati" CTA, and its only action is "Parliamo" pointing at
 * the existing quote/contact route. No supplier onboarding is invented,
 * because none exists.
 *
 * The ink hero is the one place besides the homepage close where that tone is
 * used, and it earns it here by signalling immediately that this page is for a
 * different reader.
 */
export default function SuppliersPage() {
  const { copy } = useLocale();

  const points: { icon: IconName; title: string; body: string }[] = [
    { icon: "reliable", title: copy.supPointHandlingTitle, body: copy.supPointHandlingBody },
    { icon: "depot", title: copy.supPointDepotTitle, body: copy.supPointDepotBody },
    { icon: "receive", title: copy.supPointLastMileTitle, body: copy.supPointLastMileBody },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader showBack />

      <main className="flex flex-1 flex-col">
        <Section tone="ink">
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div>
              <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-[-0.025em] text-white sm:text-5xl">
                {copy.supPageTitle}
              </h1>
              <p className="mt-4 text-xl font-bold leading-snug text-accent-light sm:text-2xl">
                {copy.supPageLede}
              </p>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-white/75">
                {copy.supPageBody}
              </p>
              <Link href={ROUTES.quote} className={`${BUTTON_STYLES.onInk} mt-8`}>
                {copy.ctaTalk}
              </Link>
            </div>

            <div>
              <FlowDiagram
                tone="light"
                nodes={[
                  { icon: "availability", label: copy.supFlowSupplier },
                  { icon: "depot", label: copy.supFlowUs, emphasis: true },
                  { icon: "receive", label: copy.supFlowCustomer },
                ]}
              />
            </div>
          </div>
        </Section>

        <Section>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <dl className="flex flex-col gap-8">
              {points.map((point) => (
                <div key={point.title} className="flex gap-4">
                  <IconBadge name={point.icon} />
                  <div className="min-w-0">
                    <dt className="text-[17px] font-bold leading-tight text-ink">{point.title}</dt>
                    <dd className="mt-2 text-[15.5px] leading-relaxed text-ink-soft">
                      {point.body}
                    </dd>
                  </div>
                </div>
              ))}
            </dl>

            <ImagePlaceholder
              ratio="wide"
              intent="[IMAGE PLACEHOLDER - Logistica GommaRush lato fornitore: carico di pneumatici da un deposito fornitore sul furgone GommaRush, operatori al lavoro, mezzo con portellone aperto]"
            />
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
