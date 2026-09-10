-- ============================================================================
-- Tyre catalogue: canonical products, supplier listings, identifiers, imports
-- ============================================================================
-- Until now this system had no product table at all. Orders carried tyre
-- specifications as free text on `order_items`, normalised per-document by
-- src/lib/logistics/product-normalise.ts, and nothing tied two deliveries of
-- the same tyre together. This migration adds the catalogue those rows have
-- always implied.
--
-- The shape follows one rule: SEPARATE WHAT CHANGES AT DIFFERENT SPEEDS.
--
--   catalogue_products        the tyre itself. Changes almost never.
--   supplier_product_listings one supplier's offer of it. Changes per import.
--   supplier_listing_prices   price and stock. Changes daily; deliberately
--                             NOT columns on the product, so a price refresh
--                             never rewrites canonical specifications and a
--                             customer-facing query on products cannot leak
--                             a purchase price by accident.
--   product_identifiers       every code that has ever pointed at a product.
--
-- Identity rules, all of them load-bearing:
--
--   * Every identifier is TEXT. An EAN is not a number — '0012345678905'
--     and 12345678905 are the same integer and different barcodes, and 32
--     rows in the first ISB file are leading-zero recoveries that a numeric
--     column would silently destroy.
--   * An EAN identifies a SKU, never a physical tyre and never a customer
--     order. Physical objects stay in inventory_units; who they belong to
--     stays on order_items.
--   * A validated EAN maps to exactly one canonical product (partial unique
--     index below). Two supplier listings may legitimately share it — new
--     stock and old-DOT stock of the same tyre — and both hang off the one
--     product.
--   * Nothing is ever deleted because it stopped appearing in a supplier
--     file. `active` plus `last_seen_at` carry that, and only a file the
--     operator has declared a COMPLETE snapshot may set active = false.
--
-- RLS is enabled on every table with no policies, matching every other table
-- in this schema: all access goes through the service-role client in
-- server-only modules. There is no path from the browser to these rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- catalogue_products — one normalised tyre SKU
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_products (
  id uuid primary key default gen_random_uuid(),

  -- 'GTIN:<ean>' when a validated EAN exists, else the supplier listing key
  -- ('ISB:12851'). Stable across imports; it is how a re-import finds the
  -- product it created last time.
  product_key text not null unique,

  ean text,
  ean_status text not null default 'missing',

  manufacturer_product_code text,
  brand_code text,
  brand text,
  model_pattern text,
  description text,

  product_class text,
  season text,

  width_mm integer,
  aspect_ratio integer,
  rim_inch integer,
  size_display text,

  load_speed_raw text,
  load_index text,
  speed_rating text,

  xl boolean,
  run_flat boolean,
  old_dot boolean not null default false,

  -- Supplier-reported only. NULL means "we do not know", never "zero".
  weight_kg numeric(8,3),
  weight_status text not null default 'missing_or_zero',
  -- ISB's own bucket ('1'..'4'). Text, and NOT kilograms — reading it as a
  -- weight is the single most likely misuse of this row.
  weight_category text,

  e_mark text,
  -- ISB ships 'J'/'N' (ja/nee). Stored as a real boolean; NULL = not stated.
  european boolean,
  eprel_id text,

  -- Whether the EAN may be trusted for barcode matching in the warehouse.
  scan_ready boolean not null default false,
  review_required boolean not null default false,
  review_reasons text[] not null default '{}',

  active boolean not null default true,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalogue_products
  drop constraint if exists catalogue_products_ean_status_chk;
alter table public.catalogue_products
  add constraint catalogue_products_ean_status_chk
  check (ean_status in ('valid', 'recovered_leading_zero', 'invalid_check_digit', 'missing'));

alter table public.catalogue_products
  drop constraint if exists catalogue_products_weight_status_chk;
alter table public.catalogue_products
  add constraint catalogue_products_weight_status_chk
  check (weight_status in ('supplier_reported', 'missing_or_zero'));

-- A weight is either absent or real. Zero is not a weight.
alter table public.catalogue_products
  drop constraint if exists catalogue_products_weight_positive_chk;
alter table public.catalogue_products
  add constraint catalogue_products_weight_positive_chk
  check (weight_kg is null or weight_kg > 0);

-- ...and a stored weight must say where it came from.
alter table public.catalogue_products
  drop constraint if exists catalogue_products_weight_provenance_chk;
alter table public.catalogue_products
  add constraint catalogue_products_weight_provenance_chk
  check ((weight_kg is null) = (weight_status <> 'supplier_reported'));

alter table public.catalogue_products
  drop constraint if exists catalogue_products_dimensions_chk;
alter table public.catalogue_products
  add constraint catalogue_products_dimensions_chk
  check (
    (width_mm is null or width_mm > 0)
    and (aspect_ratio is null or aspect_ratio > 0)
    and (rim_inch is null or rim_inch > 0)
  );

-- A barcode may only be scan-ready if it actually validated.
alter table public.catalogue_products
  drop constraint if exists catalogue_products_scan_ready_chk;
alter table public.catalogue_products
  add constraint catalogue_products_scan_ready_chk
  check (
    scan_ready = false
    or (ean is not null and ean_status in ('valid', 'recovered_leading_zero'))
  );

-- One validated EAN, one canonical product. Partial on purpose: the invalid
-- and missing ones are excluded, so a bad barcode can never block an import.
-- The importer routes a genuine collision to catalogue_conflicts before it
-- gets here; this index is the backstop that makes "we merged two different
-- tyres" impossible rather than merely unlikely.
create unique index if not exists catalogue_products_validated_ean_uidx
  on public.catalogue_products (ean)
  where ean is not null and ean_status in ('valid', 'recovered_leading_zero');

create index if not exists catalogue_products_ean_idx
  on public.catalogue_products (ean) where ean is not null;
create index if not exists catalogue_products_brand_idx
  on public.catalogue_products (brand);
create index if not exists catalogue_products_mfr_code_idx
  on public.catalogue_products (manufacturer_product_code)
  where manufacturer_product_code is not null;
-- The tyre-search tuple: "205/55 R16 winter".
create index if not exists catalogue_products_size_idx
  on public.catalogue_products (width_mm, aspect_ratio, rim_inch, season);
create index if not exists catalogue_products_review_idx
  on public.catalogue_products (review_required) where review_required = true;
create index if not exists catalogue_products_last_seen_idx
  on public.catalogue_products (last_seen_at desc);

drop trigger if exists catalogue_products_set_updated_at on public.catalogue_products;
create trigger catalogue_products_set_updated_at before update on public.catalogue_products
  for each row execute function public.set_updated_at();

alter table public.catalogue_products enable row level security;

comment on table public.catalogue_products is
  'One normalised tyre SKU. Canonical specifications only — no supplier price, no stock, no physical unit. Never deleted because a supplier file stopped listing it.';
comment on column public.catalogue_products.weight_category is
  'Supplier weight bucket as shipped (ISB ''1''..''4''). NOT kilograms — see weight_kg.';
comment on column public.catalogue_products.scan_ready is
  'True only when the EAN passed GS1 check-digit validation and may be trusted for warehouse barcode matching.';

-- ---------------------------------------------------------------------------
-- supplier_product_listings — one supplier's commercial listing of a product
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_product_listings (
  id uuid primary key default gen_random_uuid(),

  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  -- Restricted, not cascaded: deleting a product because a listing pointed at
  -- it, or losing listings because someone tidied a product, are both worse
  -- than a failed delete.
  catalogue_product_id uuid not null references public.catalogue_products(id) on delete restrict,

  -- 'ISB:12851' — globally unique, and the first thing a re-import matches on.
  supplier_listing_key text not null unique,
  supplier_article_id text not null,
  supplier_item_code text,

  -- What the source file claimed the product key was, kept verbatim for audit
  -- even when matching resolved to a different product.
  source_product_key text,
  source_row integer,

  old_dot boolean not null default false,
  active boolean not null default true,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deactivated_at timestamptz,
  last_import_run_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The supplier's own identity for the listing, independent of our key format.
create unique index if not exists supplier_product_listings_supplier_article_uidx
  on public.supplier_product_listings (supplier_id, supplier_article_id);

create index if not exists supplier_product_listings_product_idx
  on public.supplier_product_listings (catalogue_product_id);
create index if not exists supplier_product_listings_supplier_active_idx
  on public.supplier_product_listings (supplier_id, active);
create index if not exists supplier_product_listings_last_seen_idx
  on public.supplier_product_listings (supplier_id, last_seen_at desc);

drop trigger if exists supplier_product_listings_set_updated_at on public.supplier_product_listings;
create trigger supplier_product_listings_set_updated_at before update on public.supplier_product_listings
  for each row execute function public.set_updated_at();

alter table public.supplier_product_listings enable row level security;

comment on table public.supplier_product_listings is
  'One supplier''s listing of one catalogue product. Two listings may share a product (new stock vs old DOT). Marked inactive only after a COMPLETE catalogue snapshot omits it — never after a partial file.';

-- ---------------------------------------------------------------------------
-- supplier_listing_prices — fast-moving commercial data, kept out of the
-- canonical product on purpose
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_listing_prices (
  id uuid primary key default gen_random_uuid(),
  supplier_listing_id uuid not null references public.supplier_product_listings(id) on delete cascade,

  purchase_price numeric(12,4),
  currency text not null default 'EUR',

  -- ISB ships thresholds like '>20'. The raw string is kept; `stock_exact`
  -- is filled only when the value is an unambiguous integer.
  stock_raw text,
  stock_exact integer,
  stock_minimum integer,

  observed_at timestamptz not null default now(),
  import_run_id uuid,
  created_at timestamptz not null default now()
);

alter table public.supplier_listing_prices
  drop constraint if exists supplier_listing_prices_price_chk;
alter table public.supplier_listing_prices
  add constraint supplier_listing_prices_price_chk
  check (purchase_price is null or purchase_price >= 0);

create index if not exists supplier_listing_prices_listing_idx
  on public.supplier_listing_prices (supplier_listing_id, observed_at desc);

alter table public.supplier_listing_prices enable row level security;

comment on table public.supplier_listing_prices is
  'Supplier purchase price and stock, one row per observation. SUPPLIER COST DATA — must never be reachable from a customer-facing query. Separated from catalogue_products so a price refresh cannot rewrite specifications and a product query cannot leak a cost.';

-- ---------------------------------------------------------------------------
-- product_identifiers — every code that has ever pointed at a product
-- ---------------------------------------------------------------------------
create table if not exists public.product_identifiers (
  id uuid primary key default gen_random_uuid(),
  catalogue_product_id uuid not null references public.catalogue_products(id) on delete cascade,

  identifier_type text not null,
  -- Exactly as the source supplied it.
  identifier_value text not null,
  -- Uppercased, formatting characters stripped. This is what a scan matches.
  normalized_value text not null,

  supplier_id uuid references public.suppliers(id) on delete set null,
  validation_status text not null default 'unverified',
  source text,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.product_identifiers
  drop constraint if exists product_identifiers_type_chk;
alter table public.product_identifiers
  add constraint product_identifiers_type_chk
  check (identifier_type in ('ean', 'gtin', 'manufacturer_code', 'supplier_article_code'));

alter table public.product_identifiers
  drop constraint if exists product_identifiers_validation_chk;
alter table public.product_identifiers
  add constraint product_identifiers_validation_chk
  check (validation_status in ('valid', 'recovered_leading_zero', 'invalid_check_digit', 'unverified'));

-- One identifier of one type per product per supplier. A NULL supplier_id
-- means "not supplier-scoped" (a manufacturer code), so it is coalesced to a
-- fixed sentinel rather than left NULL, which would defeat the uniqueness.
create unique index if not exists product_identifiers_unique_idx
  on public.product_identifiers (
    catalogue_product_id,
    identifier_type,
    normalized_value,
    coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- The barcode-scan index. Exact match on a normalized value, type-filtered.
create index if not exists product_identifiers_lookup_idx
  on public.product_identifiers (normalized_value, identifier_type);

alter table public.product_identifiers enable row level security;

comment on table public.product_identifiers is
  'Every code that resolves to a catalogue product — EAN/GTIN, manufacturer code, supplier article code. The warehouse barcode scanner queries normalized_value here.';

-- ---------------------------------------------------------------------------
-- catalogue_import_runs — one uploaded file
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_import_runs (
  id uuid primary key default gen_random_uuid(),

  supplier_id uuid references public.suppliers(id) on delete restrict,
  adapter text not null default 'isb',

  original_filename text,
  -- SHA-256 of the uploaded bytes. Identical files are recognised, not
  -- silently re-imported.
  file_checksum text not null,
  file_size integer,
  storage_bucket text,
  storage_path text,

  -- Whether the file is the supplier's whole catalogue. ONLY a 'complete'
  -- run may propose deactivating listings it does not contain.
  import_mode text not null default 'partial',

  status text not null default 'uploaded',
  uploaded_by text,

  started_at timestamptz not null default now(),
  analyzed_at timestamptz,
  committed_at timestamptz,
  finished_at timestamptz,

  source_row_count integer not null default 0,
  inserted_listings integer not null default 0,
  updated_listings integer not null default 0,
  unchanged_listings integer not null default 0,
  new_products integer not null default 0,
  updated_products integer not null default 0,
  deactivated_listings integer not null default 0,
  missing_ean_count integer not null default 0,
  invalid_ean_count integer not null default 0,
  missing_weight_count integer not null default 0,
  conflict_count integer not null default 0,
  rejected_rows integer not null default 0,

  -- How far a batched commit has got. Lets an interrupted run resume instead
  -- of restarting, and makes "partially committed" a visible state rather
  -- than an invisible one.
  committed_row_count integer not null default 0,
  batch_size integer not null default 500,

  error_summary text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalogue_import_runs
  drop constraint if exists catalogue_import_runs_status_chk;
alter table public.catalogue_import_runs
  add constraint catalogue_import_runs_status_chk
  check (status in (
    'uploaded', 'analyzing', 'previewed', 'committing',
    'committed', 'failed', 'cancelled'
  ));

alter table public.catalogue_import_runs
  drop constraint if exists catalogue_import_runs_mode_chk;
alter table public.catalogue_import_runs
  add constraint catalogue_import_runs_mode_chk
  check (import_mode in ('complete', 'partial', 'manual_correction'));

-- Idempotency: the same file, from the same supplier, imported by the same
-- adapter, is one run. A second upload finds this row instead of creating a
-- duplicate — but only committed runs block, so a failed attempt can be retried.
create unique index if not exists catalogue_import_runs_checksum_uidx
  on public.catalogue_import_runs (supplier_id, adapter, file_checksum)
  where status = 'committed';

create index if not exists catalogue_import_runs_recent_idx
  on public.catalogue_import_runs (created_at desc);
create index if not exists catalogue_import_runs_status_idx
  on public.catalogue_import_runs (status);

drop trigger if exists catalogue_import_runs_set_updated_at on public.catalogue_import_runs;
create trigger catalogue_import_runs_set_updated_at before update on public.catalogue_import_runs
  for each row execute function public.set_updated_at();

alter table public.catalogue_import_runs enable row level security;

comment on table public.catalogue_import_runs is
  'One uploaded supplier catalogue file. status = ''committed'' is the ONLY state that means the data landed; anything else is in flight or failed.';
comment on column public.catalogue_import_runs.import_mode is
  'complete = the supplier''s whole catalogue (may propose deactivations); partial / manual_correction = must never deactivate anything.';

-- ---------------------------------------------------------------------------
-- catalogue_import_rows — staging and audit, one row per source row
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.catalogue_import_runs(id) on delete cascade,

  source_row integer not null,
  supplier_listing_key text,

  -- Verbatim cell values as read, before any interpretation. This is the
  -- evidence behind every decision below and is never rewritten.
  raw_payload jsonb not null,
  normalized_payload jsonb,

  validation_result text not null default 'pending',
  validation_errors text[] not null default '{}',

  match_result text,
  matched_product_id uuid references public.catalogue_products(id) on delete set null,
  matched_listing_id uuid references public.supplier_product_listings(id) on delete set null,

  action text,
  -- What actually changed, field by field, so a commit can be explained and
  -- reversed.
  change_set jsonb,
  review_reasons text[] not null default '{}',

  committed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.catalogue_import_rows
  drop constraint if exists catalogue_import_rows_validation_chk;
alter table public.catalogue_import_rows
  add constraint catalogue_import_rows_validation_chk
  check (validation_result in ('pending', 'valid', 'review', 'rejected'));

alter table public.catalogue_import_rows
  drop constraint if exists catalogue_import_rows_action_chk;
alter table public.catalogue_import_rows
  add constraint catalogue_import_rows_action_chk
  check (action is null or action in (
    'insert_product', 'insert_listing', 'update_listing',
    'unchanged', 'conflict', 'rejected', 'deactivate_listing'
  ));

create unique index if not exists catalogue_import_rows_run_row_uidx
  on public.catalogue_import_rows (import_run_id, source_row);
create index if not exists catalogue_import_rows_run_action_idx
  on public.catalogue_import_rows (import_run_id, action);
create index if not exists catalogue_import_rows_run_validation_idx
  on public.catalogue_import_rows (import_run_id, validation_result);

alter table public.catalogue_import_rows enable row level security;

comment on table public.catalogue_import_rows is
  'Staging + audit for every source row of an import. raw_payload is the untouched source and is never overwritten.';

-- ---------------------------------------------------------------------------
-- catalogue_conflicts — things the importer refused to decide by itself
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_conflicts (
  id uuid primary key default gen_random_uuid(),

  import_run_id uuid references public.catalogue_import_runs(id) on delete set null,
  import_row_id uuid references public.catalogue_import_rows(id) on delete set null,

  conflict_type text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  supplier_listing_key text,

  catalogue_product_id uuid references public.catalogue_products(id) on delete set null,
  competing_product_id uuid references public.catalogue_products(id) on delete set null,

  field text,
  existing_value text,
  incoming_value text,
  detail jsonb,

  status text not null default 'open',
  resolution text,
  resolved_by text,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalogue_conflicts
  drop constraint if exists catalogue_conflicts_type_chk;
alter table public.catalogue_conflicts
  add constraint catalogue_conflicts_type_chk
  check (conflict_type in (
    'ean_spec_mismatch',        -- same EAN, incompatible specifications
    'product_ean_change',       -- an existing listing arrived with a different EAN
    'weight_conflict',          -- two supplier-reported weights beyond tolerance
    'manufacturer_code_conflict',
    'ambiguous_match',          -- more than one candidate product
    'duplicate_source_row'
  ));

alter table public.catalogue_conflicts
  drop constraint if exists catalogue_conflicts_status_chk;
alter table public.catalogue_conflicts
  add constraint catalogue_conflicts_status_chk
  check (status in ('open', 'resolved', 'dismissed'));

create index if not exists catalogue_conflicts_open_idx
  on public.catalogue_conflicts (status, created_at desc);
create index if not exists catalogue_conflicts_run_idx
  on public.catalogue_conflicts (import_run_id);

drop trigger if exists catalogue_conflicts_set_updated_at on public.catalogue_conflicts;
create trigger catalogue_conflicts_set_updated_at before update on public.catalogue_conflicts
  for each row execute function public.set_updated_at();

alter table public.catalogue_conflicts enable row level security;

comment on table public.catalogue_conflicts is
  'Cases the importer deliberately refused to resolve. Nothing here is ever settled by picking an arbitrary value — a human decides, or it stays open.';

-- ---------------------------------------------------------------------------
-- The listing's last import run, wired after both tables exist.
-- ---------------------------------------------------------------------------
do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'supplier_product_listings_last_run_fkey'
  ) then
    alter table public.supplier_product_listings
      add constraint supplier_product_listings_last_run_fkey
      foreign key (last_import_run_id)
      references public.catalogue_import_runs(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'supplier_listing_prices_run_fkey'
  ) then
    alter table public.supplier_listing_prices
      add constraint supplier_listing_prices_run_fkey
      foreign key (import_run_id)
      references public.catalogue_import_runs(id) on delete set null;
  end if;
end
$do$;
