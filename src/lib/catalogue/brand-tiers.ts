// Brand tiers: premium / mid-range / value.
//
// A COMMERCIAL TAXONOMY, and therefore a business decision rather than an
// engineering one. Whether a brand is "premium" affects what an operator
// reaches for first and, once the customer catalogue exists, what a customer
// is shown — so it is exactly the kind of judgement that must not be invented
// by whoever happened to write the filter.
//
// THE MAPPING BELOW IS DELIBERATELY EMPTY. No approved brand classification
// exists for GommaRush, and none can be derived from the data: Inter-Sprint's
// `group description` is a product segment ('LUXE BANDEN' covers 2,880 rows
// across many brands), not a statement about the brand. Guessing from
// reputation would put a real commercial position in the product on the
// strength of an agent's impression.
//
// So this file ships the MECHANISM and waits for the mapping. Everything that
// consumes it degrades honestly while it is empty: no tyre is misfiled, and
// the UI says the taxonomy is not configured rather than showing three filters
// that all return nothing.
//
// Central on purpose. The admin workspace uses it today and the customer
// catalogue will use the same taxonomy later; a copy in a UI component would
// guarantee the two disagree.
//
// Pure: no database, no I/O.

export type BrandTier = "premium" | "mid_range" | "value";

export const BRAND_TIERS: readonly BrandTier[] = ["premium", "mid_range", "value"];

export function isBrandTier(value: unknown): value is BrandTier {
  return typeof value === "string" && (BRAND_TIERS as readonly string[]).includes(value);
}

export interface BrandTierLabel {
  readonly tier: BrandTier;
  readonly label: string;
}

/** Display labels. Safe to define without a mapping — these name the tiers. */
export const BRAND_TIER_LABELS: readonly BrandTierLabel[] = [
  { tier: "premium", label: "Premium" },
  { tier: "mid_range", label: "Fascia media" },
  { tier: "value", label: "Economiche" },
];

/**
 * Where a tier assignment came from.
 *
 * Mirrors the provenance discipline used for commercial policy elsewhere: a
 * business decision must never be presented as though a supplier stated it.
 */
export type BrandTierProvenance = "POLICY_OWNER" | "SUPPLIER_DOCUMENTED";

export interface BrandTierAssignment {
  /** Brand exactly as the catalogue stores it, before normalisation. */
  readonly brand: string;
  readonly tier: BrandTier;
  readonly provenance: BrandTierProvenance;
  /** Who approved it and when, so a future reader can re-check. */
  readonly approvedBy: string;
  readonly approvedOn: string;
}

/**
 * The approved brand→tier mapping.
 *
 * EMPTY UNTIL AN OWNER APPROVES ONE. Adding an entry here is a commercial
 * decision being recorded, not a data-entry task: each carries its provenance
 * and who approved it.
 *
 * The catalogue holds brands such as MICHELIN, BRIDGESTONE, VREDESTEIN,
 * NANKANG, SUNNY, ROADHOG, MASTERSTEEL and DELINTE. Which of those GommaRush
 * sells as premium is a positioning question about GommaRush's market, not a
 * fact about the manufacturer, and two tyre businesses would answer it
 * differently.
 */
export const APPROVED_BRAND_TIERS: readonly BrandTierAssignment[] = [];

/** Case- and whitespace-insensitive, because supplier feeds are inconsistent. */
function normaliseBrand(brand: string): string {
  return brand.trim().toUpperCase();
}

const TIER_BY_BRAND = new Map<string, BrandTier>(
  APPROVED_BRAND_TIERS.map((entry) => [normaliseBrand(entry.brand), entry.tier] as const)
);

/** True once at least one brand has an approved tier. */
export const BRAND_TIERS_CONFIGURED = APPROVED_BRAND_TIERS.length > 0;

/**
 * The tier a brand belongs to, or null.
 *
 * Null means "not classified", which is the honest answer for every brand
 * today. It is NOT a synonym for "value" — an unclassified brand must never
 * drift into the cheapest bucket by omission.
 */
export function tierForBrand(brand: string | null | undefined): BrandTier | null {
  if (!brand) return null;
  return TIER_BY_BRAND.get(normaliseBrand(brand)) ?? null;
}

/** Every brand approved into a tier, for filtering a query by tier. */
export function brandsInTier(tier: BrandTier): string[] {
  return APPROVED_BRAND_TIERS.filter((entry) => entry.tier === tier).map((entry) => entry.brand);
}

/** Brands present in the catalogue that no approved mapping covers. */
export function unclassifiedBrands(brands: readonly string[]): string[] {
  return brands.filter((brand) => tierForBrand(brand) === null);
}
