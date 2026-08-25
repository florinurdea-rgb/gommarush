import Link from "next/link";
import { PageHeading } from "@/components/logistics/AdminShell";
import { listQuoteRequests } from "@/lib/server/quote-requests";
import { QuoteRequestStatusBadge } from "@/components/quote/QuoteRequestStatusBadge";
import { describeEmailConfig } from "@/lib/email/send-quote-request";

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

/**
 * Admin list of customer quote requests, newest first.
 *
 * Server-rendered from Supabase through the service-role client, so no
 * customer contact data is shipped to the public bundle and the query never
 * runs in the browser. Row-level access is protected by the (secure) layout's
 * admin session gate.
 */
export default async function QuoteRequestsPage() {
  const { rows, total } = await listQuoteRequests({ limit: 100 });
  const newCount = rows.filter((row) => row.status === "new").length;
  const emailConfig = describeEmailConfig();

  return (
    <>
      <PageHeading
        title="Richieste di offerta"
        description={
          total === 0
            ? "Le richieste inviate dal sito appariranno qui."
            : `${total} richieste · ${newCount} da gestire`
        }
      />

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
            RESEND_API_KEY non sembra una chiave Resend valida (attesa: <span className="font-mono">re_…</span>).
          </p>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">Nessuna richiesta di offerta</p>
          <p className="mt-1 text-sm text-ink-soft">
            Le nuove richieste inviate dal sito appariranno qui.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-card">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
                <th scope="col" className="px-4 py-3 font-semibold">Richiesta</th>
                <th scope="col" className="px-4 py-3 font-semibold">Cliente</th>
                <th scope="col" className="px-4 py-3 font-semibold">Articoli</th>
                <th scope="col" className="px-4 py-3 font-semibold">Data</th>
                <th scope="col" className="px-4 py-3 font-semibold">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-surface-soft/60 ${
                    row.status === "new" ? "bg-state-warning-soft/25" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/richieste-offerta/${row.id}`}
                      className="font-mono font-bold text-accent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {row.request_number}
                    </Link>
                    {!row.notification_email_sent && (
                      <span
                        title={row.notification_email_error ?? "Notifica email non inviata"}
                        className="ml-2 inline-flex items-center rounded bg-state-danger-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-state-danger"
                      >
                        Email KO
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/richieste-offerta/${row.id}`}
                      className="font-semibold text-ink hover:text-accent"
                    >
                      {row.company_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-soft">{row.item_count}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{formatDateTime(row.created_at)}</td>
                  <td className="px-4 py-3">
                    <QuoteRequestStatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
