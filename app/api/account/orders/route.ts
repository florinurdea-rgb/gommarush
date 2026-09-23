import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { logError } from "@/lib/logger";
import { readJsonBody } from "@/lib/server/route-helpers";
import { validateBasketLines } from "@/lib/server/customer-basket";
import { createPortalSalesOrder, FULFILMENT_CLASSES, PAYMENT_METHODS } from "@/lib/server/sales-orders";

export const runtime = "nodejs";

/**
 * Codes this route is willing to say out loud, and the status each carries.
 *
 * An allowlist rather than a mapping with a default, because the failure mode
 * being prevented is a message the customer should never see. Returning
 * `error.message` for anything unrecognised published raw PostgreSQL text —
 * constraint names, column names, occasionally a fragment of the row — to an
 * unauthenticated-adjacent audience.
 */
const CLIENT_SAFE: Record<string, number> = {
  PRICING_NOT_FINAL: 409,
  BASKET_ITEM_UNAVAILABLE: 409,
  BASKET_QUANTITY_UNAVAILABLE: 409,
  DELIVERY_ADDRESS_INVALID: 400,
  CUSTOMER_NOT_FOUND: 404,
};

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireCustomerSession();
  } catch {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, code: "VALIDATION_FAILED" }, { status: 400 });
  }

  const v = body as Record<string, unknown>;
  const lines = validateBasketLines(v.lines);
  if (
    !lines ||
    typeof v.locationId !== "string" ||
    typeof v.idempotencyKey !== "string" ||
    v.idempotencyKey.length < 12 ||
    v.idempotencyKey.length > 200 ||
    !PAYMENT_METHODS.includes(v.paymentMethod as never) ||
    !FULFILMENT_CLASSES.includes(v.fulfilmentClass as never) ||
    !(v.note === null || v.note === undefined || typeof v.note === "string")
  ) {
    return NextResponse.json({ ok: false, code: "VALIDATION_FAILED" }, { status: 400 });
  }

  try {
    const order = await createPortalSalesOrder({
      session,
      lines,
      locationId: v.locationId,
      paymentMethod: v.paymentMethod as (typeof PAYMENT_METHODS)[number],
      fulfilmentClass: v.fulfilmentClass as (typeof FULFILMENT_CLASSES)[number],
      note: typeof v.note === "string" ? v.note.trim().slice(0, 2000) || null : null,
      idempotencyKey: v.idempotencyKey,
    });
    return NextResponse.json({ ok: true, order }, { status: 201 });
  } catch (error) {
    const raw = error instanceof Error ? error.message : "";
    const status = CLIENT_SAFE[raw];
    if (status) return NextResponse.json({ ok: false, code: raw }, { status });

    // Everything else is ours to diagnose, not the customer's to read.
    logError("customer_sales_order_failed", error);
    return NextResponse.json({ ok: false, code: "ORDER_NOT_CREATED" }, { status: 500 });
  }
}
