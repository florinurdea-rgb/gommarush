import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { logError } from "@/lib/logger";

/**
 * The tyre sizes the catalogue contains — the WHOLE list, every time.
 *
 * WHY THIS EXISTS SEPARATELY FROM getCatalogueFacets.
 *
 * The size selectors used to be filled from the dependent facet query: each
 * list computed with the OTHER filters applied, so the widths narrowed as a
 * rim was picked. Two things were wrong with that on a customer screen.
 *
 *   SLOW. With no dimension chosen there is nothing to narrow by, so the facet
 *   query read up to 20,000 rows per column across five columns before the
 *   first dropdown could be populated. The customer waited on a scan of the
 *   whole catalogue to be offered "205".
 *
 *   UNSTABLE. Every selection produced a new, differently-shaped list. A list
 *   that changes under an open dropdown closes it, and a list that drops the
 *   value already chosen blanks its own control. Both were reported as "the
 *   filters reset while I browse", and both were fixed defensively — a freeze
 *   while focused, an always-present option — rather than at the cause.
 *
 * The cause is the narrowing itself. A tyre shop knows the size it needs; it
 * does not need the catalogue to teach it which widths pair with which rims.
 * So these three lists are UNFILTERED and identical for every customer and
 * every selection. Nothing narrows, so nothing can move.
 *
 * Being identical for everyone is also what makes them cacheable, and being
 * cacheable is what makes the selectors instant.
 *
 * A size with no tyres behind it is now reachable, and that is the deliberate
 * trade: the results panel answers "no tyres in this size" honestly, which is
 * a better answer than a dimension the customer cannot select and cannot
 * explain the absence of.
 *
 * NOT A CURATED LIST. These are the distinct values PRESENT IN THE CATALOGUE,
 * read from it. Hard-coding a standard size grid instead would hide any tyre
 * whose dimensions fell outside whatever grid was written down, and would go
 * quietly wrong the first time a supplier shipped something unusual.
 */

export interface TyreDimensions {
  readonly widths: readonly number[];
  readonly aspectRatios: readonly number[];
  readonly rims: readonly number[];
  /** False when the catalogue tables are not present in this environment. */
  readonly schemaAvailable: boolean;
}

export const EMPTY_TYRE_DIMENSIONS: TyreDimensions = {
  widths: [],
  aspectRatios: [],
  rims: [],
  schemaAvailable: false,
};

/**
 * How long a computed list is reused.
 *
 * The catalogue gains sizes when a supplier feed lands, which is a scheduled
 * event measured in hours. Ten minutes of staleness costs a newly-imported
 * size a short wait before it is selectable; it saves every customer the scan
 * that produced the complaint. A stale SIZE cannot mislead — the results
 * behind it are read live on every search.
 */
const TTL_MS = 10 * 60 * 1000;

/** Guards against one pathological import filling a dropdown with noise. */
const MAX_VALUES = 400;

interface CacheEntry {
  readonly value: TyreDimensions;
  readonly expiresAt: number;
}

let cache: CacheEntry | null = null;
/** De-duplicates concurrent first requests, so a cold start reads once. */
let inFlight: Promise<TyreDimensions> | null = null;

/** Test seam. Never called by application code. */
export function resetTyreDimensionsCache(): void {
  cache = null;
  inFlight = null;
}

async function readDimensions(): Promise<TyreDimensions> {
  // Constructed INSIDE the try below. Missing Supabase configuration throws
  // here, and an unconfigured environment must degrade to empty selectors on a
  // page that still renders — not to a 500 on the catalogue.
  let supabase: ReturnType<typeof createSupabaseAdminClient>;

  async function distinct(column: "width_mm" | "aspect_ratio" | "rim_inch"): Promise<number[]> {
    const { data, error } = await supabase
      .from("catalogue_products")
      .select(column)
      .eq("active", true)
      .not(column, "is", null)
      .limit(20000);

    if (error) {
      if (isMissingSchemaError(error)) return [];
      throw error;
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return [...new Set(rows.map((row) => row[column]).filter((v): v is number => typeof v === "number"))]
      .sort((a, b) => a - b)
      .slice(0, MAX_VALUES);
  }

  try {
    supabase = createSupabaseAdminClient();
    const [widths, aspectRatios, rims] = await Promise.all([
      distinct("width_mm"),
      distinct("aspect_ratio"),
      distinct("rim_inch"),
    ]);
    return { widths, aspectRatios, rims, schemaAvailable: true };
  } catch (error) {
    // A selector the customer cannot use is a bad screen; a 500 is a worse
    // one. The page renders, says the catalogue is unavailable, and the
    // failure is logged rather than shown.
    logError("catalogue_dimensions_failed", error);
    return EMPTY_TYRE_DIMENSIONS;
  }
}

export async function getTyreDimensions(now: number = Date.now()): Promise<TyreDimensions> {
  if (cache && cache.expiresAt > now) return cache.value;
  if (inFlight) return inFlight;

  inFlight = readDimensions()
    .then((value) => {
      // A failed read is NOT cached. Caching an empty list would leave every
      // customer with three empty dropdowns for the next ten minutes because
      // of one bad moment.
      if (value.schemaAvailable) cache = { value, expiresAt: now + TTL_MS };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
