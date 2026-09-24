import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { customerBasketPayload, resolveBasket, validateBasketLines } from "@/lib/server/customer-basket";
import { readJsonBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * Re-prices and re-checks a basket against current data.
 *
 * NO SUPPLIER CALL HAPPENS HERE. This runs on every quantity change, so it
 * answers from the stored feed: instant, free, and accurate to the last
 * import. The live supplier lookup is reserved for the final confirm, where a
 * promise is actually made — owner decision, 2026-09-24, and the reasoning is
 * in src/lib/server/live-availability.ts.
 *
 * IT NO LONGER FAILS THE WHOLE BASKET. One tyre running short used to return
 * 409 BASKET_ITEM_UNAVAILABLE for the entire request, which told the customer
 * something was wrong and not which line or what to do. Every line now carries
 * its own verdict, and `basket.orderable` is the single gate the checkout
 * button reads.
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

  return NextResponse.json({ ok: true, basket: customerBasketPayload(await resolveBasket(lines)) });
}
