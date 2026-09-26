// GommaRush selling policy: what we are willing to OFFER, as distinct from
// what a supplier happens to hold.
//
// THE DISTINCTION THIS FILE EXISTS TO PROTECT:
//
//   supplier stock   a fact about the world. 3 tyres means 3 tyres.
//   sellability      a GommaRush decision about whether to put it in front of
//                    a customer.
//
// Collapsing the two is tempting and destructive in both directions. Writing a
// suppressed listing's stock down to 0 destroys a true fact that sourcing,
// consolidation and supplier conversations all need. Publishing everything the
// supplier holds means promising a customer a tyre out of a pool of three,
// which is how an order is accepted and then cannot be filled.
//
// So nothing here ever modifies a stock figure. It answers one question —
// may this be offered? — and gives a reason either way.
//
// Pure: no database, no I/O.

/** Whatever the supplier told us about availability, unaltered. */
export interface StockObservationView {
  /** An exact count where the supplier gave one. 0 is a real answer. */
  readonly stockExact: number | null;
  /** The floor of a band ('>  20' -> 20). Null when no band was given. */
  readonly stockMinimum: number | null;
}

export type SellabilityReason =
  /** Offerable. */
  | "sellable"
  /** The supplier stated a quantity below the configured floor. */
  | "below_minimum_offer_quantity"
  /** The supplier stated zero. */
  | "supplier_out_of_stock"
  /** Neither a count nor a band — we do not know, so we do not offer. */
  | "stock_unknown";

export interface SellabilityDecision {
  readonly sellable: boolean;
  readonly reason: SellabilityReason;
  /**
   * The quantity the decision was taken against, for audit. Null when stock
   * was unknown. This is a COPY for explanation; it never replaces the
   * observation it came from.
   */
  readonly assessedQuantity: number | null;
  /** The floor applied, so a suppressed listing can be explained exactly. */
  readonly minimumApplied: number;
}

/**
 * The offer policy in force.
 *
 * Shaped as a lookup rather than a constant so the floor can later differ by
 * supplier, customer or channel without the importer, the adapter or the
 * catalogue query changing at all. That extensibility is the point of the
 * indirection; the overrides themselves are deliberately not implemented yet.
 */
export interface SellingPolicy {
  /**
   * Fewest tyres a listing must show before GommaRush will offer it.
   *
   * OWNER DECISION, 2026-09-22: 5. It is a GommaRush selling rule and NOT an
   * Inter-Sprint stock semantic — Inter-Sprint publishes 3 and 4 quite
   * happily, and those remain true figures that we simply decline to sell
   * from.
   */
  readonly minimumOfferQuantity: number;
  /** Per-supplier overrides, by lane code. None configured yet. */
  readonly bySupplier?: Readonly<Record<string, number>>;
  /** Per-channel overrides, e.g. 'portal' vs 'whatsapp'. None configured yet. */
  readonly byChannel?: Readonly<Record<string, number>>;
}

export const DEFAULT_SELLING_POLICY: SellingPolicy = {
  minimumOfferQuantity: 5,
};

export interface SellabilityInput {
  readonly stock: StockObservationView;
  /** Lane code, e.g. 'intersprint'. Selects a per-supplier override. */
  readonly laneCode?: string | null;
  /** Sales channel. Selects a per-channel override. */
  readonly channel?: string | null;
}

/**
 * The floor that applies, most specific first: channel, then supplier, then
 * the default.
 */
export function minimumOfferQuantityFor(
  input: Pick<SellabilityInput, "laneCode" | "channel">,
  policy: SellingPolicy = DEFAULT_SELLING_POLICY
): number {
  if (input.channel && policy.byChannel?.[input.channel] !== undefined) {
    return policy.byChannel[input.channel];
  }
  if (input.laneCode && policy.bySupplier?.[input.laneCode] !== undefined) {
    return policy.bySupplier[input.laneCode];
  }
  return policy.minimumOfferQuantity;
}

/**
 * Decides whether a listing may be offered to a customer.
 *
 * A BAND SATISFIES THE FLOOR ON ITS FLOOR, not on a resolved quantity.
 * '>  20' means at least 21, so it clears a minimum of 5 without anyone ever
 * deciding what the real number is. This is the common case — 7,991 of 9,559
 * Inter-Sprint rows — and resolving the band to compare it would invent
 * availability across most of the catalogue.
 *
 * Unknown stock is not sellable. That is not the same as out of stock, and the
 * reason code keeps the two apart so a report can distinguish "the supplier
 * has none" from "the supplier did not say".
 */
export function assessSellability(
  input: SellabilityInput,
  policy: SellingPolicy = DEFAULT_SELLING_POLICY
): SellabilityDecision {
  const minimum = minimumOfferQuantityFor(input, policy);
  const { stockExact, stockMinimum } = input.stock;

  if (stockExact === null && stockMinimum === null) {
    return {
      sellable: false,
      reason: "stock_unknown",
      assessedQuantity: null,
      minimumApplied: minimum,
    };
  }

  // The best figure the supplier gave: an exact count when there is one, else
  // the floor of the band. Never an average, never a midpoint.
  const assessed = stockExact ?? (stockMinimum as number);

  if (assessed === 0) {
    return {
      sellable: false,
      reason: "supplier_out_of_stock",
      assessedQuantity: 0,
      minimumApplied: minimum,
    };
  }

  if (assessed < minimum) {
    return {
      sellable: false,
      reason: "below_minimum_offer_quantity",
      assessedQuantity: assessed,
      minimumApplied: minimum,
    };
  }

  return {
    sellable: true,
    reason: "sellable",
    assessedQuantity: assessed,
    minimumApplied: minimum,
  };
}
