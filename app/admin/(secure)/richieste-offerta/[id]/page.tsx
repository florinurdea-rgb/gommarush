import { notFound } from "next/navigation";
import { PageHeading } from "@/components/logistics/AdminShell";
import { getQuoteRequest } from "@/lib/server/quote-requests";
import {
  NotificationStatusBadge,
  QuoteRequestStatusBadge,
} from "@/components/quote/QuoteRequestStatusBadge";
import { QuoteRequestActions } from "@/components/quote/QuoteRequestActions";
import { ResendNotificationButton } from "@/components/quote/ResendNotificationButton";
import { describeEmailConfig } from "@/lib/email/send-quote-request";
import { getTr } from "@/lib/i18n/tr-server";
import {
  DELIVERY_LABELS,
  SEASON_LABELS,
  formatTyreSize,
  type QuoteRequestItemRow,
} from "@/lib/types/quote-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function describeProduct(item: QuoteRequestItemRow): string {
  const tr = getTr();
  if (item.product_type === "tyre") return "Pneumatico";
  return item.description?.trim() || tr("Altro prodotto");
}

function describePreference(item: QuoteRequestItemRow): string {
  const tr = getTr();
  if (item.preference_type === "specific_brand") {
    return item.preferred_brand?.trim() || tr("Marca specifica");
  }
  return tr("Miglior prezzo");
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  });
}

/**
 * Admin detail view for one quote request.
 *
 * Loaded server-side; a missing id renders the framework's not-found rather
 * than an empty shell. The whole route sits inside the (secure) admin layout,
 * so an unauthenticated visitor never reaches it.
 */
export default async function QuoteRequestDetailPage({ params }: { params: { id: string } }) {
  const tr = getTr();
  const detail = await getQuoteRequest(params.id, { withEvents: true });
  if (!detail) notFound();

  const { request, items, events = [] } = detail;
  // Read server-side; describeEmailConfig never returns a secret value.
  const emailConfig = describeEmailConfig();
  const notificationFailed = request.notification_status === "failed";
  const notificationPending =
    request.notification_status === "pending" || request.notification_status === "sending";

  return (
    <>
      <PageHeading
        title={request.public_reference}
        description={request.company_name}
        back
        action={<QuoteRequestStatusBadge status={request.status} size="md" />}
      />

      {(notificationFailed || notificationPending) && (
        <div
          className={`mb-5 rounded-xl border p-4 ${
            notificationFailed
              ? "border-state-danger/40 bg-state-danger-soft"
              : "border-ink/15 bg-surface-soft"
          }`}
        >
          <p
            className={`text-sm font-bold ${
              notificationFailed ? "text-state-danger" : "text-ink"
            }`}
          >
            {notificationFailed
              ? tr("La notifica email interna non è stata inviata.")
              : tr("La notifica email interna non è ancora partita.")}
          </p>
          <p className="mt-1 text-sm text-ink">
            La richiesta è salvata correttamente — solo l&rsquo;email di avviso non è partita.
          </p>

          {request.last_notification_error && (
            <p className="mt-2 break-words rounded-lg bg-white/70 px-3 py-2 font-mono text-xs text-ink">
              {request.last_notification_error}
            </p>
          )}

          {/* The provider's reason alone doesn't say whether the deployment is
              even configured to send. Showing the resolved configuration next
              to it turns "email didn't arrive" into a specific missing
              variable or a specific rejected address. No secret is rendered —
              only the From/To that every sent mail already carries. */}
          <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="w-20 flex-none text-ink-soft">{tr("Chiave API")}</dt>
              <dd className="min-w-0 font-semibold text-ink">
                {!emailConfig.apiKeyPresent
                  ? tr("non impostata (RESEND_API_KEY)")
                  : emailConfig.apiKeyLooksValid
                    ? tr("impostata")
                    : tr("impostata ma non sembra una chiave Resend (attesa: re_…)")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 flex-none text-ink-soft">{tr("Mittente")}</dt>
              <dd className="min-w-0 break-all font-semibold text-ink">
                {emailConfig.from ?? tr("non impostato (RESEND_FROM_EMAIL)")}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 flex-none text-ink-soft">{tr("Destinatario")}</dt>
              <dd className="min-w-0 break-all font-semibold text-ink">
                {emailConfig.to ?? tr("non impostato (OFFER_NOTIFICATION_EMAIL)")}
              </dd>
            </div>
          </dl>

          {emailConfig.missing.length > 0 && (
            <p className="mt-2 text-xs text-ink">
              Da impostare su Vercel (Settings → Environment Variables), poi rideploya:{" "}
              <span className="font-mono font-bold">{emailConfig.missing.join(", ")}</span>
            </p>
          )}

          <ResendNotificationButton requestId={request.id} />
        </div>
      )}

      <div className="mb-6 rounded-xl border border-ink/10 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink">{request.company_name}</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-ink-soft">{tr("Email")}</dt>
            <dd className="min-w-0 break-all">
              <a
                href={`mailto:${request.contact_email}`}
                className="font-semibold text-accent hover:underline"
              >
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
            <dt className="w-24 flex-none text-ink-soft">{tr("Ricevuta")}</dt>
            <dd>{formatTime(request.submitted_at ?? request.created_at)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-ink-soft">{tr("Consegna")}</dt>
            <dd className="font-semibold">
              {request.delivery_preference ? DELIVERY_LABELS[request.delivery_preference] : "—"}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 flex-none text-ink-soft">{tr("Lingua")}</dt>
            <dd className="uppercase">{request.language}</dd>
          </div>
        </dl>

        {request.notes && (
          <div className="mt-4 border-t border-ink/5 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Note del cliente
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{request.notes}</p>
          </div>
        )}
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
              <th scope="col" className="px-4 py-3 font-semibold">Stagione</th>
              <th scope="col" className="px-4 py-3 font-semibold">Preferenza</th>
              <th scope="col" className="px-4 py-3 font-semibold">{tr("Consegna")}</th>
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
                <td className="px-4 py-3 text-ink-soft">
                  {item.season ? SEASON_LABELS[item.season] : "—"}
                </td>
                <td className="px-4 py-3 text-ink-soft">{describePreference(item)}</td>
                <td className="px-4 py-3 text-ink-soft">
                  {DELIVERY_LABELS[item.delivery_speed] ?? item.delivery_speed}
                </td>
                <td className="px-4 py-3 text-right font-bold tabular-nums text-ink">
                  {item.quantity}
                </td>
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
              {item.season ? `${SEASON_LABELS[item.season]} · ` : ""}
              {describePreference(item)} ·{" "}
              {DELIVERY_LABELS[item.delivery_speed] ?? item.delivery_speed}
            </div>
          </li>
        ))}
      </ul>

      {/* ---- Operational detail, deliberately last and deliberately quiet.
          Sales needs the request; this is for whoever is debugging it. ---- */}
      <section className="mt-8 rounded-xl border border-ink/10 bg-surface-soft/50 p-4">
        <h2 className="text-sm font-bold text-ink">{tr("Sistema")}</h2>

        <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <dt className="w-28 flex-none text-ink-soft">{tr("Email interna")}</dt>
            <dd>
              <NotificationStatusBadge status={request.notification_status} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-ink-soft">Tentativi</dt>
            <dd className="tabular-nums">{request.notification_attempts}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-ink-soft">Inviata</dt>
            <dd>{formatTime(request.notification_sent_at)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-28 flex-none text-ink-soft">Consegnata</dt>
            <dd>{formatTime(request.notification_delivered_at)}</dd>
          </div>
          {request.provider_message_id && (
            <div className="flex gap-2 sm:col-span-2">
              <dt className="w-28 flex-none text-ink-soft">{tr("ID messaggio")}</dt>
              <dd className="min-w-0 break-all font-mono text-xs">{request.provider_message_id}</dd>
            </div>
          )}
        </dl>

        {/* Retry stays available even when the current state is success —
            re-sending a notification is safe and never touches the request. */}
        {!notificationFailed && !notificationPending && (
          <ResendNotificationButton requestId={request.id} subdued />
        )}

        {events.length > 0 && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink-soft hover:text-ink">
              Cronologia eventi ({events.length})
            </summary>
            <ul className="mt-2 space-y-1 text-xs text-ink-soft">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap gap-x-3 tabular-nums">
                  <span className="text-ink-soft/70">{formatTime(event.created_at)}</span>
                  <span className="font-semibold text-ink">{event.event_type}</span>
                  {event.duration_ms != null && <span>{event.duration_ms} ms</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}
