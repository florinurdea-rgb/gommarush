"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  DELIVERY_LABELS,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUSES,
  QUOTE_REQUEST_STATUSES,
  QUOTE_STATUS_LABELS,
} from "@/lib/types/quote-request";

/**
 * Filter bar for the request list.
 *
 * Filters live in the URL, not in component state. That means a filtered
 * view is shareable and survives a refresh, and — more importantly — the
 * filtering happens in Postgres on the next server render rather than by
 * shipping every row to the browser and hiding some of them.
 *
 * The search box debounces so typing doesn't fire a query per keystroke,
 * and pushes with `scroll: false` so the page doesn't jump under the cursor.
 */

const DEBOUNCE_MS = 350;

export function QuoteRequestFilters({ total }: { total: number }) {
  const router = useRouter();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const debounceRef = useRef<number | null>(null);
  // Skip the debounce effect on first mount, or landing on ?q=… would
  // immediately re-push the same URL.
  const mounted = useRef(false);

  function apply(next: Record<string, string | null>) {
    const query = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") query.delete(key);
      else query.set(key, value);
    }
    // Any filter change invalidates the current page number.
    if (!("page" in next)) query.delete("page");
    const qs = query.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  }

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      apply({ q: search.trim() || null });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // `apply` closes over the current params; re-creating it each render is
    // fine and cheaper than memoising it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = ["status", "notification", "delivery", "q", "from", "to"].some((key) =>
    params.get(key)
  );

  const selectClass =
    "min-h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="mb-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <label htmlFor="quote-search" className="sr-only">
            Cerca per riferimento, cliente o email
          </label>
          <input
            id="quote-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca riferimento, cliente o email…"
            className="min-h-11 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink placeholder:text-ink-soft/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>

        <label className="contents">
          <span className="sr-only">Filtra per stato</span>
          <select
            value={params.get("status") ?? ""}
            onChange={(event) => apply({ status: event.target.value || null })}
            className={selectClass}
          >
            <option value="">Tutti gli stati</option>
            {QUOTE_REQUEST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {QUOTE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="contents">
          <span className="sr-only">Filtra per stato notifica</span>
          <select
            value={params.get("notification") ?? ""}
            onChange={(event) => apply({ notification: event.target.value || null })}
            className={selectClass}
          >
            <option value="">Tutte le notifiche</option>
            {NOTIFICATION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {NOTIFICATION_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>

        <label className="contents">
          <span className="sr-only">Filtra per consegna</span>
          <select
            value={params.get("delivery") ?? ""}
            onChange={(event) => apply({ delivery: event.target.value || null })}
            className={selectClass}
          >
            <option value="">Tutte le consegne</option>
            <option value="24h">{DELIVERY_LABELS["24h"]}</option>
            <option value="7d">{DELIVERY_LABELS["7d"]}</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <label className="flex items-center gap-2">
          Dal
          <input
            type="date"
            value={params.get("from") ?? ""}
            onChange={(event) => apply({ from: event.target.value || null })}
            className={selectClass}
          />
        </label>
        <label className="flex items-center gap-2">
          al
          <input
            type="date"
            value={params.get("to") ?? ""}
            onChange={(event) => apply({ to: event.target.value || null })}
            className={selectClass}
          />
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              router.push("?", { scroll: false });
            }}
            className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Azzera filtri
          </button>
        )}

        <span className="ml-auto tabular-nums">
          {total} {total === 1 ? "richiesta" : "richieste"}
        </span>
      </div>
    </div>
  );
}
