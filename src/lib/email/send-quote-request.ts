import "server-only";
import { Resend } from "resend";
import { logError } from "@/lib/logger";
import { formatTyreSize, type QuoteRequestItemRow, type QuoteRequestRow } from "@/lib/types/quote-request";

/**
 * Internal sales notification for a new quote request.
 *
 * Reuses the project's existing Resend integration (see
 * src/lib/email/send-offer-request.ts) rather than introducing a second mail
 * provider. Never throws: the request row is already committed by the time
 * this runs, and a mail outage must not turn a saved request into an error
 * for the customer.
 */

export type SendResult = { success: true; messageId?: string } | { success: false; error: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DELIVERY_LABEL: Record<string, string> = { "24h": "24 ore", "7d": "7 giorni" };

function describeItem(item: QuoteRequestItemRow): {
  product: string;
  size: string;
  index: string;
  preference: string;
  delivery: string;
  quantity: string;
} {
  const isTyre = item.product_type === "tyre";
  const preference =
    item.preference_type === "specific_brand"
      ? item.preferred_brand ?? "Marca specifica"
      : "Miglior prezzo";

  return {
    product: isTyre ? "Pneumatico" : item.description ?? "Altro prodotto",
    size: formatTyreSize(item.width, item.profile, item.rim) ?? "—",
    index: item.load_speed_index ?? "—",
    preference,
    delivery: DELIVERY_LABEL[item.delivery_speed] ?? item.delivery_speed,
    quantity: String(item.quantity),
  };
}

function buildHtml(
  request: QuoteRequestRow,
  items: QuoteRequestItemRow[],
  adminUrl: string | null
): string {
  const submitted = new Date(request.created_at).toLocaleString("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Rome",
  });

  const rows = items
    .map((item) => {
      const described = describeItem(item);
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.product)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.size)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.index)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.preference)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.delivery)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${escapeHtml(described.quantity)}</td>
      </tr>`;
    })
    .join("");

  const whatsappRow = request.whatsapp
    ? `<tr><td style="padding:3px 0;color:#6b7280">WhatsApp</td><td style="padding:3px 0;font-weight:600">${escapeHtml(request.whatsapp)}</td></tr>`
    : "";

  const cta = adminUrl
    ? `<p style="margin:24px 0 0">
         <a href="${escapeHtml(adminUrl)}"
            style="display:inline-block;background:#0f7b53;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">
           Apri richiesta
         </a>
       </p>
       <p style="margin:8px 0 0;font-size:12px;color:#6b7280">
         L'accesso richiede comunque l'autenticazione all'area riservata.
       </p>`
    : "";

  return `<!doctype html>
<html lang="it"><body style="margin:0;background:#f6f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827">
  <div style="max-width:720px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;margin:0 0 4px">Nuova richiesta di offerta</h1>
    <p style="margin:0 0 20px;color:#6b7280;font-size:14px">
      Richiesta <strong style="color:#111827">${escapeHtml(request.request_number)}</strong> · ${escapeHtml(submitted)}
    </p>

    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
      <h2 style="font-size:15px;margin:0 0 10px">Cliente</h2>
      <table style="font-size:14px;border-collapse:collapse">
        <tr><td style="padding:3px 0;color:#6b7280;width:110px">Azienda</td><td style="padding:3px 0;font-weight:700">${escapeHtml(request.company_name)}</td></tr>
        <tr><td style="padding:3px 0;color:#6b7280">Email</td><td style="padding:3px 0;font-weight:600"><a href="mailto:${escapeHtml(request.contact_email)}" style="color:#0f7b53">${escapeHtml(request.contact_email)}</a></td></tr>
        ${whatsappRow}
        <tr><td style="padding:3px 0;color:#6b7280">Lingua</td><td style="padding:3px 0">${escapeHtml(request.language.toUpperCase())}</td></tr>
      </table>
    </div>

    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px">
      <h2 style="font-size:15px;margin:0 0 10px">Prodotti richiesti (${items.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="text-align:left;background:#f9fafb">
            <th style="padding:8px 10px;font-weight:600">Prodotto</th>
            <th style="padding:8px 10px;font-weight:600">Dimensione</th>
            <th style="padding:8px 10px;font-weight:600">Indice</th>
            <th style="padding:8px 10px;font-weight:600">Preferenza</th>
            <th style="padding:8px 10px;font-weight:600">Consegna</th>
            <th style="padding:8px 10px;font-weight:600;text-align:right">Q.tà</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    ${cta}
  </div>
</body></html>`;
}

function buildText(request: QuoteRequestRow, items: QuoteRequestItemRow[]): string {
  const lines = [
    `Nuova richiesta di offerta ${request.request_number}`,
    `Azienda: ${request.company_name}`,
    `Email: ${request.contact_email}`,
    request.whatsapp ? `WhatsApp: ${request.whatsapp}` : null,
    `Data: ${new Date(request.created_at).toLocaleString("it-IT", { timeZone: "Europe/Rome" })}`,
    "",
    `Prodotti (${items.length}):`,
  ].filter(Boolean) as string[];

  for (const item of items) {
    const described = describeItem(item);
    lines.push(
      `- ${described.product} | ${described.size} | ${described.index} | ${described.preference} | ${described.delivery} | x${described.quantity}`
    );
  }

  return lines.join("\n");
}

export async function sendQuoteRequestEmail(input: {
  request: QuoteRequestRow;
  items: QuoteRequestItemRow[];
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL;
  const to = process.env.SALES_NOTIFICATION_EMAIL || process.env.OFFER_NOTIFICATION_EMAIL;

  // Not configured is a a operational state, not a crash — the request is
  // already saved and visible in the admin either way.
  if (!apiKey || !from || !to) {
    return { success: false, error: "EMAIL_NOT_CONFIGURED" };
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const adminUrl = baseUrl ? `${baseUrl}/admin/richieste-offerta/${input.request.id}` : null;

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to,
      replyTo: input.request.contact_email,
      subject: `Nuova richiesta di offerta – ${input.request.company_name} – ${input.request.request_number}`,
      html: buildHtml(input.request, input.items, adminUrl),
      text: buildText(input.request, input.items),
    });

    if (result.error) {
      logError("quote_request_email_failed", new Error(result.error.message), {
        requestId: input.request.id,
      });
      return { success: false, error: result.error.message };
    }

    return { success: true, messageId: result.data?.id };
  } catch (error) {
    logError("quote_request_email_threw", error, { requestId: input.request.id });
    return {
      success: false,
      error: error instanceof Error ? error.message : "UNKNOWN_EMAIL_ERROR",
    };
  }
}
