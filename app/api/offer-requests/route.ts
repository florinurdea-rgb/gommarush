import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOfferRequestSchema } from "@/lib/validation/offer-request";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { detectContact } from "@/lib/contact-detection";
import { sendOfferRequestEmail } from "@/lib/email/send-offer-request";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { logEvent, logError } from "@/lib/logger";
import type { ClientOfferRequestRow, CreateOfferRequestResponse } from "@/lib/types/offer-request";

export const runtime = "nodejs";

// Generous for a payload with at most 20 tyres, tight enough to reject
// anything trying to smuggle a large blob through this endpoint.
const MAX_BODY_BYTES = 20_000;

const SELECT_COLUMNS =
  "id, request_number, company_name, contact_value, contact_type, delivery_preference, tyres, customer_message, status, internal_notes, notification_email_status, notification_email_id, notification_email_sent_at, notification_email_error, idempotency_key, source, submitted_at, created_at, updated_at";

function fail(status: number, error: string) {
  return NextResponse.json<CreateOfferRequestResponse>({ success: false, error }, { status });
}

function toSummary(row: ClientOfferRequestRow) {
  return {
    companyName: row.company_name ?? undefined,
    contact: row.contact_value,
    deliveryPreference: row.delivery_preference,
    tyres: row.tyres,
  };
}

/**
 * Sends the notification email for a saved request and reflects the
 * outcome back onto the row. Never throws: a failed email must not fail
 * the overall request, since the Supabase row is already the source of
 * truth and must be preserved either way.
 */
async function sendAndRecordEmail(
  supabase: SupabaseClient,
  row: ClientOfferRequestRow
): Promise<boolean> {
  const result = await sendOfferRequestEmail({
    recordId: row.id,
    requestNumber: row.request_number,
    submittedAt: row.submitted_at,
    companyName: row.company_name,
    contactValue: row.contact_value,
    contactType: row.contact_type,
    deliveryPreference: row.delivery_preference,
    customerMessage: row.customer_message,
    tyres: row.tyres,
  });

  try {
    if (result.success) {
      await supabase
        .from("client_offer_requests")
        .update({
          notification_email_status: "sent",
          notification_email_id: result.messageId,
          notification_email_sent_at: new Date().toISOString(),
          notification_email_error: null,
        })
        .eq("id", row.id);
      logEvent("offer_request_email_sent", { requestId: row.id });
      return true;
    }

    logError("offer_request_email_failed", new Error(result.error), { requestId: row.id });
    await supabase
      .from("client_offer_requests")
      .update({
        notification_email_status: "failed",
        // Never persist raw provider internals beyond a short, safe message.
        notification_email_error: result.error.slice(0, 500),
      })
      .eq("id", row.id);
    return false;
  } catch (error) {
    // Even the status-update failed. The row itself is still intact;
    // just log and move on rather than surfacing this to the customer.
    logError("offer_request_email_status_update_failed", error, { requestId: row.id });
    return false;
  }
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return fail(415, "UNSUPPORTED_MEDIA_TYPE");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return fail(413, "PAYLOAD_TOO_LARGE");
  }

  if (isRateLimited(ip)) {
    logEvent("offer_request_rate_limited", { ip });
    return fail(429, "RATE_LIMITED");
  }

  let rawBody: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return fail(413, "PAYLOAD_TOO_LARGE");
    }
    rawBody = JSON.parse(text);
  } catch {
    return fail(400, "INVALID_JSON");
  }

  const parsed = createOfferRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    logEvent("offer_request_validation_failed", { ip });
    return fail(400, "VALIDATION_FAILED");
  }
  const input = parsed.data;

  // Honeypot: a filled "website" field means this wasn't a real user.
  if (input.website && input.website.trim().length > 0) {
    logEvent("offer_request_honeypot_triggered", { ip });
    return fail(400, "VALIDATION_FAILED");
  }

  const contact = detectContact(input.contact);
  if (!contact) {
    return fail(400, "INVALID_CONTACT");
  }

  let supabase: SupabaseClient;
  try {
    supabase = createSupabaseAdminClient();
  } catch (error) {
    logError("offer_request_supabase_config_missing", error);
    return fail(500, "REQUEST_SAVE_FAILED");
  }

  // Idempotency: never create a second row for the same client-generated key.
  const { data: existingRow, error: existingError } = await supabase
    .from("client_offer_requests")
    .select(SELECT_COLUMNS)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existingError) {
    logError("offer_request_idempotency_lookup_failed", existingError, { ip });
    return fail(500, "REQUEST_SAVE_FAILED");
  }

  if (existingRow) {
    const row = existingRow as unknown as ClientOfferRequestRow;
    // Only (re)send when we haven't already succeeded once.
    const emailSent =
      row.notification_email_status === "sent" ? true : await sendAndRecordEmail(supabase, row);

    return NextResponse.json<CreateOfferRequestResponse>(
      {
        success: true,
        requestId: row.id,
        requestNumber: row.request_number,
        emailSent,
        summary: toSummary(row),
      },
      { status: 200 }
    );
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from("client_offer_requests")
    .insert({
      company_name: input.companyName || null,
      contact_value: contact.normalizedContact,
      contact_type: contact.contactType,
      delivery_preference: input.deliveryPreference,
      tyres: input.tyres,
      customer_message: input.customerMessage || null,
      status: "new",
      notification_email_status: "pending",
      idempotency_key: input.idempotencyKey,
      source: "website",
    })
    .select(SELECT_COLUMNS)
    .single();

  if (insertError || !insertedRow) {
    logError("offer_request_insert_failed", insertError, { ip });
    return fail(500, "REQUEST_SAVE_FAILED");
  }

  const row = insertedRow as unknown as ClientOfferRequestRow;
  logEvent("offer_request_saved", { requestId: row.id, requestNumber: row.request_number });

  // The Supabase row is the source of truth from this point on: whatever
  // happens to the email below, the request itself has been preserved.
  const emailSent = await sendAndRecordEmail(supabase, row);

  return NextResponse.json<CreateOfferRequestResponse>(
    {
      success: true,
      requestId: row.id,
      requestNumber: row.request_number,
      emailSent,
      summary: toSummary(row),
    },
    { status: 201 }
  );
}
