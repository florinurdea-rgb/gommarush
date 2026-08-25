import Link from "next/link";
import { PageHeading } from "@/components/logistics/AdminShell";
import { listQuoteRequests } from "@/lib/server/quote-requests";
import { getBusinessMetrics } from "@/lib/server/quote-metrics";
import {
  NotificationStatusBadge,
  QuoteRequestStatusBadge,
} from "@/components/quote/QuoteRequestStatusBadge";
import { QuoteRequestFilters } from "@/components/quote/QuoteRequestFilters";
import { DashboardLiveRefresh } from "@/components/logistics/DashboardLiveRefresh";
import { describeEmailConfig } from "@/lib/email/send-quote-request";
import { listQuoteRequestsQuerySchema } from "@/lib/validation/quote-request";
import { DELIVERY_LABELS } from "@/lib/types/quote-request";

// Always fresh: a request submitted seconds ago must appear on the next
// load, never a cached page from before it existed.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Richieste di offerta" };

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Rome",
  });
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-card">
      <div className="text-2xl font-black tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </div>
    </div>
  );
}

/**
 * Admin list of customer quote requests, newest first.
 *
 * Server-rendered from Supabase through the service-role client, so no
 * customer contact data is shipped to the public bundle and the query never
 * runs in the browser. Row-level access is protected by the (secure)
 * layout's admin session gate.
 *
 * Filtering, searching and paging all happen in Postgres — the browser
 * receives one page of rows, never the table. `DashboardLiveRefresh`
 * subscribes to the same 'gorush-ops' broadcast the delivery board uses, so
 * a request submitted on the website appears here without a manual reload,
 * and the filter state (which lives in the URL) survives that refresh.
 */
export default async function QuoteRequestsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  // Hand-editable URL: anything unparseable falls back to defaults rather
  // than erroring the page.
  const parsed = listQuoteRequestsQuerySchema.safeParse(searchParams);
  const filters = parsed.success ? parsed.data : {};

  const [result, metrics] = await Promise.all([
    listQuoteRequests({
      page: filters.page ?? 1,
      perPage: filters.perPage ?? 25,
      status: filters.status ?? null,
      notification: filters.notification ?? null,
      delivery: filters.delivery ?? null,
      search: filters.q ?? null,
      from: filters.from ?? null,
      to: filters.to ?? null,
    }),
    getBusinessMetrics("30d"),
  ]);

  const { rows, total, page, pageCount } = result;
  const emailConfig = describeEmailConfig();

  function pageHref(next: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (typeof value === "string" && value) query.set(key, value);
    }
    query.set("page", String(next));
    return `?${query.toString()}`;
  }

  return (
    <>
      <DashboardLiveRefresh />

      <PageHeading
        title="Richieste di offerta"
        description="Richieste inviate dal sito pubblico."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Nuove (30gg)" value={metrics.newRequests} />
        <Metric label="Da elaborare" value={metrics.toProcess} />
        <Metric label="Offerte inviate" value={metrics.offersSent} />
        <Metric label="Accettate" value={metrics.accepted} />
      </div>

      {/* Surfaced at the top of the list, not only inside a failed request:
          if the deployment can't send at all, that's true of every future
          request too, and it should be visible before anyone wonders why no
          notification arrived. */}
      {!emailConfig.configured && (
        <div className="mb-5 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">
            Le notifiche email non sono configurate.
          </p>
          <p className="mt-1 text-sm text-ink">
            Le richieste continuano a essere salvate e visibili qui, ma nessuna email di avviso
            viene inviata. Variabili mancanti su Vercel:{" "}
            <span className="font-mono font-bold">{emailConfig.missing.join(", ")}</span> — aggiungile
            in Settings → Environment Variables e rideploya.
          </p>
        </div>
      )}

      {emailConfig.configured && emailConfig.apiKeyPresent && !emailConfig.apiKeyLooksValid && (
        <div className="mb-5 rounded-xl border border-state-warning/40 bg-state-warning-soft p-4">
          <p className="text-sm font-bold text-ink">
            RESEND_API_KEY non sembra una chiave Resend valida (attesa:{" "}
            <span className="font-mono">re_…</span>).
          </p>
        </div>
      )}

      <QuoteRequestFilters total={total} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">Nessuna richiesta trovata</p>
          <p className="mt-1 text-sm text-ink-soft">
            {total === 0
              ? "Le nuove richieste inviate dal sito appariranno qui."
              : "Nessun risultato per questi filtri. Prova ad azzerarli."}
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-card">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
                  <th scope="col" className="px-4 py-3 font-semibold">Riferimento</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Data</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Articoli</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Consegna</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Stato</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/5">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`transition-colors hover:bg-surface-soft/60 ${
                      row.status === "submitted" ? "bg-state-warning-soft/25" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/richieste-offerta/${row.id}`}
                        className="font-mono font-bold text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        {row.public_reference}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/richieste-offerta/${row.id}`}
                        className="font-semibold text-ink hover:text-accent"
                      >
                        {row.company_name}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 text-ink-soft">
                      <a href={`mailto:${row.contact_email}`} className="hover:text-accent">
                        {row.contact_email}
                      </a>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-ink-soft">{row.item_count}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {row.delivery_preference ? DELIVERY_LABELS[row.delivery_preference] : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <QuoteRequestStatusBadge status={row.status} />
                    </td>
                    <td className="px-4 py-3">
                      <NotificationStatusBadge
                        status={row.notification_status}
                        title={row.last_notification_error}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav
              aria-label="Paginazione richieste"
              className="mt-4 flex items-center justify-between gap-3 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="min-h-11 rounded-lg border border-ink/15 px-4 py-2 font-semibold text-ink hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  ← Precedente
                </Link>
              ) : (
                <span />
              )}

              <span className="text-ink-soft tabular-nums">
                Pagina {page} di {pageCount}
              </span>

              {page < pageCount ? (
                <Link
                  href={pageHref(page + 1)}
                  className="min-h-11 rounded-lg border border-ink/15 px-4 py-2 font-semibold text-ink hover:border-accent hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  Successiva →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
