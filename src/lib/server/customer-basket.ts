import "server-only";
import { searchCatalogue } from "@/lib/server/catalogue-search";
import type { CustomerTyreOffer, InternalTyreOffer } from "@/lib/pricing/projection";

/**
 * Basket resolution.
 *
 * TRUST BOUNDARY. The browser stores three facts per line — which canonical
 * product, which stock condition, how many — and nothing else. No price, no
 * supplier, no availability. Every preview and every checkout re-resolves the
 * current product, its sellability, GommaRush's current selling price and the
 * PFU/tax state from the database. A price the browser sends is not merely
 * ignored; there is no field to send it in.
 *
 * Supplier selection happens here, internally: the basket chooses the cheapest
 * sellable listing so the order records which one it was for sourcing. That
 * choice never leaves the server.
 */

export interface BasketLineInput {
  productId: string;
  oldDot: boolean;
  quantity: number;
}

export interface BasketResolvedLine {
  input: BasketLineInput;
  customer: CustomerTyreOffer;
  internal: InternalTyreOffer;
}

export function validateBasketLines(value: unknown): BasketLineInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const out: BasketLineInput[] = [];
  const seen = new Set<string>();
  for (const x of value) {
    if (!x || typeof x !== "object") return null;
    const v = x as Record<string, unknown>;
    if (
      typeof v.productId !== "string" ||
      v.productId.length < 8 ||
      v.productId.length > 64 ||
      typeof v.oldDot !== "boolean" ||
      !Number.isInteger(v.quantity) ||
      Number(v.quantity) < 1 ||
      Number(v.quantity) > 100
    ) {
      return null;
    }
    // One line per product+condition. Duplicates would be priced twice and
    // written as two order lines for the same tyre.
    const key = `${v.productId}:${v.oldDot ? "1" : "0"}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ productId: v.productId, oldDot: v.oldDot, quantity: Number(v.quantity) });
  }
  return out;
}

/**
 * The quantity a listing can evidence.
 *
 * An exact count where the supplier gave one, otherwise the FLOOR of a band —
 * `> 20` evidences 20, never 21 and never an estimate. Null means the supplier
 * said nothing, which is not the same as zero and is handled by sellability.
 */
function evidencedQuantity(offer: InternalTyreOffer): number | null {
  return offer.supplierStockExact ?? offer.supplierStockMinimum;
}

/**
 * Re-resolves every line against current data.
 *
 * Chooses the cheapest sellable listing that can evidence the requested
 * quantity. Quantity matters to the choice, not only to the check: the
 * cheapest listing holding 6 is the wrong source for an order of 20 when a
 * slightly dearer one holds 40, and picking the cheapest first and rejecting
 * afterwards would refuse an order GommaRush can actually fill.
 */
export async function resolveBasket(lines: BasketLineInput[]): Promise<BasketResolvedLine[]> {
  const out: BasketResolvedLine[] = [];

  for (const input of lines) {
    const result = await searchCatalogue({
      productId: input.productId,
      oldDot: input.oldDot,
      limit: 100,
    });

    const sellable = result.internal.filter((x) => x.sellable && x.tyreSaleNetCents !== null);
    if (sellable.length === 0) throw new Error("BASKET_ITEM_UNAVAILABLE");

    const sufficient = sellable.filter((x) => {
      const evidenced = evidencedQuantity(x);
      return evidenced !== null && evidenced >= input.quantity;
    });

    // Refused rather than accepted-and-flagged. An order carries a price for
    // a quantity; recording a price for 40 tyres against evidence of 6 is a
    // commitment the supplier data does not support, and the customer would
    // learn of it only after a human noticed.
    if (sufficient.length === 0) throw new Error("BASKET_QUANTITY_UNAVAILABLE");

    sufficient.sort(
      (a, b) =>
        (a.tyreSaleNetCents ?? Number.MAX_SAFE_INTEGER) -
          (b.tyreSaleNetCents ?? Number.MAX_SAFE_INTEGER) ||
        a.supplierListingId.localeCompare(b.supplierListingId)
    );
    const chosen = sufficient[0];

    // Matched on the listing, not on a price equality: two listings of the
    // same tyre at the same price would otherwise be interchangeable here, and
    // the customer line could describe a different one from the internal line
    // the order records for sourcing.
    const customer = result.customerByListingId.get(chosen.supplierListingId);
    if (!customer) throw new Error("BASKET_ITEM_UNAVAILABLE");

    out.push({ input, customer, internal: chosen });
  }

  return out;
}

/**
 * The customer-facing basket.
 *
 * A total is produced only when EVERY line is monetarily complete. A partial
 * sum would read as a price, and a price a customer sees is a price they
 * expect to pay.
 */
export function customerBasketPayload(lines: BasketResolvedLine[]) {
  const tyreNetTotalCents = lines.reduce(
    (sum, l) => sum + (l.customer.tyreSaleNetCents ?? 0) * l.input.quantity,
    0
  );
  const allFinal = lines.every((l) => l.customer.customerTotalCents !== null);
  const resolutions = lines.map((l) => l.internal.resolution);
  const monetaryStatus = allFinal
    ? "complete"
    : resolutions.some((r) => r === "pfu_unresolved")
      ? "pending_pfu"
      : "pending_tax_policy";

  return {
    lines: lines.map((l) => ({
      productId: l.input.productId,
      oldDot: l.input.oldDot,
      quantity: l.input.quantity,
      tyre: l.customer.tyre,
      availability: l.customer.availability,
      unitTyreNetCents: l.customer.tyreSaleNetCents,
      pfuStatus: l.customer.pfuStatus,
      unitPfuCents: l.customer.pfuAmountCents,
      unitVatCents: l.customer.vatAmountCents,
      unitTotalCents: l.customer.customerTotalCents,
    })),
    currency: "EUR",
    tyreNetTotalCents,
    pfuTotalCents: allFinal
      ? lines.reduce((s, l) => s + (l.customer.pfuAmountCents ?? 0) * l.input.quantity, 0)
      : null,
    vatTotalCents: allFinal
      ? lines.reduce((s, l) => s + (l.customer.vatAmountCents ?? 0) * l.input.quantity, 0)
      : null,
    grandTotalCents: allFinal
      ? lines.reduce((s, l) => s + (l.customer.customerTotalCents ?? 0) * l.input.quantity, 0)
      : null,
    monetaryStatus,
  };
}
