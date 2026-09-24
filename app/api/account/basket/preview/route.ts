import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { customerBasketPayload, resolveBasket, validateBasketLines } from "@/lib/server/customer-basket";
import { verifyBasketLive } from "@/lib/server/live-availability";
import { readJsonBody } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * Re-prices and re-checks a basket against CURRENT data.
 *
 * TWO STAGES, AND BOTH MATTER.
 *
 *   resolveBasket     re-resolves the product, its sellability and GommaRush's
 *                     selling price from the catalogue. This is what decides
 *                     WHICH source a line would be filled from, and it is a
 *                     database read.
 *   verifyBasketLive  then asks the supplier for the real current quantity and
 *                     price behind that choice, and re-decides the line.
 *
 * THE SECOND STAGE IS WHY THIS ROUTE EXISTS IN THIS SHAPE. It previously
 * stopped after the first, so a quantity change was checked against imported
 * catalogue state — a customer could reduce a line until the stored figure
 * accepted it, be told it was fine, and have the order refused seconds later
 * by the check that actually counts. That is the gap this closes, and it
 * supersedes the earlier confirm-only restriction (D21).
 *
 * IT IS NOT A SECOND VALIDATION ENGINE. Both stages are the same modules the
 * order path calls, in the same order, so the answer this screen shows and the
 * answer the order gate gives are produced by one implementation.
 *
 * THE ORDER GATE STILL RUNS ANYWAY. Nothing here authorises anything: a
 * browser can send whatever it likes to /api/account/orders, which resolves,
 * verifies and re-checks the accepted total again before writing a row.
 *
 * IT NEVER FAILS THE WHOLE BASKET. One tyre running short used to return 409
 * for the entire request, which told the customer something was wrong and not
 * which line or what to do. Every line carries its own verdict, and
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
  const verification = await verifyBasketLive(resolved);

  return NextResponse.json({
    ok: true,
    basket: customerBasketPayload([...verification.lines]),
  });
}
