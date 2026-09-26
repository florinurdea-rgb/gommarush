"use client";

import { useLocale } from "@/components/site/LocaleProvider";
import { Icon } from "@/components/site/icons";

/**
 * The two delivery modes, side by side.
 *
 * The number is the headline because the number is what a shop plans around.
 * Both modes get identical visual weight on purpose: 7 giorni is not the
 * consolation option, it is the one with more choice, and styling it as
 * secondary would undercut the section's actual claim -- which is certainty
 * about the date, not speed.
 */
export function DeliveryModes() {
  const { copy } = useLocale();

  const modes = [
    { icon: "delivery48" as const, title: copy.delivery48Title, body: copy.delivery48Body },
    { icon: "delivery7" as const, title: copy.delivery7Title, body: copy.delivery7Body },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
      {modes.map((mode) => (
        <div
          key={mode.title}
          className="flex items-start gap-4 rounded-2xl border border-steel-soft bg-white p-5 sm:p-6"
        >
          <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-accent-light text-accent">
            <Icon name={mode.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-xl font-extrabold leading-none tracking-[-0.01em] text-ink sm:text-2xl">
              {mode.title}
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{mode.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
