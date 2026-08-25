// Canonical contract for the "Richiedi un'offerta" quote-request flow,
// shared by the public form, /api/quote-requests, the admin screens and the
// Excel export. Every string union here mirrors a Postgres CHECK constraint
// in supabase/migrations/20260826000000_quote_requests.sql exactly — keep
// the two in sync if either changes.
//
// Distinct from src/lib/types/offer-request.ts, which belongs to the older
// /get-offer flow and its client_offer_requests table. Both exist on
// purpose; see the migration header for why.

export type ProductType = "tyre" | "other";
export type PreferenceType = "best_price" | "specific_brand";
export type DeliverySpeed = "24h" | "7d";
export type QuoteRequestStatus = "new" | "in_progress" | "offer_sent";
export type QuoteLanguage = "it" | "en";

export const PRODUCT_TYPES: readonly ProductType[] = ["tyre", "other"];
export const PREFERENCE_TYPES: readonly PreferenceType[] = ["best_price", "specific_brand"];
export const DELIVERY_SPEEDS: readonly DeliverySpeed[] = ["24h", "7d"];
export const QUOTE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = [
  "new",
  "in_progress",
  "offer_sent",
];

/** One requested product, as the client submits it. */
export interface QuoteItemInput {
  productType: ProductType;
  /** Required for `other`, always null for `tyre`. */
  description?: string | null;
  /** Required for `tyre`, always null for `other`. */
  width?: number | null;
  profile?: number | null;
  rim?: number | null;
  /** Free text, deliberately barely validated in V1 ("91V", "109/107T"). */
  loadSpeedIndex?: string | null;
  quantity: number;
  preferenceType?: PreferenceType | null;
  /** Only meaningful when preferenceType is 'specific_brand'. */
  preferredBrand?: string | null;
  deliverySpeed: DeliverySpeed;
}

export interface CreateQuoteRequestPayload {
  companyName: string;
  email: string;
  whatsapp?: string | null;
  language: QuoteLanguage;
  items: QuoteItemInput[];
  /** Stops a double-tapped submit creating two requests. */
  idempotencyKey: string;
  /** Hidden honeypot — must stay empty for genuine submissions. */
  website?: string;
}

export type CreateQuoteRequestResponse =
  | {
      success: true;
      requestId: string;
      requestNumber: string;
      itemCount: number;
      /** Whether the internal notification went out. Never gates success. */
      emailSent: boolean;
    }
  | { success: false; error: string; fieldErrors?: string[] };

/** A row of `public.quote_requests`. */
export interface QuoteRequestRow {
  id: string;
  request_number: string;
  company_name: string;
  contact_email: string;
  whatsapp: string | null;
  language: QuoteLanguage;
  status: QuoteRequestStatus;
  notification_email_sent: boolean;
  notification_email_error: string | null;
  notification_email_sent_at: string | null;
  idempotency_key: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

/** A row of `public.quote_request_items`. */
export interface QuoteRequestItemRow {
  id: string;
  quote_request_id: string;
  product_type: ProductType;
  description: string | null;
  width: number | null;
  profile: number | null;
  rim: number | null;
  load_speed_index: string | null;
  quantity: number;
  preference_type: PreferenceType | null;
  preferred_brand: string | null;
  delivery_speed: DeliverySpeed;
  sort_order: number;
  created_at: string;
}

/** Admin list row — the request plus a cheap item count. */
export interface QuoteRequestListRow extends QuoteRequestRow {
  item_count: number;
}

/** Admin detail — the request with its items, ordered. */
export interface QuoteRequestDetail {
  request: QuoteRequestRow;
  items: QuoteRequestItemRow[];
}

/** "205/55 R16" for display. Returns null unless all three are present. */
export function formatTyreSize(
  width: number | null,
  profile: number | null,
  rim: number | null
): string | null {
  if (width == null || profile == null || rim == null) return null;
  return `${width}/${profile} R${rim}`;
}
