import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { CustomerSession } from "@/lib/auth/customer-session";
import {
  basketIsOrderable,
  customerBasketPayload,
  resolveBasket,
  type BasketLineInput,
} from "@/lib/server/customer-basket";
import { liveVerificationMissing, verifyBasketLive } from "@/lib/server/live-availability";
import { isDeliverableLocation } from "@/lib/commerce/delivery-address";
import { fulfilmentPromise, type FulfilmentClass } from "@/lib/commerce/fulfilment";
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
  /**
   * The grand total the customer was shown and agreed to, in cents.
   *
   * THE PRICE GATE, and it is enforced here rather than in the browser. The
   * live check at confirm can move a price — a supplier changed it, or the
   * feed landed between adding the tyre and paying for it — and the customer
   * must not be able to press a button that creates an order at a number they
   * never saw. The server recomputes the total after verification and refuses
   * if it does not match what was accepted.
   *
   * Owner decision, 2026-09-24: the NEW price wins, and the change is shown
   * before the confirm re-enables. This field is what makes "shown" real.
   */
  acceptedTotalCents: number;
}

/**
 * A refusal the customer is allowed to read, carrying the state that caused it.
 *
 * A bare Error cannot hand back the recomputed basket, and without it the
 * checkout screen can only say "something changed" — which is exactly the
 * message that makes a customer abandon rather than adjust.
 */
export class OrderRefusal extends Error {
  constructor(
    readonly code:
      | "PRICING_NOT_FINAL"
      | "BASKET_NOT_ORDERABLE"
      | "PRICE_CHANGED"
      | "LIVE_VERIFICATION_UNAVAILABLE",
    readonly basket: ReturnType<typeof customerBasketPayload>
  ) {
    super(code);
    this.name = "OrderRefusal";
  }
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

  /*
    IDEMPOTENCY IS CHECKED BEFORE ANYTHING ELSE.

    It used to run after the basket was resolved and priced. A double-click
    therefore re-resolved the whole basket — and now would also make a second
    round of live supplier calls — before discovering that the first click had
    already created the order. The answer to a retry is the order that already
    exists, and nothing needs to be recomputed to give it.
  */
  const existing = await findByIdempotencyKey(input.session.customerId, input.idempotencyKey);
  if (existing) return existing;

  const resolved = await resolveBasket(input.lines);

  /*
    THE LIVE CHECK, at the last possible moment.

    Read-only protocol 103, Inter-Sprint lane only. verifyBasketLive itself
    never throws — a lane that could not answer is MARKED
    `feed_after_live_failure` — and the gate below then refuses to create the
    order on any such line (D27, fail closed). See live-availability.ts for
    the owner decisions behind those constraints.
  */
  /*
    `forceFresh`: the authoritative final check must be made NOW.

    Without it, an order confirmed within the cache window would be authorised
    by an answer obtained during a basket preview seconds earlier — a cached
    result standing in for the check that the order gate exists to perform.
  */
  const verification = await verifyBasketLive(resolved, Date.now, { forceFresh: true });
  const orderLines = [...verification.lines];
  const basket = customerBasketPayload(orderLines);

  /*
    THE ORDER GATE FAILS CLOSED ON VERIFICATION, and this is the first thing
    it checks.

    A line that HAS a live lane and did not get a live answer — credentials
    absent, gateway down, authentication rejected, response malformed, budget
    exhausted — is NOT an orderable line here, whatever the stored figure says.
    The basket may show that stored figure with its own distinct
    "could not confirm" state, because browsing on slightly old data costs
    nobody anything. Committing on it does: it would present stored catalogue
    data as though the supplier had confirmed it, and let an order through the
    live-validation gate precisely because the gate could not run.

    This SUPERSEDES the fail-open half of D22 for the order path only. D22's
    other half stands: a failure is never reported to the customer as
    out-of-stock. It is a verification state, and it is retryable.

    A line on a lane with NO live lookup is a different case and is untouched
    (D24): nothing was attempted, so nothing failed. That is not `isb` — the
    legacy workbook adapter attributes to the same `intersprint` lane as the
    live feed, so those listings are verified like any other. It is Deldo and
    Carlini, which are registered lanes with no implemented lookup.
  */
  if (liveVerificationMissing(orderLines)) {
    throw new OrderRefusal("LIVE_VERIFICATION_UNAVAILABLE", basket);
  }

  /*
    Availability second, price third, and all of them before the monetary gate.

    Order matters for the message the customer gets: a basket holding a tyre
    that just went out of stock should say so, not report a pricing problem
    caused by that line having no price to contribute.
  */
  if (!basketIsOrderable(orderLines)) {
    throw new OrderRefusal("BASKET_NOT_ORDERABLE", basket);
  }

  // Commercial safety gate: never label or persist an incomplete amount as a
  // final order total. While PFU and its VAT treatment are unresolved this
  // refuses every order, which is the intended behaviour and not a bug.
  if (basket.monetaryStatus !== "complete") {
    throw new OrderRefusal("PRICING_NOT_FINAL", basket);
  }

  if (basket.grandTotalCents !== input.acceptedTotalCents) {
    throw new OrderRefusal("PRICE_CHANGED", basket);
  }

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
      pfu_status: basket.pfuStatus,
      pfu_estimate_version: basket.pfuEstimateVersion,
      pfu_estimated: basket.pfuEstimated,
      delivery_promise_max_days: fulfilmentPromise(input.fulfilmentClass).maxDays,
      snapshotted_at: now,

      /*
        WHAT WAS ACTUALLY CHECKED, recorded per order.

        Not decoration. When a customer disputes an availability promise, or
        an operator wonders why a confirmed order could not be sourced, the
        answer turns on whether the supplier was asked at the moment of sale
        or whether a stored observation stood in. `availability_verified`
        is the weakest claim any line could make, so it never overstates.
      */
      availability_verified: basket.verifiedSource,
      availability_live_lines: verification.anyLive,
      availability_live_failure: verification.anyLiveFailure,
      availability_lines: orderLines.map((line) => ({
        product_id: line.input.productId,
        source: line.provenance.source,
        observed_at: line.provenance.observedAt,
        live_failure_reason: line.provenance.liveFailureReason ?? null,
      })),
      accepted_total_cents: input.acceptedTotalCents,
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

    // THE PFU PROVENANCE OF THIS ORDER, written as columns.
    //
    // An order created today rests on the temporary estimate. Recording the
    // status and the rule version means that when a verified tariff arrives,
    // these orders can be FOUND and re-quoted deliberately — rather than
    // quietly reinterpreted, or worse, left looking as though they had always
    // been priced against a real tariff.
    p_pfu_status: basket.pfuStatus,
    p_pfu_estimate_version: basket.pfuEstimateVersion,
    p_vat_rate_percent: DEFAULT_PRICING_SETTINGS.vatRatePercent,
    p_delivery_promise_max_days: fulfilmentPromise(input.fulfilmentClass).maxDays,

    /*
      Every line here is `available` — basketIsOrderable refused above
      otherwise — so `customer` and `internal` are both present. The
      non-null assertions record that fact rather than inventing a fallback
      amount, which is the one thing that must never happen on an order line.
    */
    p_items: orderLines.map((line, index) => ({
      line_number: index + 1,
      catalogue_product_id: line.input.productId,
      // Internal sourcing reproducibility. Never reaches a customer payload.
      source_listing_id: line.internal!.supplierListingId,
      quantity: line.input.quantity,
      tyre_snapshot: line.customer!.tyre,
      condition_snapshot: line.input.oldDot ? "older_dot" : "normal",
      unit_tyre_net_cents: line.customer!.tyreSaleNetCents,
      unit_pfu_cents: line.customer!.pfuAmountCents,
      unit_vat_cents: line.customer!.vatAmountCents,
      unit_total_cents: line.customer!.customerTotalCents,
      pricing_status: basket.monetaryStatus,
      pfu_status: line.customer!.pfuStatus,
      pfu_estimate_version: line.customer!.pfuEstimateVersion,
      vat_rate_percent: DEFAULT_PRICING_SETTINGS.vatRatePercent,
      price_observed_at: line.internal!.costObservedAt,
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

/**
 * One of the CUSTOMER'S OWN orders, for the customer's own detail screen.
 *
 * Ownership is a FILTER, not a check after the fact: an order id belonging to
 * another customer resolves to no row, so it cannot be read and cannot be
 * probed for existence. That is the same rule the delivery-location lookup
 * uses, and it is the reason this exists separately from getSalesOrderDetail
 * below — that one takes an id alone, which is correct for an operator and
 * would be an authorisation hole here.
 *
 * The projection is explicit and deliberately narrow. `sales_orders` holds a
 * pricing snapshot containing commercial settings and verification
 * provenance; none of it is selected, so none of it can reach a customer
 * payload by someone later adding a field to a spread.
 */
export interface CustomerSalesOrderView {
  id: string;
  order_number: number;
  status: string;
  fulfilment_class: string;
  payment_method: string;
  currency: string;
  tyre_net_total_cents: number | null;
  pfu_total_cents: number | null;
  vat_total_cents: number | null;
  grand_total_cents: number | null;
  vat_rate_percent: number | null;
  pfu_status: string | null;
  customer_note: string | null;
  delivery_snapshot: Record<string, unknown> | null;
  requested_at: string;
}

export interface CustomerSalesOrderItemView {
  id: string;
  line_number: number;
  quantity: number;
  tyre_snapshot: Record<string, unknown> | null;
  condition_snapshot: string | null;
  unit_tyre_net_cents: number | null;
  unit_pfu_cents: number | null;
  unit_vat_cents: number | null;
  unit_total_cents: number | null;
}

export async function getCustomerSalesOrderDetail(
  orderId: string,
  customerId: string
): Promise<{ order: CustomerSalesOrderView; items: CustomerSalesOrderItemView[] } | null> {
  const admin = createSupabaseAdminClient();
  const { data: order, error: oe } = await admin
    .from("sales_orders")
    .select(
      "id,order_number,status,fulfilment_class,payment_method,currency," +
        "tyre_net_total_cents,pfu_total_cents,vat_total_cents,grand_total_cents," +
        "vat_rate_percent,pfu_status,customer_note,delivery_snapshot,requested_at"
    )
    .eq("id", orderId)
    .eq("customer_id", customerId)
    .maybeSingle();
  if (oe) throw oe;
  if (!order) return null;

  const { data: items, error: ie } = await admin
    .from("sales_order_items")
    .select(
      "id,line_number,quantity,tyre_snapshot,condition_snapshot," +
        "unit_tyre_net_cents,unit_pfu_cents,unit_vat_cents,unit_total_cents"
    )
    .eq("sales_order_id", orderId)
    .order("line_number", { ascending: true });
  if (ie) throw ie;

  return {
    order: order as unknown as CustomerSalesOrderView,
    items: (items ?? []) as unknown as CustomerSalesOrderItemView[],
  };
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
