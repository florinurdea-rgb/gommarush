import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { buildProductResult, type CommercialObservationRow, type ProductSearchResult } from "./search";

/**
 * Server-only unified supplier search queries.
 *
 * NOT WIRED TO ANY ROUTE — deliberately, following the precedent set by
 * src/lib/offers/admin-queries.ts. These functions return SUPPLIER IDENTITY and
 * SUPPLIER PURCHASE COST, which must never reach a customer-facing surface
 * (docs/architecture/01_SUPPLIER_ARCHITECTURE.md). This repository has no
 * authentication yet, so an exposed route would be publicly reachable and would
 * leak supplier cost to anyone who found the URL.
 *
 * Before wiring an operator screen, gate every route/page that calls these
 * behind real authentication.
 *
 * EVERY read goes through `supplier_commercial_observations`. That view — not a
 * predicate written at the call site — is what excludes test data, inactive
 * listings and logistics-only counterparties. Never query
 * `supplier_listing_prices` directly for a commercial result.
 */

const OBSERVATION_COLUMNS = [
  "observation_id", "supplier_listing_id", "supplier_id", "lane_code", "supplier_name",
  "catalogue_product_id", "supplier_article_id", "supplier_listing_key", "old_dot",
  "purchase_price", "currency", "stock_exact", "stock_raw", "stock_status",
  "stock_confidence", "lead_time_days", "delivery_class", "observed_at",
  "price_verified_at", "stock_verified_at", "source_type", "pfu_amount", "pfu_status",
  "pfu_source", "dot_code", "observed_by", "observation_note",
  "price_ttl_hours", "stock_ttl_hours", "stale_multiplier",
].join(", ");

/** Active sourcing lanes, so a lane with no data is shown as absent, not zero. */
export async function listSourcingLanes(): Promise<string[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("lane_code")
    .eq("is_sourcing_lane", true)
    .eq("active", true)
    .not("lane_code", "is", null)
    .order("lane_code");
  if (error) throw error;
  return (data ?? []).map((r) => r.lane_code as string);
}

async function resultForProduct(
  catalogueProductId: string,
  lanes: string[],
): Promise<ProductSearchResult> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("supplier_commercial_observations")
    .select(OBSERVATION_COLUMNS)
    .eq("catalogue_product_id", catalogueProductId);
  if (error) throw error;
  return buildProductResult(
    catalogueProductId,
    (data ?? []) as unknown as CommercialObservationRow[],
    lanes,
  );
}

export interface ProductMatch {
  catalogueProductId: string;
  ean: string | null;
  brand: string | null;
  modelPattern: string | null;
  sizeDisplay: string | null;
  season: string | null;
  /** How the product was found, so an operator can judge the match. */
  matchedOn: "ean" | "identifier" | "attributes";
}

/**
 * Search by EAN. EAN is the strongest cross-supplier bridge, so it is resolved
 * first against catalogue_products and then against product_identifiers, which
 * also carries GTINs, manufacturer codes and supplier article codes.
 */
export async function searchByEan(
  ean: string,
): Promise<{ match: ProductMatch; result: ProductSearchResult } | null> {
  const normalized = ean.replace(/\D+/g, "");
  if (!normalized) return null;

  const supabase = createSupabaseAdminClient();
  const lanes = await listSourcingLanes();

  const direct = await supabase
    .from("catalogue_products")
    .select("id, ean, brand, model_pattern, size_display, season")
    .eq("ean", normalized)
    .eq("active", true)
    .maybeSingle();
  if (direct.error) throw direct.error;

  if (direct.data) {
    return {
      match: {
        catalogueProductId: direct.data.id as string,
        ean: direct.data.ean as string | null,
        brand: direct.data.brand as string | null,
        modelPattern: direct.data.model_pattern as string | null,
        sizeDisplay: direct.data.size_display as string | null,
        season: direct.data.season as string | null,
        matchedOn: "ean",
      },
      result: await resultForProduct(direct.data.id as string, lanes),
    };
  }

  const viaIdentifier = await supabase
    .from("product_identifiers")
    .select("catalogue_product_id, catalogue_products(id, ean, brand, model_pattern, size_display, season)")
    .eq("normalized_value", normalized)
    .limit(1)
    .maybeSingle();
  if (viaIdentifier.error) throw viaIdentifier.error;
  if (!viaIdentifier.data) return null;

  const product = viaIdentifier.data.catalogue_products as unknown as {
    id: string; ean: string | null; brand: string | null;
    model_pattern: string | null; size_display: string | null; season: string | null;
  } | null;
  if (!product) return null;

  return {
    match: {
      catalogueProductId: product.id,
      ean: product.ean,
      brand: product.brand,
      modelPattern: product.model_pattern,
      sizeDisplay: product.size_display,
      season: product.season,
      matchedOn: "identifier",
    },
    result: await resultForProduct(product.id, lanes),
  };
}

export interface AttributeSearchInput {
  widthMm?: number;
  aspectRatio?: number;
  rimInch?: number;
  season?: string;
  brand?: string;
  loadIndex?: string;
  speedRating?: string;
  limit?: number;
}

/** Search by tyre attributes. Backed by catalogue_products_size_idx. */
export async function searchByAttributes(
  input: AttributeSearchInput,
): Promise<Array<{ match: ProductMatch; result: ProductSearchResult }>> {
  const supabase = createSupabaseAdminClient();
  const lanes = await listSourcingLanes();

  let query = supabase
    .from("catalogue_products")
    .select("id, ean, brand, model_pattern, size_display, season")
    .eq("active", true)
    .limit(Math.min(input.limit ?? 25, 100));

  if (input.widthMm !== undefined) query = query.eq("width_mm", input.widthMm);
  if (input.aspectRatio !== undefined) query = query.eq("aspect_ratio", input.aspectRatio);
  if (input.rimInch !== undefined) query = query.eq("rim_inch", input.rimInch);
  if (input.season) query = query.eq("season", input.season);
  if (input.brand) query = query.ilike("brand", input.brand);
  if (input.loadIndex) query = query.eq("load_index", input.loadIndex);
  if (input.speedRating) query = query.eq("speed_rating", input.speedRating);

  const { data, error } = await query;
  if (error) throw error;

  const products = (data ?? []) as Array<{
    id: string; ean: string | null; brand: string | null;
    model_pattern: string | null; size_display: string | null; season: string | null;
  }>;

  return Promise.all(
    products.map(async (p) => ({
      match: {
        catalogueProductId: p.id,
        ean: p.ean,
        brand: p.brand,
        modelPattern: p.model_pattern,
        sizeDisplay: p.size_display,
        season: p.season,
        matchedOn: "attributes" as const,
      },
      result: await resultForProduct(p.id, lanes),
    })),
  );
}
