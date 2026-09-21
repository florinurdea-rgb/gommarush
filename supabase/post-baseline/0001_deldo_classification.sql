-- Deldo observation classification — POST-BASELINE MIGRATION
-- =========================================================
--
-- Applies on top of 0001 + 0002. NOT APPLIED to production or staging.
--
-- Gives the schema somewhere to record whether an observation describes the
-- real commercial world or a supplier's test data. Without it, Deldo's sample
-- feed — which the supplier states carries fictional stocks and prices — would
-- be indistinguishable from real data the moment it was persisted, and
-- src/lib/suppliers/deldo/feed/import.ts refuses to write anything until this
-- exists.
--
-- FAIL-CLOSED, and that is the whole design.
--
-- An earlier draft of this used `not null default 'live'`. That was wrong in
-- the one direction that matters: it makes the failure mode of forgetting to
-- classify "it silently became commercial data", which is exactly the hazard
-- the column exists to remove. Any INSERT written before this migration, a
-- future adapter, a manual backfill or a COPY could omit the column and
-- produce commercial-looking rows from fictional input.
--
-- So: NOT NULL with NO DEFAULT. Omission is an error at the database level.
--
-- The three-step shape below — add nullable, backfill explicitly, set not null
-- — is what makes that possible on tables that already hold rows, and it
-- forces the backfill to be a reviewable statement about specific known rows
-- rather than a rule silently applied to everything that comes later.

-- One vocabulary, shared by every table that carries a classification.
create domain public.data_classification as text
  check (value in ('live', 'test'));

comment on domain public.data_classification is
  'Whether a row describes the real commercial world or supplier test data. There is deliberately no default anywhere: a row that does not say what it is must fail, never default to live.';

-- ---------------------------------------------------------------------------
-- catalogue_import_runs: provenance of a whole import
-- ---------------------------------------------------------------------------
alter table public.catalogue_import_runs
  add column data_classification public.data_classification;

-- Explicit backfill, as a statement about rows we have actually looked at.
-- At the time of writing production holds exactly one run: the real
-- Inter-Sprint ISB upload of 2026-09-08. It is live data.
update public.catalogue_import_runs
   set data_classification = 'live'
 where data_classification is null;

alter table public.catalogue_import_runs
  alter column data_classification set not null;

-- ---------------------------------------------------------------------------
-- supplier_listing_prices: provenance of each observation
-- ---------------------------------------------------------------------------
-- Carried on the observation as well as the run. An observation outlives the
-- run it came from and is queried on its own, so a query must never have to
-- join back to discover whether a price is real.
alter table public.supplier_listing_prices
  add column data_classification public.data_classification,
  -- Deldo documents two pricing modes: tyre price with transport invoiced
  -- separately, or transport included for a destination country. Which one
  -- GoRush receives is not yet confirmed with the supplier, so 'unknown' is a
  -- legitimate EXPLICIT state that the application always writes deliberately
  -- — it is not a fallback for a caller that forgot. classifyObservation()
  -- treats it as not commercially usable.
  add column commercial_mode text
    check (commercial_mode in ('transport_separate', 'transport_included', 'unknown')),
  add column observation_source text
    check (observation_source in ('bulk_feed', 'live_lookup', 'manual'));

-- Every existing row came from the Inter-Sprint XLSX upload: real data, from a
-- bulk feed, with no transport arrangement encoded in the price.
update public.supplier_listing_prices
   set data_classification = 'live',
       commercial_mode     = 'unknown',
       observation_source  = 'bulk_feed'
 where data_classification is null;

alter table public.supplier_listing_prices
  alter column data_classification set not null,
  alter column commercial_mode     set not null,
  alter column observation_source  set not null;

comment on column public.supplier_listing_prices.commercial_mode is
  'What the price includes. ''unknown'' means the supplier has not confirmed which pricing mode applies and the price cannot yet be marked up or compared.';

-- ---------------------------------------------------------------------------
-- Index: the exclusion that customer-facing queries depend on
-- ---------------------------------------------------------------------------
-- Every commercial read filters out test data, so the filter should not be a
-- sequential scan once a real hourly feed is landing thousands of rows.
create index if not exists supplier_listing_prices_live_idx
  on public.supplier_listing_prices (supplier_listing_id, observed_at desc)
  where data_classification = 'live';
