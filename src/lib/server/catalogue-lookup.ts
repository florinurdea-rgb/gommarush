import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { normalizeIdentifierValue, SUPPORTED_GTIN_LENGTHS, validateGtin } from "@/lib/catalogue/gtin";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { logError } from "@/lib/logger";
import type { IdentifierType, PublicTyreResult } from "@/lib/types/catalogue";

/**
 * Tyre identification by code.
 *
 * This runs on a PUBLIC, unauthenticated endpoint, so the projection below
 * is the security boundary and is written out field by field on purpose.
 * Never widen it to `select("*")`: catalogue_products sits one join away
 * from supplier_product_listings and supplier_listing_prices, and a
 * careless select is how a competitor reads our purchase prices.
 *
 * What a visitor may see: the tyre. What they may not: which supplier
 * lists it, under what article code, at what price, or anything about our
 * imports, conflicts or review state.
 */

/** Exactly the columns a customer may see. Additions need a reason. */
const PUBLIC_COLUMNS = [
  "brand",
  "model_pattern",
  "description",
  "size_display",
  "width_mm",
  "aspect_ratio",
  "rim_inch",
  "load_index",
  "speed_rating",
  "load_speed_raw",
  "season",
  "product_class",
  "xl",
  "run_flat",
  "weight_kg",
  "eprel_id",
].join(", ");

/**
 * Identifier types a public search may match on.
 *
 * `supplier_article_code` is deliberately absent. Letting anyone resolve an
 * ISB article number would expose our supplier's catalogue structure to
 * whoever asks, and the codes are useless to a customer anyway.
 */
const PUBLIC_IDENTIFIER_TYPES: IdentifierType[] = ["ean", "gtin", "manufacturer_code"];

export type PublicLookupStatus = "found" | "not_found" | "invalid_code";

export interface PublicLookupResponse {
  status: PublicLookupStatus;
  /** The normalized form actually searched, echoed so the UI can show it. */
  query: string;
  results: PublicTyreResult[];
  /** Set when the code could not be a valid barcode. UI copy, not an error. */
  reason: string | null;
}

interface IdentifierJoinRow {
  identifier_type: string;
  normalized_value: string;
  catalogue_products: Record<string, unknown> | null;
}

function toPublicResult(
  product: Record<string, unknown>,
  matchedOn: IdentifierType,
  matchedValue: string
): PublicTyreResult {
  return {
    brand: (product.brand as string | null) ?? null,
    modelPattern: (product.model_pattern as string | null) ?? null,
    description: (product.description as string | null) ?? null,
    sizeDisplay: (product.size_display as string | null) ?? null,
    widthMm: (product.width_mm as number | null) ?? null,
    aspectRatio: (product.aspect_ratio as number | null) ?? null,
    rimInch: (product.rim_inch as number | null) ?? null,
    loadIndex: (product.load_index as string | null) ?? null,
    speedRating: (product.speed_rating as string | null) ?? null,
    loadSpeedRaw: (product.load_speed_raw as string | null) ?? null,
    season: (product.season as string | null) ?? null,
    productClass: (product.product_class as string | null) ?? null,
    xl: (product.xl as boolean | null) ?? null,
    runFlat: (product.run_flat as boolean | null) ?? null,
    weightKg:
      product.weight_kg === null || product.weight_kg === undefined
        ? null
        : Number(product.weight_kg),
    eprelId: (product.eprel_id as string | null) ?? null,
    matchedOn,
    matchedValue,
  };
}

/** Longest code we will even look up. Well past GTIN-14 and any real MPN. */
const MAX_CODE_LENGTH = 40;
/** A manufacturer code can legitimately sit on several products. */
const MAX_RESULTS = 12;

/**
 * Resolves a customer-typed or scanned code to tyre specifications.
 *
 * Deterministic and exact: an indexed equality match on
 * product_identifiers.normalized_value. No fuzzy matching, no "did you
 * mean" — a barcode that is one digit out is a different tyre, and
 * guessing which one the customer meant would be worse than saying we do
 * not know.
 */
export async function publicTyreLookup(rawCode: string): Promise<PublicLookupResponse> {
  const normalized = normalizeIdentifierValue(rawCode ?? "");

  if (!normalized) {
    return { status: "invalid_code", query: "", results: [], reason: "EMPTY" };
  }
  if (normalized.length > MAX_CODE_LENGTH) {
    return { status: "invalid_code", query: "", results: [], reason: "TOO_LONG" };
  }

  // Codes to search for. Normally just what was typed.
  const candidates = new Set<string>([normalized]);

  // A code of a GTIN's own length is being offered as a barcode, so it is
  // held to a barcode's standard: a failed check digit is reported as a bad
  // code rather than searched for and reported as "not in the catalogue",
  // which would send someone hunting for a tyre when the real problem is a
  // mistyped digit.
  //
  // Crucially this applies ONLY at those lengths. Plenty of manufacturer
  // references are numeric but are not barcodes at all — '110181' is a real
  // MICHELIN code in the ISB catalogue — and holding those to a check digit
  // would reject a code that is in the catalogue and findable.
  const isNumeric = /^[0-9]+$/.test(normalized);
  const isBarcodeLength = (SUPPORTED_GTIN_LENGTHS as readonly number[]).includes(normalized.length);

  if (isNumeric && isBarcodeLength) {
    const gtin = validateGtin(normalized);
    if (gtin.status === "invalid_check_digit") {
      return {
        status: "invalid_code",
        query: normalized,
        results: [],
        reason: gtin.reason ?? "CHECK_DIGIT_MISMATCH",
      };
    }
  } else if (isNumeric) {
    // Someone may type the 11-digit form a spreadsheet left them with, while
    // the catalogue holds the 12-digit code we recovered. Both are searched,
    // but only because the recovery validated.
    const gtin = validateGtin(normalized);
    if (gtin.status === "recovered_leading_zero" && gtin.normalized) {
      candidates.add(gtin.normalized);
    }
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("product_identifiers")
      .select(`identifier_type, normalized_value, catalogue_products!inner(${PUBLIC_COLUMNS}, active)`)
      .in("normalized_value", [...candidates])
      .in("identifier_type", PUBLIC_IDENTIFIER_TYPES)
      .eq("catalogue_products.active", true)
      .limit(MAX_RESULTS);

    if (error) {
      // The catalogue tables may not exist yet in an environment where the
      // migration has not run. That is a deployment state, not a customer
      // error, so it reads as "not found" rather than a failure.
      if (isMissingSchemaError(error)) {
        logError("tyre_lookup_schema_missing", error);
        return { status: "not_found", query: normalized, results: [], reason: null };
      }
      throw error;
    }

    const rows = (data ?? []) as unknown as IdentifierJoinRow[];
    const results: PublicTyreResult[] = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const product = row.catalogue_products;
      if (!product) continue;
      const key = JSON.stringify([product.brand, product.model_pattern, product.size_display]);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(
        toPublicResult(product, row.identifier_type as IdentifierType, row.normalized_value)
      );
    }

    return {
      status: results.length > 0 ? "found" : "not_found",
      query: normalized,
      results,
      reason: null,
    };
  } catch (error) {
    logError("tyre_lookup_failed", error);
    throw error;
  }
}
