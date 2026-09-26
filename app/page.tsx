"use client";

import Link from "next/link";
import { GlobalHeader } from "@/components/site/GlobalHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Section, SectionHeading, BUTTON_STYLES } from "@/components/site/Section";
import { FlowDiagram } from "@/components/site/FlowDiagram";
import { Icon, IconBadge, type IconName } from "@/components/site/icons";
import { useLocale } from "@/components/site/LocaleProvider";
import { CUSTOMER_ROUTES, ROUTES } from "@/lib/site-routes";

const heroVanFleet = "/images/hero-van-fleet.webp";

/**
 * The public landing page, for Italian tyre shops.
 *
 * ONE PRODUCT, ONE PRIMARY ACTION. The customer area is where a gommista
 * actually buys from GommaRush, so "Area clienti" is the primary CTA in the
 * hero, the portal section and the close — and the header carries it at every
 * width. Registration is not open, so it is never a primary action here; the
 * quote form is the honest secondary route for anyone without an account.
 *
 * NOTHING ON THIS PAGE IS INVENTED. No tyre photographs, no brand logos, no
 * prices, no stock, no customer numbers, no testimonials, no service area.
 * Every statement maps to implemented behaviour — see the note on the `lp*`
 * keys in src/lib/i18n/site-content.ts. The only illustration of the product
 * is the size-search control itself, labelled as an example, carrying a size
 * and no result.
 *
 * Copy lives in the locale object, never in this file, so Italian stays the
 * source and English follows it key for key.
 */
export default function Landing() {
  const { copy } = useLocale();

  const facts: { icon: IconName; text: string }[] = [
    { icon: "delivery7", text: copy.lpFactStandard },
    { icon: "delivery48", text: copy.lpFactExpress },
    { icon: "price", text: copy.lpFactPrice },
  ];

  const steps: { icon: IconName; title: string; body: string }[] = [
    { icon: "find", title: copy.lpHow1Title, body: copy.lpHow1Body },
    { icon: "availability", title: copy.lpHow2Title, body: copy.lpHow2Body },
    { icon: "receive", title: copy.lpHow3Title, body: copy.lpHow3Body },
  ];

  const reasons: { icon: IconName; title: string; body: string }[] = [
    { icon: "simple", title: copy.lpWhySimpleTitle, body: copy.lpWhySimpleBody },
    { icon: "price", title: copy.lpWhyPriceTitle, body: copy.lpWhyPriceBody },
    { icon: "depot", title: copy.lpWhyDeliveryTitle, body: copy.lpWhyDeliveryBody },
    { icon: "support", title: copy.lpWhySupportTitle, body: copy.lpWhySupportBody },
    { icon: "orders", title: copy.lpWhyVisibilityTitle, body: copy.lpWhyVisibilityBody },
  ];

  const capabilities = [
    copy.lpPortalCap1,
    copy.lpPortalCap2,
    copy.lpPortalCap3,
    copy.lpPortalCap4,
    copy.lpPortalCap5,
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <GlobalHeader />

      <main className="flex flex-1 flex-col">
        {/* ---- 1. HERO --------------------------------------------------
            Copy first in the DOM so a phone reads the proposition and reaches
            both CTAs before the photograph. Height comes from content. */}
        <section className="border-b border-steel-soft bg-white">
          <div className="mx-auto grid w-full max-w-shell items-center gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[1.1fr_1fr] lg:gap-14 lg:px-8 lg:py-20">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-accent">
                {copy.lpHeroEyebrow}
              </p>
              <h1 className="mt-3 text-balance text-[2rem] font-extrabold leading-[1.08] tracking-[-0.025em] text-ink sm:text-5xl lg:text-[3.25rem]">
                {copy.lpHeroTitle}
              </h1>
              <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-soft">
                {copy.lpHeroBody}
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href={CUSTOMER_ROUTES.account} className={BUTTON_STYLES.primary}>
                  {copy.navClientArea}
                </Link>
                <Link href={ROUTES.quote} className={BUTTON_STYLES.secondary}>
                  {copy.navQuote}
                </Link>
              </div>
              <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-ink-soft">
                {copy.lpHeroAccessNote}
              </p>

              <ul className="mt-7 grid gap-2 border-t border-steel-soft pt-5 sm:grid-cols-3 sm:gap-4">
                {facts.map((fact) => (
                  <li key={fact.text} className="flex items-start gap-2 text-[14px] font-semibold leading-snug text-ink">
                    <Icon name={fact.icon} className="mt-0.5 h-4 w-4 flex-none text-accent" />
                    {fact.text}
                  </li>
                ))}
              </ul>
            </div>

            {/* The real branded fleet photograph the site already ships. */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-steel-soft bg-surface-soft">
              <img
                src={heroVanFleet}
                alt={copy.heroImageAlt}
                width={1600}
                height={1200}
                decoding="async"
                fetchPriority="high"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
          </div>
        </section>

        {/* ---- 2. HOW GOMMARUSH HELPS ------------------------------------ */}
        <Section>
          <SectionHeading eyebrow={copy.lpHowEyebrow} title={copy.lpHowTitle} />
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-steel-soft bg-white p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <IconBadge name={step.icon} />
                  <span className="text-[13px] font-bold tabular-nums text-ink-soft">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-extrabold text-ink">{step.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---- 3. CUSTOMER ACCOUNT — the core of the proposition --------- */}
        <Section tone="soft" bordered id="area-clienti" aria-labelledby="lp-portal-title">
          <div className="grid items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
            <div>
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-accent">
                {copy.lpPortalEyebrow}
              </p>
              <h2
                id="lp-portal-title"
                className="mt-3 text-balance text-3xl font-extrabold leading-[1.1] tracking-[-0.02em] text-ink sm:text-4xl"
              >
                {copy.lpPortalTitle}
              </h2>
              <p className="mt-4 text-[17px] leading-relaxed text-ink-soft">{copy.lpPortalLede}</p>
              <ul className="mt-6 space-y-3">
                {capabilities.map((capability) => (
                  <li key={capability} className="flex items-start gap-3 text-[15.5px] text-ink">
                    <Icon name="check" className="mt-0.5 h-5 w-5 flex-none text-accent" />
                    {capability}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link href={CUSTOMER_ROUTES.account} className={BUTTON_STYLES.primary}>
                  {copy.navClientArea}
                </Link>
              </div>
            </div>

            {/*
              The one product illustration: the size-search control, as the
              portal draws it — three labelled selectors and a search action,
              carrying a size and NO result. Labelled as an example.
            */}
            <figure className="rounded-2xl border border-steel-soft bg-white p-5 sm:p-6">
              <div className="grid grid-cols-3 gap-2">
                {[
                  [copy.lpPortalWidth, "205"],
                  [copy.lpPortalAspect, "55"],
                  [copy.lpPortalRim, "R16"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                      {label}
                    </span>
                    <span className="mt-1 flex h-11 items-center rounded-xl border border-ink/15 bg-white px-3 text-base font-semibold text-ink">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
              <span className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-bold text-white">
                <Icon name="find" className="h-4 w-4" />
                {copy.lpPortalSearch}
              </span>
              <figcaption className="mt-3 text-[12.5px] text-ink-soft">{copy.lpPortalExampleCaption}</figcaption>
            </figure>
          </div>
        </Section>

        {/* ---- 4. WHY GOMMARUSH ------------------------------------------ */}
        <Section>
          <SectionHeading eyebrow={copy.lpWhyEyebrow} title={copy.lpWhyTitle} />
          <ul className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {reasons.map((reason) => (
              <li key={reason.title} className="flex gap-4">
                <IconBadge name={reason.icon} />
                <div>
                  <h3 className="text-[16px] font-extrabold text-ink">{reason.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{reason.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---- 5. DELIVERY / OPERATION ----------------------------------- */}
        <Section tone="soft" bordered>
          <SectionHeading
            eyebrow={copy.lpDeliveryEyebrow}
            title={copy.lpDeliveryTitle}
            lede={copy.lpDeliveryLede}
          />
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {[
              { icon: "delivery7" as const, title: copy.lpDeliveryStandardTitle, body: copy.lpDeliveryStandardBody },
              { icon: "delivery48" as const, title: copy.lpDeliveryExpressTitle, body: copy.lpDeliveryExpressBody },
            ].map((mode) => (
              <div key={mode.title} className="flex gap-4 rounded-2xl border border-steel-soft bg-white p-5 sm:p-6">
                <IconBadge name={mode.icon} />
                <div>
                  <h3 className="text-[17px] font-extrabold text-ink">{mode.title}</h3>
                  <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{mode.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <FlowDiagram
              nodes={[
                { icon: "availability", label: copy.deliveryFlowSupply },
                { icon: "depot", label: copy.deliveryFlowDepot, emphasis: true },
                { icon: "receive", label: copy.lpDeliveryFlowShop },
              ]}
            />
          </div>
        </Section>

        {/* ---- 6. HUMAN SALES ROUTE --------------------------------------- */}
        <Section compact>
          <div className="flex flex-col gap-6 rounded-2xl border border-steel-soft p-6 sm:p-8 md:flex-row md:items-center md:justify-between">
            <div className="max-w-xl">
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-accent">
                {copy.lpOfferEyebrow}
              </p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.015em] text-ink sm:text-3xl">
                {copy.lpOfferTitle}
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">{copy.lpOfferBody}</p>
            </div>
            <Link href={ROUTES.quote} className={`${BUTTON_STYLES.secondary} flex-none`}>
              {copy.navQuote}
            </Link>
          </div>
        </Section>

        {/* ---- 7. FINAL CTA ------------------------------------------------ */}
        <section className="bg-ink text-white">
          <div className="mx-auto flex w-full max-w-shell flex-col gap-6 px-4 py-12 sm:px-6 sm:py-16 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="max-w-2xl">
              <h2 className="text-balance text-3xl font-extrabold leading-tight tracking-[-0.02em] sm:text-4xl">
                {copy.lpFinalTitle}
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-white/75">{copy.lpFinalBody}</p>
            </div>
            <div className="flex flex-none flex-col gap-3 sm:flex-row">
              <Link href={CUSTOMER_ROUTES.account} className={BUTTON_STYLES.onInk}>
                {copy.navClientArea}
              </Link>
              <Link href={ROUTES.quote} className={BUTTON_STYLES.ghostOnInk}>
                {copy.navQuote}
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
