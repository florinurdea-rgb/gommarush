"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTr } from "@/lib/i18n/tr";
import {
  QUOTE_GROUPS,
  QUOTE_GROUP_LABELS,
  type QuoteRequestGroup,
} from "@/lib/types/quote-request";

/**
 * The three working tabs over the request list.
 *
 * The active tab lives in the URL, so a tab is shareable, survives a
 * refresh, and — importantly — the filtering happens in Postgres on the
 * next server render rather than by hiding rows in the browser.
 *
 * A tab is purely derived from a request's status. Moving a request to
 * "Inviata" moves it out of "Da rispondere" and into "Offerta inviata" on
 * the next render with nothing to keep in sync, because there is no second
 * field that could disagree with the status.
 */
export function QuoteRequestTabs({
  active,
  counts,
}: {
  active: QuoteRequestGroup;
  counts: Record<QuoteRequestGroup, number>;
}) {
  const tr = useTr();
  const params = useSearchParams();

  function hrefFor(group: QuoteRequestGroup): string {
    const query = new URLSearchParams(params.toString());
    query.set("tab", group);
    // Switching tabs invalidates the page and any status filter chosen
    // inside the previous one.
    query.delete("page");
    query.delete("status");
    return `?${query.toString()}`;
  }

  return (
    <div
      role="tablist"
      aria-label={tr("Richieste di offerta")}
      className="mb-4 flex gap-1 overflow-x-auto border-b border-ink/10"
    >
      {QUOTE_GROUPS.map((group) => {
        const selected = group === active;
        return (
          <Link
            key={group}
            href={hrefFor(group)}
            role="tab"
            aria-selected={selected}
            scroll={false}
            className={`-mb-px flex flex-none items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              selected
                ? "border-accent text-accent-dark"
                : "border-transparent text-ink-soft hover:border-ink/20 hover:text-ink"
            }`}
          >
            {tr(QUOTE_GROUP_LABELS[group])}
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                selected ? "bg-accent-light text-accent-dark" : "bg-surface-soft text-ink-soft"
              }`}
            >
              {counts[group]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
