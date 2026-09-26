// Inter-Sprint commercial policy.
//
// EVERYTHING HERE IS A GOMMARUSH OWNER DECISION, not an Inter-Sprint document.
// That distinction is the whole reason this file is separate from
// docs/suppliers/intersprint/README.md and from the feed adapter: the adapter
// records what the supplier's file says, and this records what the business
// has decided the file MEANS.
//
// Keeping them apart matters because they age differently and are challenged
// differently. A supplier fact is re-verified by reopening their artefact; an
// owner decision is re-verified by asking the owner. Presenting the second as
// the first would make a business judgement look like a supplier commitment.
//
// Pure: no database, no I/O.

import type { FeedCommercialMode } from "@/lib/suppliers/observation";

/**
 * Where a commercial statement came from.
 *
 * `POLICY_OWNER` is a GommaRush business decision. `SUPPLIER_DOCUMENTED` would
 * mean a citable supplier artefact. Nothing in this file is the latter, and
 * nothing here may be relabelled as such without a document to point at.
 */
export type CommercialProvenance = "POLICY_OWNER" | "SUPPLIER_DOCUMENTED" | "UNCONFIRMED";

/** The tyre categories Inter-Sprint releases under different minimums. */
export type IntersprintCategory = "pcr" | "truck";

export interface IntersprintCommercialPolicy {
  /**
   * That `nett-price` is the net purchase price GommaRush pays.
   *
   * OWNER-CONFIRMED 2026-09-22. M8 carried every observation as
   * `commercialMode: "unknown"` precisely because this was unstated, which
   * made every Inter-Sprint price commercially unusable. This decision is what
   * unblocks it — and it is the owner's, not a line in a supplier file.
   */
  readonly netPriceIsPurchaseCost: boolean;
  readonly netPriceProvenance: CommercialProvenance;

  /**
   * Minimum release quantities at which Inter-Sprint includes transport.
   *
   * OWNER-CONFIRMED. Below the minimum, transport is NOT included, so the same
   * `nett-price` means something different — which is exactly why the mode is
   * resolved per order rather than fixed per row.
   */
  readonly minimumReleaseQuantity: Readonly<Record<IntersprintCategory, number>>;
  readonly minimumReleaseProvenance: CommercialProvenance;

  /**
   * Currency. Left null deliberately.
   *
   * The feed has no currency column — verified across all 9,559 sample rows —
   * and no Inter-Sprint document in this repository states one. Inter-Sprint
   * is Dutch and euros are the obvious inference, but an inferred currency on
   * a purchase price is the class of silent error this integration exists to
   * avoid. The owner confirmed what `nett-price` IS, not what it is
   * denominated in, so this stays open rather than being quietly filled in.
   */
  readonly currency: string | null;
  readonly currencyProvenance: CommercialProvenance;
}

export const INTERSPRINT_COMMERCIAL_POLICY: IntersprintCommercialPolicy = {
  netPriceIsPurchaseCost: true,
  netPriceProvenance: "POLICY_OWNER",

  minimumReleaseQuantity: { pcr: 60, truck: 10 },
  minimumReleaseProvenance: "POLICY_OWNER",

  currency: null,
  currencyProvenance: "UNCONFIRMED",
};

/**
 * Which minimum applies to a catalogue product class.
 *
 * The feed itself carries no category flag; the PCR and truck files are
 * separate deliveries, and the catalogue's own product_class is the durable
 * signal. An unrecognised class resolves to the PCR minimum of 60 — the
 * HIGHER of the two — because being wrong in the direction of "we have not
 * reached the minimum" costs a transport charge we expected, while the
 * opposite promises free transport we were never entitled to.
 */
export function categoryForProductClass(productClass: string | null): IntersprintCategory {
  if (productClass === "truck" || productClass === "light_truck_van") return "truck";
  return "pcr";
}

export interface CommercialModeInput {
  readonly category: IntersprintCategory;
  /** Units of the SUPPLIER RELEASE this line belongs to, not units sold. */
  readonly releaseQuantity: number | null;
  readonly policy?: IntersprintCommercialPolicy;
}

/**
 * Resolves what a price means for a given supplier release.
 *
 * Three outcomes, and the middle one is the one that matters:
 *
 *   unknown             the owner has not confirmed the net price basis, or
 *                       the release quantity is not known yet. Fails closed.
 *   transport_included  the release reaches the minimum.
 *   transport_separate  it does not, so transport is still to be paid.
 *
 * A null quantity is NOT treated as "probably a full batch". Sourcing decides
 * the quantity; until it has, the meaning of the price is genuinely unknown
 * and saying so is cheaper than assuming.
 */
export function resolveIntersprintCommercialMode(
  input: CommercialModeInput
): FeedCommercialMode {
  const policy = input.policy ?? INTERSPRINT_COMMERCIAL_POLICY;

  if (!policy.netPriceIsPurchaseCost) return "unknown";
  if (input.releaseQuantity === null || !Number.isFinite(input.releaseQuantity)) {
    return "unknown";
  }

  const minimum = policy.minimumReleaseQuantity[input.category];
  return input.releaseQuantity >= minimum ? "transport_included" : "transport_separate";
}

/**
 * The assumption the internal catalogue preview prices under.
 *
 * The preview shows a per-tyre price, but transport inclusion is a property of
 * the whole release. GommaRush sources Inter-Sprint in consolidated batches
 * that reach the minimum, so the preview prices on that basis — and the screen
 * says so, rather than letting a per-unit figure quietly imply that one tyre
 * ships free.
 */
export const PREVIEW_ASSUMES_MINIMUM_RELEASE_REACHED = true;

/** The release quantity the preview assumes, per category. */
export function previewReleaseQuantity(
  category: IntersprintCategory,
  policy: IntersprintCommercialPolicy = INTERSPRINT_COMMERCIAL_POLICY
): number {
  return policy.minimumReleaseQuantity[category];
}
