/**
 * "Caută cauciuc" — barcode-to-tyre identification.
 *
 * Deliberately self-contained: no dependency on orders/customers/warehouse/
 * documents, and nothing here is imported by them either. This feature
 * scans a barcode and identifies a tyre from public web sources — nothing
 * else.
 */

export interface TyreLookupSource {
  title: string;
  url: string;
}

export type TyreLookupSeason = "summer" | "winter" | "all-season";

/**
 * - identified: exact barcode found, clearly tied to one product.
 * - uncertain: something was found, but not confidently enough to trust
 *   at face value (contradictory sources, or a claim with no verifiable
 *   source) — needs a human to double-check.
 * - unknown: searched, found nothing tying this exact barcode to a product.
 * - unconfigured: the lookup isn't set up (no ANTHROPIC_API_KEY).
 * - failed: a technical error (timeout, HTTP error, malformed response) —
 *   distinct from "unknown" on purpose: a technical failure must never be
 *   presented as "this product doesn't exist."
 */
export type TyreLookupStatus = "identified" | "uncertain" | "unknown" | "unconfigured" | "failed";

export interface TyreLookupResult {
  status: TyreLookupStatus;
  barcode: string;
  brand: string | null;
  model: string | null;
  width: number | null;
  aspectRatio: number | null;
  rimDiameter: number | null;
  loadIndex: string | null;
  speedRating: string | null;
  extraLoad: boolean | null;
  runFlat: boolean | null;
  season: TyreLookupSeason | null;
  ean: string | null;
  manufacturerCode: string | null;
  sources: TyreLookupSource[];
  notes: string[];
  error: string | null;
  cached: boolean;
}
