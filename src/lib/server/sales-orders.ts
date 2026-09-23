import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { CustomerSession } from "@/lib/auth/customer-session";
import { customerBasketPayload, resolveBasket, type BasketLineInput } from "@/lib/server/customer-basket";
import { isDeliverableLocation } from "@/lib/commerce/delivery-address";
import type { FulfilmentClass } from "@/lib/commerce/fulfilment";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";

/**
 * Customer sales orders.
 *
 * A SALES ORDER IS NOT A LOGISTICS ORDER. `public.orders` is the delivery
 * system: a job GommaRush drives, frequently for goods it never owned.
 * `public.sales_orders` is a commercial sale by GommaRush to a customer. They
 * have different lifecycles and different accounting, and collapsing them
 * would make transport revenue indistinguishable from product margin.
 *
 * Nothing here contacts a supplier. An order is created as `requested` and
 * waits for a human.
 */

/**
 * What a customer may pay with in V1 — OWNER-CONFIRMED, 2026-09-23.
 *
 * Bank transfer and cash on delivery. POS on delivery was removed: it was
 * present in the first draft of this module but is not an approved V1 method,
 * and an unapproved payment option on a checkout screen is a commitment to
 * accept a settlement channel nobody has arranged.
 *
 * The database check constraint in 0006 carries the same two values, so a
 * method this list does not offer cannot be written even by a direct insert.
 */
export const PAYMENT_METHODS = ["bank_transfer", "cash_on_delivery"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

// Re-exported so the order route keeps one import for both vocabularies.
export { FULFILMENT_CLASSES } from "@/lib/commerce/fulfilment";
export type { FulfilmentClass } from "@/lib/commerce/fulfilment";

/** Postgres unique violation. */
const UNIQUE_VIOLATION = "23505";

export interface CreatedSalesOrder {
  id: string;
  order_number: number;
  status: string;
}

interface CreateInput {
  session: CustomerSession;
  lines: BasketLineInput[];
  locationId: string;
  paymentMethod: PaymentMethod;
  fulfilmentClass: FulfilmentClass;
  note: string | null;
  idempotencyKey: string;
}

async function findByIdempotencyKey(
  customerId: string,
  idempotencyKey: string
): Promise<CreatedSalesOrder | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_orders")
    .select("id, order_number, status")
    .eq("customer_id", customerId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return (data as CreatedSalesOrder | null) ?? null;
}

/**
 * Creates a customer order request.
 *
 * ATOMIC. The header and its lines are written by one `create_portal_sales_order`
 * transaction (supabase/pending-approval/0006_sales_orders.sql). The previous
 * shape — insert the header, insert the items, delete the header if the items
 * failed — is not a transaction: if the compensating delete also failed, or the
 * process died between the two statements, an order survived with a grand total
 * and NO LINES, and it would then appear in the operator's confirmation inbox
 * as a real order to fulfil. A compensating delete cannot fix a crash, because
 * a crash is exactly when it does not run.
 *
 * IDEMPOTENT under concurrency. The pre-check is an optimisation, not the
 * guarantee: two retries can both miss it. `unique (customer_id,
 * idempotency_key)` is the guarantee, and a unique violation is resolved by
 * returning the order the other request created rather than failing the
 * customer's second click.
 */
export async function createPortalSalesOrder(input: CreateInput): Promise<CreatedSalesOrder> {
  const admin = createSupabaseAdminClient();

  const [{ data: customer, error: ce }, { data: location, error: le }] = await Promise.all([
    admin
      .from("customers")
      .select("id,name,legal_name,vat_number,fiscal_code,email,phone,active")
      .eq("id", input.session.customerId)
      .maybeSingle(),
    // Ownership is a FILTER, not a check after the fact: a location id
    // belonging to another customer resolves to no row, so it cannot be
    // delivered to and cannot be probed for existence.
    admin
      .from("customer_locations")
      .select("*")
      .eq("id", input.locationId)
      .eq("customer_id", input.session.customerId)
      .eq("active", true)
      .maybeSingle(),
  ]);
  if (ce) throw ce;
  if (le) throw le;
  if (!customer || !customer.active) throw new Error("CUSTOMER_NOT_FOUND");
  if (!isDeliverableLocation(location)) throw new Error("DELIVERY_ADDRESS_INVALID");

  const resolved = await resolveBasket(input.lines);
  const basket = customerBasketPayload(resolved);

  // Commercial safety gate: never label or persist an incomplete amount as a
  // final order total. While PFU and its VAT treatment are unresolved this
  // refuses every order, which is the intended behaviour and not a bug.
  if (basket.monetaryStatus !== "complete") throw new Error("PRICING_NOT_FINAL");

  const existing = await findByIdempotencyKey(input.session.customerId, input.idempotencyKey);
  if (existing) return existing;

  const now = new Date().toISOString();

  const payload = {
    p_customer_id: input.session.customerId,
    p_customer_location_id: location!.id,
    p_idempotency_key: input.idempotencyKey,
    p_customer_snapshot: customer,
    p_delivery_snapshot: {
      location_name: location!.location_name,
      recipient_name: location!.recipient_name,
      address_line1: location!.address_line1,
      address_line2: location!.address_line2,
      postal_code: location!.postal_code,
      city: location!.city,
      province: location!.province,
      region: location!.region,
      country_code: location!.country_code,
      phone: location!.phone,
      email: location!.email,
      delivery_notes: location!.delivery_notes,
    },
    // The commercial parameters in force at the instant of the sale, recorded
    // so a historical order stays explainable after they change.
    p_pricing_snapshot: {
      markup_percent: DEFAULT_PRICING_SETTINGS.markupPercent,
      markup_provenance: DEFAULT_PRICING_SETTINGS.markupProvenance,
      vat_rate_percent: DEFAULT_PRICING_SETTINGS.vatRatePercent,
      vat_rate_provenance: DEFAULT_PRICING_SETTINGS.vatRateProvenance,
      pfu_vat_base: DEFAULT_PRICING_SETTINGS.pfuVatBase,
      snapshotted_at: now,
    },
    p_fulfilment_class: input.fulfilmentClass,
    p_payment_method: input.paymentMethod,
    p_currency: "EUR",
    p_monetary_status: basket.monetaryStatus,
    p_tyre_net_total_cents: basket.tyreNetTotalCents,
    p_pfu_total_cents: basket.pfuTotalCents,
    p_vat_total_cents: basket.vatTotalCents,
    p_grand_total_cents: basket.grandTotalCents,
    p_customer_note: input.note,
    p_items: resolved.map((line, index) => ({
      line_number: index + 1,
      catalogue_product_id: line.input.productId,
      // Internal sourcing reproducibility. Never reaches a customer payload.
      source_listing_id: line.internal.supplierListingId,
      quantity: line.input.quantity,
      tyre_snapshot: line.customer.tyre,
      condition_snapshot: line.input.oldDot ? "older_dot" : "normal",
      unit_tyre_net_cents: line.customer.tyreSaleNetCents,
      unit_pfu_cents: line.customer.pfuAmountCents,
      unit_vat_cents: line.customer.vatAmountCents,
      unit_total_cents: line.customer.customerTotalCents,
      pricing_status: basket.monetaryStatus,
      price_observed_at: line.internal.costObservedAt,
    })),
  };

  const { data, error } = await admin.rpc("create_portal_sales_order", payload);

  if (error) {
    // Lost the race against a concurrent retry carrying the same key. The
    // other request's order is the correct answer to this one.
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findByIdempotencyKey(input.session.customerId, input.idempotencyKey);
      if (raced) return raced;
    }
    throw error;
  }

  const order = (Array.isArray(data) ? data[0] : data) as CreatedSalesOrder | null;
  if (!order) throw new Error("SALES_ORDER_NOT_CREATED");
  return order;
}

/** A customer's own orders. Scoped by the SESSION's customer id, never a parameter from the client. */
export async function listCustomerSalesOrders(customerId: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_orders")
    .select("id,order_number,status,fulfilment_class,payment_method,currency,grand_total_cents,requested_at")
    .eq("customer_id", customerId)
    .order("requested_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

export async function listRequestedSalesOrders() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("sales_orders")
    .select(
      "id,order_number,status,customer_id,customer_snapshot,grand_total_cents,currency,fulfilment_class,payment_method,requested_at"
    )
    .eq("status", "requested")
    .order("requested_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function getSalesOrderDetail(orderId: string) {
  const admin = createSupabaseAdminClient();
  const [{ data: order, error: oe }, { data: items, error: ie }] = await Promise.all([
    admin.from("sales_orders").select("*").eq("id", orderId).maybeSingle(),
    admin
      .from("sales_order_items")
      .select(
        "id,line_number,catalogue_product_id,quantity,tyre_snapshot,condition_snapshot,unit_tyre_net_cents,unit_pfu_cents,unit_vat_cents,unit_total_cents,pricing_status"
      )
      .eq("sales_order_id", orderId)
      .order("line_number", { ascending: true }),
  ]);
  if (oe) throw oe;
  if (ie) throw ie;
  if (!order) return null;
  return { order, items: items ?? [] };
}
