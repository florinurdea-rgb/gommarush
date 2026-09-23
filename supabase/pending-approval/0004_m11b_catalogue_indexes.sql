-- PENDING OWNER APPROVAL — NOT APPLIED TO ANY ENVIRONMENT.
--
-- Two indexes M11B's catalogue browse will need. Measured against production
-- on 2026-09-22 (13,183 products, 13,206 listings); see
-- docs/PRODUCTION_RECONCILIATION.md §4.8 for the full coverage table.
--
-- Everything else M11B filters on is already indexed. These are the two gaps.
--
-- Both are CONCURRENTLY, so neither takes a write lock on a live catalogue.
-- CONCURRENTLY cannot run inside a transaction block — run these as separate
-- statements, not wrapped in BEGIN/COMMIT.

-- 1. Car/Van vs Truck, and the vehicle-class facet.
--
-- product_class has no index at all today, so the planner sequentially scans
-- 13,183 rows for what will be the catalogue's primary top-level filter.
-- Partial on `active`, because no catalogue view shows inactive products.
create index concurrently if not exists catalogue_products_class_idx
  on public.catalogue_products (product_class)
  where active;

-- 2. Season on its own.
--
-- catalogue_products_size_idx has season as its FOURTH column, so it only
-- helps when a width is also supplied. "show me all winter tyres" cannot use
-- it. Ordered season-then-brand because the browse screen facets in that
-- order.
create index concurrently if not exists catalogue_products_season_brand_idx
  on public.catalogue_products (season, brand)
  where active;

-- DELIBERATELY NOT ADDED
--
-- An index on `active` alone: it is true for all 13,183 rows today, so it
-- would never be selective enough to use. The partial predicates above give
-- the same benefit without a useless index to maintain.
--
-- A covering index for the latest-observation lookup:
-- supplier_listing_prices_listing_idx (supplier_listing_id, observed_at DESC)
-- already serves DISTINCT ON exactly. Revisit only if price history grows
-- past the retention thresholds in §5 and EXPLAIN shows a regression.
