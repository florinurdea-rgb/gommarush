import "server-only";
import { searchCatalogue } from "@/lib/server/catalogue-search";
import { DEFAULT_FULFILMENT_CLASS, fulfilmentPromise } from "@/lib/commerce/fulfilment";
import { DEFAULT_PRICING_SETTINGS, type PricingSettings } from "@/lib/pricing/settings";
import type { CustomerTyreOffer, InternalTyreOffer, TyreSpecView } from "@/lib/pricing/projection";

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

/**
 * Why a line cannot be ordered as asked.
 *
 * `limited` is NOT a failure: the tyre exists and is sellable, there is simply
 * less of it than the customer asked for. Collapsing it into `unavailable`
 * would throw away the one number that lets them fix it themselves.
 */
export type BasketLineAvailability =
  | { readonly state: "available" }
  /** Sellable, but the evidenced stock is below the requested quantity. */
  | { readonly state: "limited"; readonly availableQuantity: number }
  | {
      readonly state: "unavailable";
      /** `not_stocked`: no sellable listing. `out_of_stock`: none with stock. */
      readonly reason: "not_stocked" | "out_of_stock" | "unknown_product";
    };

/**
 * Where the availability figure came from, and how old it is.
 *
 * Carried on every line, always — including the lines nothing live was ever
 * asked about. A screen that says "verified" must be able to say verified
 * against WHAT, and an order must record what was actually checked rather
 * than implying a live confirmation it never had.
 */
export type AvailabilitySource =
  /** Confirmed against the supplier's live API in this request. */
  | "live"
  /** The stored feed observation. No live lane exists for this listing. */
  | "feed"
  /** A live lane exists but did not answer; the stored observation stands. */
  | "feed_after_live_failure";

export interface AvailabilityProvenance {
  readonly source: AvailabilitySource;
  /** When the figure behind this line was observed. Null when unknown. */
  readonly observedAt: string | null;
  /** Why the live lane did not answer. Only set for feed_after_live_failure. */
  readonly liveFailureReason?: string;
}

export interface BasketResolvedLine {
  input: BasketLineInput;
  /**
   * The tyre, whatever its availability.
   *
   * Present even when nothing is sellable, because an unavailable line still
   * has to be readable and still has to be able to offer alternatives in its
   * own size. Null only when the product has left the catalogue entirely, and
   * then there is genuinely nothing to say about it.
   */
  tyre: TyreSpecView | null;
  /** Null when no sellable, priced listing exists. */
  customer: CustomerTyreOffer | null;
  internal: InternalTyreOffer | null;
  availability: BasketLineAvailability;
  provenance: AvailabilityProvenance;
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

/** The cheapest of a set of offers, with listing id as the tie-break. */
function cheapest(offers: InternalTyreOffer[]): InternalTyreOffer {
  return [...offers].sort(
    (a, b) =>
      (a.tyreSaleNetCents ?? Number.MAX_SAFE_INTEGER) -
        (b.tyreSaleNetCents ?? Number.MAX_SAFE_INTEGER) ||
      a.supplierListingId.localeCompare(b.supplierListingId)
  )[0];
}

/**
 * Re-resolves every line against current data.
 *
 * PER LINE, NOT PER BASKET. This used to throw BASKET_ITEM_UNAVAILABLE for the
 * whole basket the moment one tyre ran short, which gave the customer an error
 * banner and no way to find out WHICH tyre, let alone what to do about it.
 * Every line now comes back with its own verdict, and the basket decides
 * separately whether the set as a whole can be ordered.
 *
 * Quantity matters to the CHOICE of listing, not only to the check: the
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

    // Taken from ANY listing, sellable or not: the tyre's identity is a fact
    // about the product, and an unavailable line still has to name itself.
    const tyre = result.internal[0]?.tyre ?? null;

    const feedProvenance = (offer: InternalTyreOffer | null): AvailabilityProvenance => ({
      source: "feed",
      observedAt: offer?.costObservedAt ?? result.internal[0]?.costObservedAt ?? null,
    });

    if (tyre === null) {
      out.push({
        input,
        tyre: null,
        customer: null,
        internal: null,
        availability: { state: "unavailable", reason: "unknown_product" },
        provenance: { source: "feed", observedAt: null },
      });
      continue;
    }

    const sellable = result.internal.filter((x) => x.sellable && x.tyreSaleNetCents !== null);
    if (sellable.length === 0) {
      out.push({
        input,
        tyre,
        customer: null,
        internal: null,
        availability: { state: "unavailable", reason: "not_stocked" },
        provenance: feedProvenance(null),
      });
      continue;
    }

    const sufficient = sellable.filter((x) => {
      const evidenced = evidencedQuantity(x);
      return evidenced !== null && evidenced >= input.quantity;
    });

    const chosen = sufficient.length > 0 ? cheapest(sufficient) : null;

    if (chosen !== null) {
      // Matched on the listing, not on a price equality: two listings of the
      // same tyre at the same price would otherwise be interchangeable here,
      // and the customer line could describe a different one from the internal
      // line the order records for sourcing.
      const customer = result.customerByListingId.get(chosen.supplierListingId) ?? null;
      out.push({
        input,
        tyre,
        customer,
        internal: chosen,
        availability:
          customer === null
            ? { state: "unavailable", reason: "not_stocked" }
            : { state: "available" },
        provenance: feedProvenance(chosen),
      });
      continue;
    }

    /*
      Short. Report HOW SHORT rather than refusing.

      The best a line can be filled from is the largest quantity any single
      sellable listing evidences — not the sum across listings. Splitting one
      customer line across two supplier listings is a sourcing decision with
      its own cost and lead-time consequences, and inventing it here would
      promise a delivery the order model does not describe.
    */
    const best = sellable
      .map((offer) => ({ offer, evidenced: evidencedQuantity(offer) ?? 0 }))
      .filter((x) => x.evidenced > 0)
      .sort((a, b) => b.evidenced - a.evidenced);

    if (best.length === 0) {
      out.push({
        input,
        tyre,
        customer: null,
        internal: null,
        availability: { state: "unavailable", reason: "out_of_stock" },
        provenance: feedProvenance(sellable[0]),
      });
      continue;
    }

    const availableQuantity = best[0].evidenced;
    const contenders = best.filter((x) => x.evidenced >= availableQuantity).map((x) => x.offer);
    const offer = cheapest(contenders);

    out.push({
      input,
      tyre,
      customer: result.customerByListingId.get(offer.supplierListingId) ?? null,
      internal: offer,
      availability: { state: "limited", availableQuantity },
      provenance: feedProvenance(offer),
    });
  }

  return out;
}

/** True when every line can be ordered exactly as the customer asked. */
export function basketIsOrderable(lines: readonly BasketResolvedLine[]): boolean {
  return lines.length > 0 && lines.every((line) => line.availability.state === "available");
}

/**
 * The customer-facing basket.
 *
 * A total is produced only when EVERY line is monetarily complete. A partial
 * sum would read as a price, and a price a customer sees is a price they
 * expect to pay.
 *
 * An UNAVAILABLE line still appears, with its tyre, its verdict and the size
 * needed to find a replacement — it is simply worth nothing and makes the
 * basket unorderable. Dropping it would leave the customer looking for a tyre
 * they believed they had added.
 */
export function customerBasketPayload(
  lines: BasketResolvedLine[],
  settings: PricingSettings = DEFAULT_PRICING_SETTINGS
) {
  /** Only the lines that could actually be priced contribute to a total. */
  const priced = lines.filter(
    (l): l is BasketResolvedLine & { customer: CustomerTyreOffer } => l.customer !== null
  );

  const tyreNetTotalCents = priced.reduce(
    (sum, l) => sum + (l.customer.tyreSaleNetCents ?? 0) * l.input.quantity,
    0
  );

  /*
    A TOTAL IS SHOWN ONLY FOR A BASKET THAT CAN BE BOUGHT.

    Every line monetarily complete is not enough on its own: a basket holding
    an unavailable tyre has no total, because the number would describe a
    purchase that cannot happen. `orderable` and `monetaryStatus` answer two
    different questions and both have to be yes.
  */
  const orderable = basketIsOrderable(lines);
  const allFinal =
    priced.length === lines.length && priced.every((l) => l.customer.customerTotalCents !== null);
  const resolutions = priced.map((l) => l.internal?.resolution);
  const monetaryStatus = allFinal
    ? "complete"
    : resolutions.some((r) => r === "pfu_unresolved")
      ? "pending_pfu"
      : resolutions.some((r) => r === "vat_policy_unresolved")
        ? "pending_tax_policy"
        : "pending_availability";

  const totalsAvailable = allFinal && orderable;

  return {
    lines: lines.map((l) => ({
      productId: l.input.productId,
      oldDot: l.input.oldDot,
      quantity: l.input.quantity,
      tyre: l.customer?.tyre ?? l.tyre,
      availability: l.customer?.availability ?? "unknown",

      /**
       * The verdict this whole rework exists for, and the size that lets the
       * customer act on it. `tyre` above already carries width/aspect/rim, so
       * "see alternatives" is a link the client can build without a second
       * request.
       */
      state: l.availability.state,
      availableQuantity:
        l.availability.state === "limited" ? l.availability.availableQuantity : null,
      unavailableReason:
        l.availability.state === "unavailable" ? l.availability.reason : null,

      /** What was checked, and when. Never implies a live answer it lacks. */
      verifiedSource: l.provenance.source,
      verifiedAt: l.provenance.observedAt,

      unitTyreNetCents: l.customer?.tyreSaleNetCents ?? null,
      pfuStatus: l.customer?.pfuStatus ?? "TO_CONFIRM",
      unitPfuCents: l.customer?.pfuAmountCents ?? null,
      unitVatCents: l.customer?.vatAmountCents ?? null,
      unitTotalCents: l.customer?.customerTotalCents ?? null,
    })),
    currency: "EUR",
    tyreNetTotalCents,
    pfuTotalCents: totalsAvailable
      ? priced.reduce((s, l) => s + (l.customer.pfuAmountCents ?? 0) * l.input.quantity, 0)
      : null,
    vatTotalCents: totalsAvailable
      ? priced.reduce((s, l) => s + (l.customer.vatAmountCents ?? 0) * l.input.quantity, 0)
      : null,
    grandTotalCents: totalsAvailable
      ? priced.reduce((s, l) => s + (l.customer.customerTotalCents ?? 0) * l.input.quantity, 0)
      : null,
    monetaryStatus,

    /** The single gate the checkout button and the order route both read. */
    orderable,

    /**
     * The strongest claim the basket as a whole can make about verification.
     *
     * Weakest wins: one line that fell back to the feed makes the basket's
     * answer "feed", because a customer told "checked live" must be able to
     * rely on it for every line, not most of them.
     */
    verifiedSource: weakestSource(lines),

    /**
     * The tax position, stated so the basket can explain what is still
     * missing rather than just showing a blank.
     *
     * `vatRatePercent` is the Italian ordinary rate — public law, and not the
     * same thing as the engine's internal `vatRatePercentApplied` resolution
     * field, which stays out of every customer payload. `pfuInVatBase` is the
     * owner's D11 decision, which is now settled; the tariff (D3) is not.
     */
    vatRatePercent: settings.vatRatePercent,
    pfuInVatBase: settings.pfuVatBase === "inside_vat_base",

    /**
     * True when ANY line's PFU is the temporary estimate.
     *
     * Any, not all: one estimated line makes the whole total provisional, and
     * a customer reading a single grand total must be told so.
     */
    pfuEstimated: priced.some((l) => l.customer.pfuEstimated),
    pfuEstimateVersion:
      priced.find((l) => l.customer.pfuEstimateVersion)?.customer.pfuEstimateVersion ?? null,
    /** The strongest-to-weakest PFU provenance across the lines, for the snapshot. */
    pfuStatus: priced.some((l) => l.customer.pfuEstimated)
      ? "ESTIMATED"
      : (priced[0]?.customer.pfuStatus ?? "TO_CONFIRM"),

    /** GommaRush's delivery commitment, by service class, never by supplier. */
    fulfilment: {
      class: fulfilmentPromise(DEFAULT_FULFILMENT_CLASS).class,
      maxDays: fulfilmentPromise(DEFAULT_FULFILMENT_CLASS).maxDays,
    },
  };
}

const SOURCE_STRENGTH: Record<AvailabilitySource, number> = {
  live: 2,
  feed: 1,
  feed_after_live_failure: 0,
};

function weakestSource(lines: readonly BasketResolvedLine[]): AvailabilitySource {
  let weakest: AvailabilitySource = "live";
  for (const line of lines) {
    if (SOURCE_STRENGTH[line.provenance.source] < SOURCE_STRENGTH[weakest]) {
      weakest = line.provenance.source;
    }
  }
  return weakest;
}
