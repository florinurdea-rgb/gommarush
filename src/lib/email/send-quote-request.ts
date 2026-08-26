import "server-only";
import { Resend } from "resend";
import { logError } from "@/lib/logger";
import {
  DELIVERY_LABELS,
  SEASON_LABELS,
  formatTyreSize,
  type QuoteRequestItemRow,
  type QuoteRequestRow,
} from "@/lib/types/quote-request";

/**
 * Internal sales notification for a new quote request.
 *
 * Uses the project's Resend account. Never throws: the request row is
 * already committed by the time this runs, and a mail outage must not turn a
 * saved request into an error for the customer.
 */

export type SendResult = { success: true; messageId?: string } | { success: false; error: string };

/**
 * What the deployment's mail configuration actually resolves to, with no
 * secret values in it. The API key is reported only as present/absent plus
 * whether it has Resend's `re_` shape — enough to tell "not set" apart from
 * "set to the wrong string", which are very different fixes.
 */
export interface EmailConfigStatus {
  configured: boolean;
  apiKeyPresent: boolean;
  /** False when a key is set but doesn't look like a Resend key at all. */
  apiKeyLooksValid: boolean;
  /** The visible From header — not a secret; it is stamped on every mail. */
  from: string | null;
  fromVariable: "EMAIL_FROM" | "RESEND_FROM_EMAIL" | null;
  to: string | null;
  toVariable: "SALES_NOTIFICATION_EMAIL" | "OFFER_NOTIFICATION_EMAIL" | null;
  /** Names of the variables that must be set before mail can go out at all. */
  missing: string[];
}

/**
 * Reads an environment variable, treating whitespace-only as unset and
 * trimming what survives.
 *
 * Trimming is not cosmetic here. A key pasted into a dashboard with a
 * trailing newline produces a malformed Authorization header and Resend
 * answers 401 "API key is invalid" — indistinguishable, from the outside,
 * from a genuinely wrong key.
 */
function readEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveConfig(): {
  apiKey: string | null;
  from: string | null;
  fromVariable: EmailConfigStatus["fromVariable"];
  to: string | null;
  toVariable: EmailConfigStatus["toVariable"];
} {
  const apiKey = readEnv("RESEND_API_KEY");

  // EMAIL_FROM / SALES_NOTIFICATION_EMAIL are optional overrides; the
  // RESEND_FROM_EMAIL / OFFER_NOTIFICATION_EMAIL names are what existing
  // deployments already set, so an untouched deployment keeps working.
  const emailFrom = readEnv("EMAIL_FROM");
  const resendFrom = readEnv("RESEND_FROM_EMAIL");
  const salesTo = readEnv("SALES_NOTIFICATION_EMAIL");
  const offerTo = readEnv("OFFER_NOTIFICATION_EMAIL");

  return {
    apiKey,
    from: emailFrom ?? resendFrom,
    fromVariable: emailFrom ? "EMAIL_FROM" : resendFrom ? "RESEND_FROM_EMAIL" : null,
    to: salesTo ?? offerTo,
    toVariable: salesTo ? "SALES_NOTIFICATION_EMAIL" : offerTo ? "OFFER_NOTIFICATION_EMAIL" : null,
  };
}

/**
 * Server-side diagnostic for the admin screens. Safe to render: it exposes
 * the From/To addresses (which are already visible on every mail that goes
 * out) and never the key itself.
 */
export function describeEmailConfig(): EmailConfigStatus {
  const config = resolveConfig();

  const missing: string[] = [];
  if (!config.apiKey) missing.push("RESEND_API_KEY");
  if (!config.from) missing.push("RESEND_FROM_EMAIL");
  if (!config.to) missing.push("OFFER_NOTIFICATION_EMAIL");

  return {
    configured: missing.length === 0,
    apiKeyPresent: Boolean(config.apiKey),
    apiKeyLooksValid: config.apiKey ? config.apiKey.startsWith("re_") : false,
    from: config.from,
    fromVariable: config.fromVariable,
    to: config.to,
    toVariable: config.toVariable,
    missing,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function describeItem(item: QuoteRequestItemRow): {
  product: string;
  size: string;
  index: string;
  season: string;
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
    season: item.season ? SEASON_LABELS[item.season] : "—",
    preference,
    delivery: DELIVERY_LABELS[item.delivery_speed] ?? item.delivery_speed,
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
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.season)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.preference)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(described.delivery)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700">${escapeHtml(described.quantity)}</td>
      </tr>`;
    })
    .join("");

  const whatsappRow = request.whatsapp
    ? `<tr><td style="padding:3px 0;color:#6b7280">WhatsApp</td><td style="padding:3px 0;font-weight:600">${escapeHtml(request.whatsapp)}</td></tr>`
    : "";

  const notesBlock = request.notes
    ? `<div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:16px">
         <h2 style="font-size:15px;margin:0 0 6px">Note del cliente</h2>
         <p style="margin:0;font-size:14px;white-space:pre-wrap">${escapeHtml(request.notes)}</p>
       </div>`
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
      Richiesta <strong style="color:#111827">${escapeHtml(request.public_reference)}</strong> · ${escapeHtml(submitted)}
    </p>

    <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:16px">
      <h2 style="font-size:15px;margin:0 0 10px">Cliente</h2>
      <table style="font-size:14px;border-collapse:collapse">
        <tr><td style="padding:3px 0;color:#6b7280;width:110px">Azienda</td><td style="padding:3px 0;font-weight:700">${escapeHtml(request.company_name)}</td></tr>
        <tr><td style="padding:3px 0;color:#6b7280">Email</td><td style="padding:3px 0;font-weight:600"><a href="mailto:${escapeHtml(request.contact_email)}" style="color:#0f7b53">${escapeHtml(request.contact_email)}</a></td></tr>
        ${whatsappRow}
        <tr><td style="padding:3px 0;color:#6b7280">Consegna</td><td style="padding:3px 0;font-weight:600">${escapeHtml(
          request.delivery_preference ? DELIVERY_LABELS[request.delivery_preference] : "—"
        )}</td></tr>
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
            <th style="padding:8px 10px;font-weight:600">Stagione</th>
            <th style="padding:8px 10px;font-weight:600">Preferenza</th>
            <th style="padding:8px 10px;font-weight:600">Consegna</th>
            <th style="padding:8px 10px;font-weight:600;text-align:right">Q.tà</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    ${notesBlock}
    ${cta}
  </div>
</body></html>`;
}

function buildText(request: QuoteRequestRow, items: QuoteRequestItemRow[]): string {
  const lines = [
    `Nuova richiesta di offerta ${request.public_reference}`,
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
      `- ${described.product} | ${described.size} | ${described.index} | ${described.season} | ${described.preference} | ${described.delivery} | x${described.quantity}`
    );
  }

  if (request.notes) {
    lines.push("", "Note del cliente:", request.notes);
  }

  return lines.join("\n");
}

export async function sendQuoteRequestEmail(input: {
  request: QuoteRequestRow;
  items: QuoteRequestItemRow[];
}): Promise<SendResult> {
  const config = describeEmailConfig();

  // Not being configured is an operational state, not a crash — the request
  // is already saved and visible in the admin either way. The error names the
  // variables that are actually missing, so the admin panel can say what to
  // set instead of a bare "not configured".
  if (!config.configured) {
    return { success: false, error: `EMAIL_NOT_CONFIGURED: ${config.missing.join(", ")}` };
  }

  const apiKey = readEnv("RESEND_API_KEY") as string;
  const from = config.from as string;
  const to = config.to as string;

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
      subject: `Nuova richiesta di offerta – ${input.request.company_name} – ${input.request.public_reference}`,
      html: buildHtml(input.request, input.items, adminUrl),
      text: buildText(input.request, input.items),
    });

    if (result.error) {
      // Resend reports failures in the response body, not by throwing. Keep
      // its name as well as its message: "validation_error" vs
      // "invalid_access_token" is the difference between an unverified
      // sending domain and a bad key.
      const detail = [result.error.name, result.error.message].filter(Boolean).join(": ");
      logError("quote_request_email_failed", new Error(detail), {
        requestId: input.request.id,
      });
      return { success: false, error: detail || "Resend returned an unspecified error" };
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
