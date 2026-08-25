import { notFound } from "next/navigation";
import { PageHeading } from "@/components/logistics/AdminShell";
import { getQuoteRequest } from "@/lib/server/quote-requests";
import { QuoteRequestStatusBadge } from "@/components/quote/QuoteRequestStatusBadge";
import { QuoteRequestActions } from "@/components/quote/QuoteRequestActions";
import { ResendNotificationButton } from "@/components/quote/ResendNotificationButton";
import { describeEmailConfig } from "@/lib/email/send-quote-request";
import { formatTyreSize, type QuoteRequestItemRow } from "@/lib/types/quote-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DELIVERY_LABEL: Record<string, string> = { "24h": "24 ore", "7d": "7 giorni" };

function describeProduct(item: QuoteRequestItemRow): string {
  if (item.product_type === "tyre") return "Pneumatico";
  return item.description?.trim() || "Altro prodotto";
}

function describePreference(item: QuoteRequestItemRow): string {
  if (item.preference_type === "specific_brand") {
    return item.preferred_brand?.trim() || "Marca specifica";
  }
  return "Miglior prezzo";
}

/**
 * Admin detail view for one quote request.
 *
 * Loaded server-side; a missing id renders the framework's not-found rather
 * than an empty shell. The whole route sits inside the (secure) admin layout,
 * so an unauthenticated visitor never reaches it.
 */
export default async function QuoteRequestDetailPage({ params }: { params: { id: string } }) {
  const detail = await getQuoteRequest(params.id);
  if (!detail) notFound();

  const { request, items } = detail;
  // Read server-side; describeEmailConfig never returns a secret value.
  const emailConfig = describeEmailConfig();
  const submitted = new Date(request.created_at).toLocaleString("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  });

  return (
    <>
      <PageHeading
        title={`Richiesta ${request.request_number}`}
        description={request.company_name}
        back
        action={<QuoteRequestStatusBadge status={request.status} size="md" />}
      />

      {!request.notification_email_sent && (
        <div className="mb-5 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">
            La notifica email interna non è stata inviata.
          </p>
          <p className="mt-1 text-sm text-ink">
            La richiesta è salvata correttamente — solo l&rsquo;email di avviso non è partita.
          </p>

          {request.notification_email_error && (
            <p className="mt-2 break-words rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-ink">
              {request.notification_email_error}
            </p>
          )}

          {/* The provider's reason alone doesn't say whether the deployment is
              even configured to send. Showing the resolved configuration next
              to it turns "email didn't arrive" into a specific missing
              variable or a specific rejected address. No secret is rendered —
              only the From/To that every sent mail already carries. */}
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-20 flex-none text-ink-soft">Chiave API</dt>
              <dd className="min-w-0 font-semibold text-ink">
                {!emailConfig.apiKeyPresent
                  ? "non impostata (RESEND_API_KEY)"
                  : emailConfig.apiKeyLooksValid
                    ? "impostata"
                    : "impostata ma non sembra una chiave Resend (attesa: re_…)"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 flex-none text-ink-soft">Mittente</dt>
              <dd className="min-w-0 break-all font-semibold text-ink">
                {emailConfig.from ?? "non impostato (RESEND_FROM_EMAIL)"}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 flex-none text-ink-soft">Destinatario</dt>
              <dd className="min-w-0 break-all font-semibold text-ink">
                {emailConfig.to ?? "non impostato (OFFER_NOTIFICATION_EMAIL)"}
              </dd>
            </div>
          </dl>

          {emailConfig.missing.length > 0 && (
            <p className="mt-2 text-xs text-ink">
              Da impostare su Vercel (Settings → Environment Variables), poi
              rideploy: <span className="font-mono font-bold">{emailConfig.missing.join(", ")}</span>
            </p>
          )}

          <ResendNotificationButton requestId={request.id} />
        </div>
      )}

      <div className="mb-6 rounded-xl border border-ink/10 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink">{request.company_name}</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-ink-soft">Email</dt>
            <dd className="min-w-0 break-all">
              <a href={`mailto:${request.contact_email}`} className="font-semibold text-accent hover:underline">
                {request.contact_email}
              </a>
            </dd>
          </div>
          {request.whatsapp && (
            <div className="flex gap-2">
              <dt className="w-24 flex-none text-ink-soft">WhatsApp</dt>
              <dd className="min-w-0">
                <a
                  href={`https://wa.me/${request.whatsapp.replace(/[^\d]/g, "")}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-semibold text-accent hover:underline"
                >
                  {request.whatsapp}
                </a>
              </dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-ink-soft">Data</dt>
            <dd>{submitted}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-ink-soft">Lingua</dt>
            <dd className="uppercase">{request.language}</dd>
          </div>
        </dl>
      </div>

      <div className="mb-6">
        <QuoteRequestActions requestId={request.id} status={request.status} />
      </div>

      <h2 className="mb-3 text-base font-bold text-ink">Prodotti richiesti ({items.length})</h2>

      {/* Table on wide screens, stacked cards on narrow ones — a 7-column
          table is unusable on a phone. */}
      <div className="hidden overflow-x-auto rounded-xl border border-ink/10 bg-white shadow-card md:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
              <th scope="col" className="px-4 py-3 font-semibold">Prodotto</th>
              <th scope="col" className="px-4 py-3 font-semibold">Dimensione</th>
              <th scope="col" className="px-4 py-3 font-semibold">Indice</th>
              <th scope="col" className="px-4 py-3 font-semibold">Preferenza</th>
              <th scope="col" className="px-4 py-3 font-semibold">Consegna</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Quantità</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/5">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 font-semibold text-ink">{describeProduct(item)}</td>
                <td className="px-4 py-3 font-mono text-ink-soft">
                  {formatTyreSize(item.width, item.profile, item.rim) ?? "—"}
                </td>
                <td className="px-4 py-3 font-mono text-ink-soft">{item.load_speed_index ?? "—"}</td>
                <td className="px-4 py-3 text-ink-soft">{describePreference(item)}</td>
                <td className="px-4 py-3 text-ink-soft">
                  {DELIVERY_LABEL[item.delivery_speed] ?? item.delivery_speed}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-ink">{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-ink/10 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold text-ink">{describeProduct(item)}</div>
                <div className="mt-0.5 font-mono text-sm text-ink-soft">
                  {formatTyreSize(item.width, item.profile, item.rim) ?? "—"}
                  {item.load_speed_index ? ` · ${item.load_speed_index}` : ""}
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="text-xl font-black tabular-nums text-ink">{item.quantity}</div>
                <div className="text-[10px] uppercase text-ink-soft">pz</div>
              </div>
            </div>
            <div className="mt-2 border-t border-ink/5 pt-2 text-xs text-ink-soft">
              {describePreference(item)} · {DELIVERY_LABEL[item.delivery_speed] ?? item.delivery_speed}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
