// Canonical contract for the "Richiedi un'offerta" quote-request flow,
// shared by the public form, /api/quote-requests, the admin screens, the
// Excel export and the Resend webhook. Every string union here mirrors a
// Postgres CHECK constraint in
// supabase/migrations/20260827000000_quote_requests_production.sql exactly —
// keep the two in sync if either changes.

export type ProductType = "tyre" | "other";
export type PreferenceType = "best_price" | "specific_brand";
export type DeliverySpeed = "24h" | "7d";
export type Season = "summer" | "winter" | "all_season";
export type QuoteLanguage = "it" | "en";

/**
 * The quotation lifecycle. Stable machine values; the UI renders localized
 * labels from QUOTE_STATUS_LABELS.
 */
export type QuoteRequestStatus =
  | "submitted"
  | "reviewing"
  | "quote_preparing"
  | "quote_ready"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "archived";

/**
 * Notification state. `sent` means the provider accepted it; `delivered`
 * means the provider later confirmed it reached the mailbox. Collapsing
 * those two is how a system claims mail is working when it is bouncing.
 */
export type NotificationStatus = "pending" | "sending" | "sent" | "delivered" | "failed";

export const PRODUCT_TYPES: readonly ProductType[] = ["tyre", "other"];
export const PREFERENCE_TYPES: readonly PreferenceType[] = ["best_price", "specific_brand"];
export const DELIVERY_SPEEDS: readonly DeliverySpeed[] = ["24h", "7d"];
export const SEASONS: readonly Season[] = ["summer", "winter", "all_season"];

export const QUOTE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = [
  "submitted",
  "reviewing",
  "quote_preparing",
  "quote_ready",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "archived",
];

export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = [
  "pending",
  "sending",
  "sent",
  "delivered",
  "failed",
];

/** Statuses that still need someone to act. Drives the nav badge. */
export const OPEN_QUOTE_STATUSES: readonly QuoteRequestStatus[] = [
  "submitted",
  "reviewing",
  "quote_preparing",
  "quote_ready",
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
  season?: Season | null;
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
  notes?: string | null;
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
      /** The customer-facing reference, e.g. "GR-260825-0042". */
      reference: string;
      itemCount: number;
      /** Whether the internal notification went out. Never gates success. */
      emailSent: boolean;
    }
  | { success: false; error: string; fieldErrors?: string[] };

/** A row of `public.quote_requests`. */
export interface QuoteRequestRow {
  id: string;
  public_reference: string;
  company_name: string;
  contact_email: string;
  whatsapp: string | null;
  notes: string | null;
  language: QuoteLanguage;
  status: QuoteRequestStatus;
  delivery_preference: DeliverySpeed | null;

  notification_status: NotificationStatus;
  notification_provider: string | null;
  provider_message_id: string | null;
  notification_attempts: number;
  last_notification_attempt_at: string | null;
  notification_sent_at: string | null;
  notification_delivered_at: string | null;
  notification_failed_at: string | null;
  last_notification_error: string | null;

  source: string;
  submitted_at: string | null;
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
  season: Season | null;
  quantity: number;
  preference_type: PreferenceType | null;
  preferred_brand: string | null;
  delivery_speed: DeliverySpeed;
  sort_order: number;
  created_at: string;
}

/** A row of `public.quote_request_events` — the append-only operational log. */
export interface QuoteRequestEventRow {
  id: string;
  quote_request_id: string | null;
  event_type: string;
  meta: Record<string, unknown>;
  duration_ms: number | null;
  created_at: string;
}

/** Admin list row — the request plus a cheap item count. */
export interface QuoteRequestListRow extends QuoteRequestRow {
  item_count: number;
}

/** Admin detail — the request with its items and its event history. */
export interface QuoteRequestDetail {
  request: QuoteRequestRow;
  items: QuoteRequestItemRow[];
  events?: QuoteRequestEventRow[];
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "205/55 R16" for display. Returns null unless all three are present. */
export function formatTyreSize(
  width: number | null,
  profile: number | null,
  rim: number | null
): string | null {
  if (width == null || profile == null || rim == null) return null;
  return `${width}/${profile} R${rim}`;
}

export const QUOTE_STATUS_LABELS: Record<QuoteRequestStatus, string> = {
  submitted: "Nuova",
  reviewing: "In revisione",
  quote_preparing: "Preparazione offerta",
  quote_ready: "Offerta pronta",
  sent: "Inviata",
  accepted: "Accettata",
  rejected: "Rifiutata",
  expired: "Scaduta",
  archived: "Archiviata",
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  pending: "In attesa",
  sending: "In invio",
  sent: "Inviata",
  delivered: "Consegnata",
  failed: "Invio non riuscito",
};

export const DELIVERY_LABELS: Record<DeliverySpeed, string> = {
  "24h": "24 ore",
  "7d": "7 giorni",
};

export const SEASON_LABELS: Record<Season, string> = {
  summer: "Estivo",
  winter: "Invernale",
  all_season: "Quattro stagioni",
};

/**
 * The statuses an admin may move a request to next. Deliberately permissive
 * (any non-terminal status can be corrected to any other) because a sales
 * process is not a state machine anyone wants to fight — but archived and
 * expired are end states reached on purpose.
 */
export function isOpenStatus(status: QuoteRequestStatus): boolean {
  return (OPEN_QUOTE_STATUSES as readonly string[]).includes(status);
}
