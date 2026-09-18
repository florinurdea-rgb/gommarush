/**
 * The five real catalogue products used as the Protocol 103 proof set.
 *
 * Every one of these is a row that exists today in `catalogue_products`
 * (imported 2026-09-08 from the ISB XLSX, 9,550 products). They are recorded
 * here so the live probe can verify that Inter-Sprint answered about the tyre
 * we ASKED about, rather than just that it answered at all — a lookup that
 * returns the wrong article is worse than one that returns nothing.
 *
 * Selection rationale, so this is reproducible rather than arbitrary:
 *
 *   * One per brand across the five the business named: Pirelli, Michelin,
 *     Continental, Hankook, Vredestein.
 *   * All 205/55 R16 summer — the highest-volume European passenger fitment,
 *     which maximises the chance a wholesaler actually stocks them. A rare
 *     size returning "not carried" would tell us nothing about the
 *     integration.
 *   * Each has a weight and an EPREL id in our catalogue, so it is a fully
 *     populated row rather than a sparse one.
 *
 * `supplierArticleId` is the ISB article id and is recorded for provenance
 * ONLY. It must never be passed to `stockBySystemNumber()`: Inter-Sprint's
 * `artc=S=` expects an Inter-Sprint system number, and ISB's identifier
 * space is unrelated. The EAN is the only field that bridges the two
 * suppliers, which is precisely the claim the proof is testing.
 */

export interface CatalogueProbeProduct {
  ean: string;
  brand: string;
  /** Our catalogue's condensed pattern code, e.g. "PRIM5XL". */
  model: string;
  sizeDisplay: string;
  loadSpeed: string;
  widthMm: number;
  aspectRatio: number;
  rimInch: number;
  runFlat: boolean;
  xl: boolean;
  /** ISB's article id. Provenance only — never sent to Inter-Sprint. */
  supplierArticleId: string;
}

export const CATALOGUE_PROBE_SET: readonly CatalogueProbeProduct[] = [
  {
    ean: "8019227204025",
    brand: "PIRELLI",
    model: "P7CINT*RFT",
    sizeDisplay: "205/55 R16",
    loadSpeed: "91W",
    widthMm: 205,
    aspectRatio: 55,
    rimInch: 16,
    runFlat: true,
    xl: false,
    supplierArticleId: "236169",
  },
  {
    ean: "3528701323398",
    brand: "MICHELIN",
    model: "PRIM5XL",
    sizeDisplay: "205/55 R16",
    loadSpeed: "94H",
    widthMm: 205,
    aspectRatio: 55,
    rimInch: 16,
    runFlat: false,
    xl: true,
    supplierArticleId: "487359",
  },
  {
    ean: "4019238031621",
    brand: "CONTINENTAL",
    model: "PRECON5",
    sizeDisplay: "205/55 R16",
    loadSpeed: "91V",
    widthMm: 205,
    aspectRatio: 55,
    rimInch: 16,
    runFlat: false,
    xl: false,
    supplierArticleId: "238270",
  },
  {
    ean: "8808563338118",
    brand: "HANKOOK",
    model: "K115 VW2",
    sizeDisplay: "205/55 R16",
    loadSpeed: "91V",
    widthMm: 205,
    aspectRatio: 55,
    rimInch: 16,
    runFlat: false,
    xl: false,
    supplierArticleId: "295969",
  },
  {
    ean: "8714692995125",
    brand: "VREDESTEIN",
    model: "ULTRAC+",
    sizeDisplay: "205/55 R16",
    loadSpeed: "91H",
    widthMm: 205,
    aspectRatio: 55,
    rimInch: 16,
    runFlat: false,
    xl: false,
    supplierArticleId: "488075",
  },
];

/**
 * Whether a supplier description plausibly describes the tyre we asked for.
 *
 * Deliberately weak, and only on the dimensions. The manual's own §2.1
 * example description is "225/40 ZR18 TL ZR CO CSC 2 N2 EU": brands arrive as
 * two-letter codes ("CO" for Continental) and pattern names are abbreviated
 * differently from ours, so comparing brand or model strings would produce
 * false mismatches on a perfectly correct response. Width, aspect ratio and
 * rim diameter are the three values both sides must agree on, and a response
 * carrying a different size is unambiguously the wrong article.
 *
 * Returns null when the description is empty — unknown, not a mismatch.
 */
export function sizeMatchesDescription(
  product: CatalogueProbeProduct,
  description: string
): boolean | null {
  if (!description.trim()) return null;
  const digits = description.replace(/[^0-9]/g, " ");
  const tokens = new Set(digits.split(/\s+/).filter(Boolean));
  return (
    tokens.has(String(product.widthMm)) &&
    tokens.has(String(product.aspectRatio)) &&
    tokens.has(String(product.rimInch))
  );
}
