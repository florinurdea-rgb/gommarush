import "server-only";
import { Resend } from "resend";
import { DELIVERY_LABELS, SEASON_LABELS } from "@/lib/types/ui";
import type { ContactType, DeliveryPreference, RequestedTyre } from "@/lib/types/offer-request";

export interface OfferRequestEmailData {
  recordId: string;
  requestNumber: string;
  submittedAt: string; // ISO timestamp
  companyName?: string | null;
  contactValue: string;
  contactType: ContactType;
  deliveryPreference: DeliveryPreference;
  customerMessage?: string | null;
  tyres: RequestedTyre[];
}

export type SendOfferRequestEmailResult =
  | { success: true; messageId: string }
  | { success: false; error: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatSubmittedAt(iso: string): string {
  try {
    const formatted = new Intl.DateTimeFormat("it-IT", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Rome",
    }).format(new Date(iso));
    return formatted;
  } catch {
    return iso;
  }
}

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  email: "Email",
  phone: "Telefono",
};

function buildSubject(requestNumber: string): string {
  return `Nuova richiesta GommaRush – ${requestNumber}`;
}

function buildTextBody(data: OfferRequestEmailData): string {
  const lines: string[] = [];
  lines.push("Nuova richiesta di offerta GommaRush");
  lines.push("");
  lines.push(`Riferimento: ${data.requestNumber}`);
  if (data.companyName) lines.push(`Azienda: ${data.companyName}`);
  lines.push(`Contatto: ${data.contactValue}`);
  lines.push(`Tipo di contatto: ${CONTACT_TYPE_LABELS[data.contactType]}`);
  lines.push(`Preferenza di consegna: ${DELIVERY_LABELS[data.deliveryPreference]}`);
  lines.push(`Data richiesta: ${formatSubmittedAt(data.submittedAt)}`);
  lines.push("");
  lines.push("Pneumatici richiesti");
  lines.push("");
  data.tyres.forEach((tyre, index) => {
    lines.push(`${index + 1}. ${tyre.width}/${tyre.profile} R${tyre.rim}`);
    lines.push(`   Stagione: ${SEASON_LABELS[tyre.season]}`);
    lines.push(`   Quantità: ${tyre.quantity}`);
    if (tyre.notes) lines.push(`   Note: ${tyre.notes}`);
    lines.push("");
  });

  if (data.customerMessage) {
    lines.push("Messaggio:");
    lines.push(data.customerMessage);
    lines.push("");
  }

  lines.push(`ID record Supabase: ${data.recordId}`);

  return lines.join("\n");
}

function buildHtmlBody(data: OfferRequestEmailData): string {
  const tyresHtml = data.tyres
    .map((tyre, index) => {
      const notesHtml = tyre.notes
        ? `<div style="color:#4A5568;font-size:14px;margin-top:2px;">Note: ${escapeHtml(tyre.notes)}</div>`
        : "";
      return `
        <div style="padding:12px 0;border-bottom:1px solid #E5E9F0;">
          <div style="font-weight:700;color:#152238;font-size:15px;">
            ${index + 1}. ${escapeHtml(String(tyre.width))}/${escapeHtml(String(tyre.profile))} R${escapeHtml(String(tyre.rim))}
          </div>
          <div style="color:#4A5568;font-size:14px;margin-top:2px;">
            Stagione: ${escapeHtml(SEASON_LABELS[tyre.season])} &middot; Quantit&agrave;: ${escapeHtml(String(tyre.quantity))}
          </div>
          ${notesHtml}
        </div>`;
    })
    .join("");

  const messageHtml = data.customerMessage
    ? `<tr><td style="padding:6px 0;color:#4A5568;">Messaggio</td><td style="padding:6px 0;color:#152238;font-weight:600;">${escapeHtml(
        data.customerMessage
      )}</td></tr>`
    : "";

  const companyRow = data.companyName
    ? `<tr><td style="padding:6px 0;color:#4A5568;">Azienda</td><td style="padding:6px 0;color:#152238;font-weight:600;">${escapeHtml(
        data.companyName
      )}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="it">
<body style="margin:0;padding:0;background:#F6F8FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <h1 style="font-size:20px;color:#152238;margin:0 0 4px;">Nuova richiesta di offerta GommaRush</h1>
    <p style="color:#4A5568;margin:0 0 24px;">Riferimento <strong>${escapeHtml(data.requestNumber)}</strong></p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
      ${companyRow}
      <tr><td style="padding:6px 0;color:#4A5568;">Contatto</td><td style="padding:6px 0;color:#152238;font-weight:600;">${escapeHtml(
        data.contactValue
      )}</td></tr>
      <tr><td style="padding:6px 0;color:#4A5568;">Tipo di contatto</td><td style="padding:6px 0;color:#152238;font-weight:600;">${escapeHtml(
        CONTACT_TYPE_LABELS[data.contactType]
      )}</td></tr>
      <tr><td style="padding:6px 0;color:#4A5568;">Preferenza di consegna</td><td style="padding:6px 0;color:#152238;font-weight:600;">${escapeHtml(
        DELIVERY_LABELS[data.deliveryPreference]
      )}</td></tr>
      <tr><td style="padding:6px 0;color:#4A5568;">Data richiesta</td><td style="padding:6px 0;color:#152238;font-weight:600;">${escapeHtml(
        formatSubmittedAt(data.submittedAt)
      )}</td></tr>
      ${messageHtml}
    </table>

    <h2 style="font-size:16px;color:#152238;margin:0 0 8px;">Pneumatici richiesti</h2>
    <div>${tyresHtml}</div>

    <p style="color:#9AA3AF;font-size:12px;margin-top:32px;">ID record Supabase: ${escapeHtml(data.recordId)}</p>
  </div>
</body>
</html>`;
}

export async function sendOfferRequestEmail(
  data: OfferRequestEmailData
): Promise<SendOfferRequestEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.OFFER_NOTIFICATION_EMAIL;

  if (!apiKey || !from || !to) {
    return { success: false, error: "Missing email configuration" };
  }

  const resend = new Resend(apiKey);

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject: buildSubject(data.requestNumber),
      html: buildHtmlBody(data),
      text: buildTextBody(data),
      ...(data.contactType === "email" ? { replyTo: data.contactValue } : {}),
    });

    if (result.error) {
      return { success: false, error: result.error.message ?? "Resend returned an error" };
    }

    if (!result.data?.id) {
      return { success: false, error: "Resend did not return a message id" };
    }

    return { success: true, messageId: result.data.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown email error";
    return { success: false, error: message };
  }
}
