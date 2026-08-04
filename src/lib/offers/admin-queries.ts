import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type {
  ClientOfferRequestRow,
  DeliveryPreference,
  OfferRequestStatus,
} from "@/lib/types/offer-request";

/**
 * Server-only query helpers for a future `/admin/offers` dashboard.
 *
 * Nothing in this file is imported by any route yet — there is no exposed
 * admin API, no page, and no way for a browser to reach these functions
 * today. When the dashboard is built, gate every route/page that calls
 * these behind Supabase Auth (e.g. a middleware check or a server-side
 * session check in a layout) before wiring them up. They all use the
 * service-role client, which bypasses Row Level Security by design.
 */

const LIST_COLUMNS =
  "id, request_number, company_name, contact_value, contact_type, delivery_preference, tyres, status, notification_email_status, submitted_at, created_at";

const DETAIL_COLUMNS =
  "id, request_number, company_name, contact_value, contact_type, delivery_preference, tyres, customer_message, status, internal_notes, notification_email_status, notification_email_id, notification_email_sent_at, notification_email_error, idempotency_key, source, submitted_at, created_at, updated_at";

export interface OfferRequestListRow {
  id: string;
  request_number: string;
  company_name: string | null;
  contact_value: string;
  delivery_preference: DeliveryPreference;
  status: OfferRequestStatus;
  notification_email_status: string;
  submitted_at: string;
  /** Derived summary fields, computed here so the dashboard table can render
   * without pulling the full tyres array into the client. */
  firstTyreSize: string | null;
  additionalTyreCount: number;
  totalTyreQuantity: number;
}

function summarizeTyres(tyres: ClientOfferRequestRow["tyres"]) {
  const first = tyres[0];
  return {
    firstTyreSize: first ? `${first.width}/${first.profile} R${first.rim}` : null,
    additionalTyreCount: Math.max(tyres.length - 1, 0),
    totalTyreQuantity: tyres.reduce((sum, t) => sum + t.quantity, 0),
  };
}

export interface ListOfferRequestsOptions {
  page?: number;
  pageSize?: number;
  status?: OfferRequestStatus;
  deliveryPreference?: DeliveryPreference;
}

export async function listOfferRequests(
  options: ListOfferRequestsOptions = {}
): Promise<{ rows: OfferRequestListRow[]; total: number }> {
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("client_offer_requests")
    .select(LIST_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.status) query = query.eq("status", options.status);
  if (options.deliveryPreference) query = query.eq("delivery_preference", options.deliveryPreference);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as ClientOfferRequestRow[]).map((row) => ({
    id: row.id,
    request_number: row.request_number,
    company_name: row.company_name,
    contact_value: row.contact_value,
    delivery_preference: row.delivery_preference,
    status: row.status,
    notification_email_status: row.notification_email_status,
    submitted_at: row.submitted_at,
    ...summarizeTyres(row.tyres),
  }));

  return { rows, total: count ?? rows.length };
}

export async function getOfferRequestById(id: string): Promise<ClientOfferRequestRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("client_offer_requests")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as ClientOfferRequestRow) ?? null;
}

export async function searchOfferRequestsByRequestNumber(
  query: string
): Promise<OfferRequestListRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("client_offer_requests")
    .select(LIST_COLUMNS)
    .ilike("request_number", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return ((data ?? []) as unknown as ClientOfferRequestRow[]).map((row) => ({
    id: row.id,
    request_number: row.request_number,
    company_name: row.company_name,
    contact_value: row.contact_value,
    delivery_preference: row.delivery_preference,
    status: row.status,
    notification_email_status: row.notification_email_status,
    submitted_at: row.submitted_at,
    ...summarizeTyres(row.tyres),
  }));
}

export async function searchOfferRequestsByCompanyName(
  query: string
): Promise<OfferRequestListRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("client_offer_requests")
    .select(LIST_COLUMNS)
    .ilike("company_name", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return ((data ?? []) as unknown as ClientOfferRequestRow[]).map((row) => ({
    id: row.id,
    request_number: row.request_number,
    company_name: row.company_name,
    contact_value: row.contact_value,
    delivery_preference: row.delivery_preference,
    status: row.status,
    notification_email_status: row.notification_email_status,
    submitted_at: row.submitted_at,
    ...summarizeTyres(row.tyres),
  }));
}

export async function searchOfferRequestsByContact(query: string): Promise<OfferRequestListRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("client_offer_requests")
    .select(LIST_COLUMNS)
    .ilike("contact_value", `%${query}%`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return ((data ?? []) as unknown as ClientOfferRequestRow[]).map((row) => ({
    id: row.id,
    request_number: row.request_number,
    company_name: row.company_name,
    contact_value: row.contact_value,
    delivery_preference: row.delivery_preference,
    status: row.status,
    notification_email_status: row.notification_email_status,
    submitted_at: row.submitted_at,
    ...summarizeTyres(row.tyres),
  }));
}

export async function updateOfferRequestStatus(
  id: string,
  status: OfferRequestStatus
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("client_offer_requests").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function updateOfferRequestInternalNotes(id: string, notes: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("client_offer_requests")
    .update({ internal_notes: notes })
    .eq("id", id);
  if (error) throw error;
}
