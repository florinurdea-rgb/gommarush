"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { Icon, type IconName } from "@/components/site/icons";

/**
 * The six reasons, as a divided list rather than six cards.
 *
 * Six bordered cards is the default answer and the wrong one: it gives equal
 * visual weight to six things while making the page feel like a feature
 * inventory. Hairline dividers on a single surface keep it as one statement,
 * and the small icon does the scanning work a card was being used for.
 *
 * Three columns at `lg`, two at `sm`, one below -- with the dividers switching
 * from rows to a grid so no item ever carries a stray border on the edge of
 * its row.
 */
export function PillarGrid() {
  const { copy } = useLocale();

  const pillars: { icon: IconName; title: string; body: string }[] = [
    { icon: "simple", title: copy.pillarSimpleTitle, body: copy.pillarSimpleBody },
    { icon: "price", title: copy.pillarPriceTitle, body: copy.pillarPriceBody },
    { icon: "availability", title: copy.pillarAvailabilityTitle, body: copy.pillarAvailabilityBody },
    { icon: "receive", title: copy.pillarDeliveryTitle, body: copy.pillarDeliveryBody },
    { icon: "support", title: copy.pillarSupportTitle, body: copy.pillarSupportBody },
    { icon: "reliable", title: copy.pillarPartnerTitle, body: copy.pillarPartnerBody },
  ];

  return (
    <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-steel-soft bg-steel-soft sm:grid-cols-2 lg:grid-cols-3">
      {pillars.map((pillar) => (
        <li key={pillar.title} className="bg-white p-5 sm:p-6">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent-light text-accent">
            <Icon name={pillar.icon} className="h-[1.05rem] w-[1.05rem]" />
          </span>
          <h3 className="mt-4 text-[16px] font-bold leading-tight text-ink">{pillar.title}</h3>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{pillar.body}</p>
        </li>
      ))}
    </ul>
  );
}
