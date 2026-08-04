// Canonical contract shared between the offer-request form, the
// `/api/offer-requests` route, and (later) the admin dashboard. These
// string unions mirror the Postgres CHECK constraints in the Supabase
// migration exactly — keep the two in sync if either changes.

export type TyreSeason = "summer" | "winter" | "all_season";

export type DeliveryPreference = "any" | "24_hours" | "48_hours" | "7_days";

export type ContactType = "email" | "phone";

export type OfferRequestStatus =
  | "new"
  | "reviewing"
  | "quoted"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "converted_to_order"
  | "cancelled";

export type NotificationEmailStatus = "pending" | "sent" | "failed";

export type RequestedTyre = {
  id: string;
  width: number;
  profile: number;
  rim: number;
  season: TyreSeason;
  quantity: number;
  notes?: string;
};

export type CreateOfferRequestPayload = {
  companyName?: string;
  contact: string;
  deliveryPreference: DeliveryPreference;
  tyres: RequestedTyre[];
  customerMessage?: string;
  idempotencyKey: string;
  /** Hidden honeypot field. Must stay empty for genuine submissions. */
  website?: string;
};

export type OfferRequestSummary = {
  companyName?: string;
  contact: string;
  deliveryPreference: DeliveryPreference;
  tyres: RequestedTyre[];
};

export type CreateOfferRequestResponse =
  | {
      success: true;
      requestId: string;
      requestNumber: string;
      emailSent: boolean;
      summary: OfferRequestSummary;
    }
  | {
      success: false;
      error: string;
    };

/** Shape of a row in `public.client_offer_requests`. Kept in sync with the
 * migration by hand (no generated Supabase types in this MVP). */
export interface ClientOfferRequestRow {
  id: string;
  request_number: string;
  company_name: string | null;
  contact_value: string;
  contact_type: ContactType;
  delivery_preference: DeliveryPreference;
  tyres: RequestedTyre[];
  customer_message: string | null;
  status: OfferRequestStatus;
  internal_notes: string | null;
  notification_email_status: NotificationEmailStatus;
  notification_email_id: string | null;
  notification_email_sent_at: string | null;
  notification_email_error: string | null;
  idempotency_key: string | null;
  source: string;
  submitted_at: string;
  created_at: string;
  updated_at: string;
}
