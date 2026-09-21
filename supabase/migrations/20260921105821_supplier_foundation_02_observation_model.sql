-- Phase 1 / part 2: extend supplier_listing_prices into the full normalized
-- observation model. Reused deliberately - it already IS the time-series
-- observation table (one row per observation, keyed by observed_at). Creating a
-- parallel table would be the "separate incompatible architecture" the
-- specification forbids.
--
-- Every column is additive and nullable (or defaulted), so existing rows and
-- gorush_commit_catalogue_batch keep working untouched.
set search_path = "$user", public, extensions;

alter table public.supplier_listing_prices add column if not exists source_type text not null default 'file_import';
alter table public.supplier_listing_prices add column if not exists stock_status text;
alter table public.supplier_listing_prices add column if not exists stock_confidence text;
alter table public.supplier_listing_prices add column if not exists lead_time_days integer;
alter table public.supplier_listing_prices add column if not exists delivery_class text;
alter table public.supplier_listing_prices add column if not exists price_verified_at timestamptz;
alter table public.supplier_listing_prices add column if not exists stock_verified_at timestamptz;
alter table public.supplier_listing_prices add column if not exists pfu_amount numeric(12,4);
alter table public.supplier_listing_prices add column if not exists pfu_status text;
alter table public.supplier_listing_prices add column if not exists pfu_source text;
alter table public.supplier_listing_prices add column if not exists dot_code text;
alter table public.supplier_listing_prices add column if not exists observed_by text;
alter table public.supplier_listing_prices add column if not exists observation_note text;

-- THE STRUCTURAL TEST-DATA GUARD.
-- Deldo supplied sample files explicitly described as fictional/non-current.
-- Anything derived from them carries true and is excluded from every commercial
-- query by the view below - enforced by a query boundary, not a UI warning.
alter table public.supplier_listing_prices add column if not exists is_test_data boolean not null default false;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='slp_source_type_chk') then
    alter table public.supplier_listing_prices add constraint slp_source_type_chk
      check (source_type = any (array['file_import','ftp_feed','api','manual']));
  end if;
  if not exists (select 1 from pg_constraint where conname='slp_stock_status_chk') then
    alter table public.supplier_listing_prices add constraint slp_stock_status_chk
      check (stock_status is null or stock_status = any (array['in_stock','low','out_of_stock','on_request','unknown']));
  end if;
  if not exists (select 1 from pg_constraint where conname='slp_stock_confidence_chk') then
    alter table public.supplier_listing_prices add constraint slp_stock_confidence_chk
      check (stock_confidence is null or stock_confidence = any (array['exact','approximate','boolean_only','stated','unknown']));
  end if;
  if not exists (select 1 from pg_constraint where conname='slp_delivery_class_chk') then
    alter table public.supplier_listing_prices add constraint slp_delivery_class_chk
      check (delivery_class is null or delivery_class = any (array['24h','48h','5_7d','unknown']));
  end if;
  if not exists (select 1 from pg_constraint where conname='slp_pfu_status_chk') then
    alter table public.supplier_listing_prices add constraint slp_pfu_status_chk
      check (pfu_status is null or pfu_status = any (array['SUPPLIER_EXACT','RULE_CALCULATED','MANUAL_CONFIRMED','TO_CONFIRM']));
  end if;
  -- Never claim an exact PFU amount without a provenance that justifies it.
  if not exists (select 1 from pg_constraint where conname='slp_pfu_provenance_chk') then
    alter table public.supplier_listing_prices add constraint slp_pfu_provenance_chk
      check (pfu_amount is null or pfu_status = any (array['SUPPLIER_EXACT','RULE_CALCULATED','MANUAL_CONFIRMED']));
  end if;
  -- An exact stock count must declare itself exact.
  if not exists (select 1 from pg_constraint where conname='slp_stock_exact_confidence_chk') then
    alter table public.supplier_listing_prices add constraint slp_stock_exact_confidence_chk
      check (stock_exact is null or stock_confidence is null or stock_confidence <> 'boolean_only');
  end if;
  if not exists (select 1 from pg_constraint where conname='slp_lead_time_chk') then
    alter table public.supplier_listing_prices add constraint slp_lead_time_chk
      check (lead_time_days is null or lead_time_days >= 0);
  end if;
  -- A manual observation must record WHO observed it.
  if not exists (select 1 from pg_constraint where conname='slp_manual_observer_chk') then
    alter table public.supplier_listing_prices add constraint slp_manual_observer_chk
      check (source_type <> 'manual' or observed_by is not null);
  end if;
end $$;

-- Backfill: every pre-existing row came from the ISB spreadsheet import.
update public.supplier_listing_prices
   set source_type = 'file_import'
 where source_type is null;

-- Commercial-path index: only non-test observations, newest first.
create index if not exists slp_commercial_latest_idx
  on public.supplier_listing_prices (supplier_listing_id, observed_at desc)
  where is_test_data = false;

comment on column public.supplier_listing_prices.is_test_data is
  'STRUCTURAL GUARD. True for anything derived from supplier sample/test files (notably Deldo material described by the supplier as fictional/non-current). Commercial queries MUST go through supplier_commercial_observations, which excludes these rows.';
comment on column public.supplier_listing_prices.stock_confidence is
  'How far a stock figure may be trusted. NULL/unknown means the supplier did not say - never render it as a count.';
comment on column public.supplier_listing_prices.pfu_status is
  'PFU provenance. TO_CONFIRM when the applicable PFU cannot be determined reliably - never an invented amount.';

-- ---------------------------------------------------------------------------
-- Flag a whole ingestion run as test data, so sample files cannot leak in
-- row-by-row.
-- ---------------------------------------------------------------------------
alter table public.catalogue_import_runs add column if not exists is_test_data boolean not null default false;
comment on column public.catalogue_import_runs.is_test_data is
  'True when the whole run ingested supplier sample/test material. Every observation it produces inherits is_test_data.';

-- ---------------------------------------------------------------------------
-- THE COMMERCIAL QUERY BOUNDARY.
--
-- The single sanctioned source of supplier offers for any commercial or
-- operator-facing purpose. Excluding test data here means every consumer
-- inherits the guard - a caller cannot forget the predicate, because the
-- predicate is not theirs to write.
--
-- One row per (listing) = its LATEST non-test observation.
-- ---------------------------------------------------------------------------
create or replace view public.supplier_commercial_observations as
select distinct on (p.supplier_listing_id)
  p.id                        as observation_id,
  p.supplier_listing_id,
  l.supplier_id,
  s.lane_code,
  s.name                      as supplier_name,
  l.catalogue_product_id,
  l.supplier_article_id,
  l.supplier_listing_key,
  l.old_dot,
  p.purchase_price,
  p.currency,
  p.stock_exact,
  p.stock_raw,
  p.stock_status,
  p.stock_confidence,
  coalesce(p.lead_time_days, s.default_lead_time_days)  as lead_time_days,
  coalesce(p.delivery_class, s.delivery_class, 'unknown') as delivery_class,
  p.observed_at,
  p.price_verified_at,
  p.stock_verified_at,
  p.source_type,
  p.pfu_amount,
  coalesce(p.pfu_status, 'TO_CONFIRM') as pfu_status,
  p.pfu_source,
  p.dot_code,
  p.observed_by,
  p.observation_note,
  s.price_ttl_hours,
  s.stock_ttl_hours,
  s.stale_multiplier
from public.supplier_listing_prices p
join public.supplier_product_listings l on l.id = p.supplier_listing_id
join public.suppliers s on s.id = l.supplier_id
where p.is_test_data = false        -- structural test-data exclusion
  and l.active = true
  and s.active = true
  and s.is_sourcing_lane = true     -- logistics-only counterparties never appear
order by p.supplier_listing_id, p.observed_at desc, p.created_at desc;

comment on view public.supplier_commercial_observations is
  'THE commercial query boundary for supplier offers: latest non-test observation per active listing on an active sourcing lane. Never query supplier_listing_prices directly for a commercial or operator-facing result - this view is what excludes test data, inactive listings and logistics-only counterparties.';
