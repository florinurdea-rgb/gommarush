import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import {
  customerBasketPayload,
  customerBasketView,
  resolveBasket,
  validateBasketLines,
} from "@/lib/server/customer-basket";
import { readJsonBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * Re-prices and re-checks a basket against the CATALOGUE — no supplier call.
 *
 * OWNER DECISION, 2026-09-26 (supersedes D26 for browsing): the live supplier
 * check does NOT run while the customer browses, adds, edits quantities, views
 * the basket or opens checkout. It runs once, force-fresh, at final order
 * confirmation (createPortalSalesOrder), which remains the fail-closed gate
 * (D27): live quantity, live price re-derived through the pricing engine,
 * accepted-total check, LIVE_VERIFICATION_UNAVAILABLE when the check cannot
 * complete.
 *
 * What this route still does: `resolveBasket` re-resolves each product, its
 * sellability and GommaRush's selling price from current catalogue data, so
 * the basket and checkout always show server-computed figures. The browser is
 * never authoritative for any of them.
 *
 * IT NEVER FAILS THE WHOLE BASKET. Every line carries its own verdict, and
 * `basket.orderable` is the single gate the checkout button reads.
 */
export async function POST(request: NextRequest) {
  try {
    await requireCustomerSession();
  } catch {
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = await readJsonBody(request);
  const lines = validateBasketLines((body as Record<string, unknown> | null)?.lines);
  if (!lines) return NextResponse.json({ ok: false, code: "VALIDATION_FAILED" }, { status: 400 });

  const resolved = await resolveBasket(lines);

  return NextResponse.json({
    ok: true,
    basket: customerBasketView(customerBasketPayload(resolved)),
  });
}
