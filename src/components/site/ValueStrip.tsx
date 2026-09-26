"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { Section } from "@/components/site/Section";
import { Icon, type IconName } from "@/components/site/icons";

/**
 * The four-point proposition, immediately under the hero.
 *
 * This is the most-scanned element on the page and the least read, so it is
 * built to be understood without reading: a number or a short noun first, the
 * qualifier second, an icon to anchor it. Four items, no cards, no shadows --
 * dividers do the separating, which keeps the strip feeling like one object
 * rather than four competing tiles.
 *
 * 2x2 on phones and 4-up from `sm`, because four columns at 375px gives each
 * item about 80px and the numbers stop being legible.
 */
export function ValueStrip() {
  const { copy } = useLocale();

  const points: { icon: IconName; title: string; body: string }[] = [
    { icon: "delivery48", title: copy.value48Title, body: copy.value48Body },
    { icon: "delivery7", title: copy.value7Title, body: copy.value7Body },
    { icon: "price", title: copy.valuePriceTitle, body: copy.valuePriceBody },
    { icon: "support", title: copy.valueSupportTitle, body: copy.valueSupportBody },
  ];

  return (
    <Section tone="soft" bordered compact aria-labelledby="value-strip-title">
      <h2 id="value-strip-title" className="sr-only">
        {copy.valueStripTitle}
      </h2>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4 sm:gap-x-8">
        {points.map((point, index) => (
          <div
            key={point.title}
            className={
              // Vertical rules between columns, but never on the first item of
              // a row -- and the row boundary differs between the 2-up and
              // 4-up layouts, hence the two rules.
              index % 2 === 0
                ? "sm:border-l sm:border-steel-soft sm:pl-6 lg:pl-8"
                : "border-l border-steel-soft pl-6 lg:pl-8"
            }
          >
            <div className="flex items-center gap-2 text-accent">
              <Icon name={point.icon} className="h-[1.1rem] w-[1.1rem]" />
            </div>
            <dt className="mt-3 text-2xl font-extrabold leading-none tracking-[-0.02em] text-ink sm:text-[1.75rem]">
              {point.title}
            </dt>
            <dd className="mt-1.5 text-[14px] font-medium leading-snug text-ink-soft">
              {point.body}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
