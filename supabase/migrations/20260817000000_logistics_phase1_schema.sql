-- ============================================================================
-- GoRush Logistics — Phase 1 schema additions
-- ============================================================================
-- Written against the ACTUAL live schema of Supabase project sfvaqextratpnprcamwd
-- as inspected on 2026-08-17. The logistics tables (suppliers, customers,
-- customer_locations, orders, order_items, order_documents, inventory_units,
-- inventory_scans, inventory_incidents, order_status_history, print_jobs,
-- warehouse_zones, supplier_locations, supplier_customer_refs) ALREADY EXIST.
--
-- This migration therefore only ADDS what Phase 1 needs:
--   * new tables: drivers, vehicles
--   * new columns on existing tables
--   * widened CHECK vocabularies (e.g. orders gains 'on_hold')
--   * new indexes, including the stand-collision guarantee
--   * the private storage bucket for original supplier documents
--
-- It does NOT recreate, rename, drop or rewrite anything that already exists.
-- Existing column names are used as-is rather than renamed to my preference —
-- e.g. inventory_units.qr_token / unit_sequence / unit_type, orders.delivery_name,
-- orders.cash_on_delivery, order_items.environmental_fee (= PFU),
-- order_status_history.old_status/new_status. The application layer adapts to
-- the database, not the other way round.
--
-- NOTE on orders.order_number: it is bigint GENERATED ALWAYS AS IDENTITY. It is
-- never written by the application. The human-facing "GR-001" form is produced
-- by formatOrderNumber() in src/lib/logistics/order-number.ts.
--
-- Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- `set_updated_at()` and the per-table updated_at triggers already exist for
-- every pre-existing table; only the new tables below need them wired up.

-- ---------------------------------------------------------------------------
-- Helper: widen a CHECK vocabulary without invalidating existing rows
-- ---------------------------------------------------------------------------
-- Adds values to an existing `col = ANY (ARRAY[...])` check by rebuilding it as
-- the UNION of the required values and every value already present in the
-- column. Tightening is never possible through this function, by design.
create or replace function public.gorush_widen_value_check(
  target_table text,
  target_column text,
  constraint_name text,
  extra_values text[]
)
returns void
language plpgsql
as $$
declare
  existing_values text[] := '{}';
  allowed_values text[] := '{}';
  merged text[];
  value_list text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = target_table and column_name = target_column
  ) then
    raise warning 'gorush_widen_value_check: %.% does not exist, skipping', target_table, target_column;
    return;
  end if;

  -- Values currently allowed by the constraint, parsed out of its definition.
  select coalesce(array_agg(m[1]), '{}')
    into allowed_values
    from pg_constraint c,
         regexp_matches(pg_get_constraintdef(c.oid), '''([^'']+)''::text', 'g') as m
   where c.connamespace = 'public'::regnamespace
     and c.conname = constraint_name;

  -- Values actually stored, so an out-of-band value can never be orphaned.
  execute format(
    'select coalesce(array_agg(distinct %I), ''{}'') from public.%I where %I is not null',
    target_column, target_table, target_column
  ) into existing_values;

  select array_agg(distinct v order by v)
    into merged
    from unnest(allowed_values || existing_values || extra_values) as v;

  select string_agg(quote_literal(v), ', ') into value_list from unnest(merged) as v;

  execute format('alter table public.%I drop constraint if exists %I', target_table, constraint_name);
  execute format(
    'alter table public.%I add constraint %I check (%I = any (array[%s]))',
    target_table, constraint_name, target_column, value_list
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- NEW: drivers and vehicles
-- ---------------------------------------------------------------------------
-- Deliberately NOT bound to each other: a driver may change van any day, so the
-- pairing lives on the order, not on the driver record.
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  phone text,
  email text,
  notes text,
  -- Nullable link to a future Supabase Auth user. Present so real driver
  -- authentication can be added without a schema change.
  auth_user_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists drivers_slug_key on public.drivers(slug) where slug is not null;
create index if not exists drivers_active_idx on public.drivers(active);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text,
  registration text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vehicles_slug_key on public.vehicles(slug) where slug is not null;
create index if not exists vehicles_active_idx on public.vehicles(active);

drop trigger if exists drivers_set_updated_at on public.drivers;
create trigger drivers_set_updated_at before update on public.drivers
  for each row execute function public.set_updated_at();

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

alter table public.orders add column if not exists planned_delivery_date date;

-- Temporary sorting stand A–E. This is NOT a warehouse zone: there is
-- deliberately no FK to warehouse_zones. (orders.assigned_zone_id already
-- exists for the future physical-zone model and is left untouched.)
alter table public.orders add column if not exists stand_code text;

alter table public.orders add column if not exists driver_id uuid references public.drivers(id) on delete set null;
alter table public.orders add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

-- Hold bookkeeping: remembering the pre-hold status is what lets reactivation
-- return an order to the right place instead of resetting it.
alter table public.orders add column if not exists held_at timestamptz;
alter table public.orders add column if not exists status_before_hold text;

alter table public.orders add column if not exists cancelled_at timestamptz;
alter table public.orders add column if not exists cancellation_reason text;

alter table public.orders add column if not exists delivery_notes text;
alter table public.orders add column if not exists source_document_id uuid;

alter table public.orders drop constraint if exists orders_stand_code_chk;
alter table public.orders
  add constraint orders_stand_code_chk
  check (stand_code is null or stand_code in ('A', 'B', 'C', 'D', 'E'));

-- Adds 'on_hold' to the existing status vocabulary (draft, review_required,
-- confirmed, expected, partially_received, received, sorting, stored,
-- ready_for_loading, partially_loaded, loaded, out_for_delivery,
-- partially_delivered, delivered, returned, cancelled) without breaking any of
-- them.
select public.gorush_widen_value_check('orders', 'status', 'orders_status_check', array['on_hold']);

create index if not exists orders_planned_delivery_date_idx on public.orders(planned_delivery_date);
create index if not exists orders_stand_code_idx on public.orders(stand_code);
create index if not exists orders_driver_idx on public.orders(driver_id);
create index if not exists orders_vehicle_idx on public.orders(vehicle_id);
create index if not exists orders_status_idx on public.orders(status);

-- THE stand-collision guarantee. A stand can only be held by ONE order that is
-- still in a warehouse stage; it frees itself as soon as the order moves on, so
-- there is no release step to forget. Application checks alone would race under
-- concurrent saves — this index is what actually prevents double-booking.
do $$
begin
  create unique index if not exists orders_active_stand_key
    on public.orders(stand_code)
    where stand_code is not null
      and status in ('expected', 'partially_received', 'received', 'sorting', 'stored', 'ready_for_loading');
exception
  when unique_violation then
    raise warning 'orders_active_stand_key not created: existing rows already share an active stand. Resolve the duplicates and re-run.';
end;
$$;

-- ---------------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: raw_description, brand, model, width,
-- aspect_ratio, rim_diameter, load_index, speed_rating, extra_load, run_flat,
-- quantity, unit_price, vat_percent (tax), environmental_fee (PFU),
-- logistics_fee, season, unit_of_measure, notes.

-- Normalised, human-facing description. raw_description keeps the document's
-- own text untouched.
alter table public.order_items add column if not exists description text;

-- Fees / PFU / transport / services are real order lines but not physical
-- objects, so they get no inventory_units. Defaulted from item_type at insert
-- time; overridable per line for the future "fee that ships as an object".
alter table public.order_items add column if not exists is_physical boolean not null default true;

-- Extraction quality: low-confidence fields are flagged for a human rather than
-- guessed.
alter table public.order_items add column if not exists needs_review boolean not null default false;
alter table public.order_items add column if not exists review_fields text[] not null default '{}';
alter table public.order_items add column if not exists confidence numeric(4, 3);

-- Backfill is_physical for any pre-existing rows.
update public.order_items
   set is_physical = (item_type not in ('service', 'fee'))
 where is_physical is distinct from (item_type not in ('service', 'fee'));

create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_physical_idx on public.order_items(order_id, is_physical);
create index if not exists order_items_supplier_sku_idx on public.order_items(lower(supplier_sku));
create index if not exists order_items_brand_idx on public.order_items(lower(brand));

-- ---------------------------------------------------------------------------
-- inventory_units
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: unit_type, unit_sequence, qr_token (the
-- printed Code128/QR value and the single source of truth for scanning),
-- status, current_zone_id, received_at, stored_at, loaded_at, delivered_at,
-- returned_at, missing_at, lost_at.

alter table public.inventory_units add column if not exists description text;

-- Denormalised "last known" fields for fast warehouse lookups. inventory_scans
-- remains the authoritative audit trail.
alter table public.inventory_units add column if not exists last_stand_code text;
alter table public.inventory_units add column if not exists last_vehicle_id uuid references public.vehicles(id) on delete set null;

-- True when a human picked the association instead of a confident label match.
alter table public.inventory_units add column if not exists matched_manually boolean not null default false;

create index if not exists inventory_units_order_idx on public.inventory_units(order_id);
create index if not exists inventory_units_status_idx on public.inventory_units(status);
create index if not exists inventory_units_order_status_idx on public.inventory_units(order_id, status);
create index if not exists inventory_units_item_status_idx on public.inventory_units(order_item_id, status);

-- ---------------------------------------------------------------------------
-- inventory_scans
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: inventory_unit_id, order_id, scan_type,
-- warehouse_zone_id, scanned_by (uuid, for future Supabase Auth), device_type,
-- notes, scanned_at.

alter table public.inventory_scans add column if not exists order_item_id uuid references public.order_items(id) on delete set null;

-- success | duplicate | rejected — a rejected wrong-driver scan must still
-- leave a trace, which is why the result is recorded rather than the row simply
-- not being written.
alter table public.inventory_scans add column if not exists result text not null default 'success';

alter table public.inventory_scans add column if not exists raw_value text;
alter table public.inventory_scans add column if not exists driver_id uuid references public.drivers(id) on delete set null;
alter table public.inventory_scans add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;
-- Text operator identity for the Phase 1 dev sessions (scanned_by is a uuid
-- reserved for real auth).
alter table public.inventory_scans add column if not exists operator_session text;
alter table public.inventory_scans add column if not exists stand_code text;

-- A manual override must never be indistinguishable from a real scan.
alter table public.inventory_scans add column if not exists manual boolean not null default false;
alter table public.inventory_scans add column if not exists reason text;
alter table public.inventory_scans add column if not exists metadata jsonb;

-- Guards against scanner/network double-submission.
alter table public.inventory_scans add column if not exists idempotency_key text;

alter table public.inventory_scans drop constraint if exists inventory_scans_result_chk;
alter table public.inventory_scans
  add constraint inventory_scans_result_chk check (result in ('success', 'duplicate', 'rejected'));

-- Existing scan_type vocabulary (received, zone_scan, storage, loading,
-- unloading, delivery, return, inventory_check, found, manual_check) already
-- covers supplier-label receipt ('received'), manual association
-- ('manual_check'), storage, loading and duplicate audits ('inventory_check').
-- Only the manual loading override needs a new value.
select public.gorush_widen_value_check(
  'inventory_scans', 'scan_type', 'inventory_scans_scan_type_check', array['manual_loading']
);

create unique index if not exists inventory_scans_idempotency_key
  on public.inventory_scans(idempotency_key) where idempotency_key is not null;
create index if not exists inventory_scans_unit_idx on public.inventory_scans(inventory_unit_id, scanned_at desc);
create index if not exists inventory_scans_order_idx on public.inventory_scans(order_id, scanned_at desc);

-- ---------------------------------------------------------------------------
-- print_jobs
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: print_type ('inventory_unit_label'), status,
-- printer_name, label_data, requested_at, printed_at, error_message.

-- Claim bookkeeping, so two Print Agents can never print the same job and a
-- crashed agent's job can be recovered.
alter table public.print_jobs add column if not exists claimed_by text;
alter table public.print_jobs add column if not exists claimed_at timestamptz;
alter table public.print_jobs add column if not exists attempts integer not null default 0;
alter table public.print_jobs add column if not exists idempotency_key text;

create unique index if not exists print_jobs_idempotency_key
  on public.print_jobs(idempotency_key) where idempotency_key is not null;

-- Idempotency at the database level: at most one OPEN job per physical unit, so
-- a double-scan can never queue two labels for the same tyre.
create unique index if not exists print_jobs_open_unit_key
  on public.print_jobs(inventory_unit_id)
  where inventory_unit_id is not null and status in ('pending', 'processing');

create index if not exists print_jobs_status_created_idx on public.print_jobs(status, created_at);

-- ---------------------------------------------------------------------------
-- order_documents
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: source_type (pdf|image|manual|email),
-- storage_bucket, storage_path, original_filename, mime_type,
-- extraction_status, extraction_confidence, raw_extracted_data,
-- customer_match_confidence, location_match_confidence,
-- address_difference_detected.

alter table public.order_documents add column if not exists file_size integer;
alter table public.order_documents add column if not exists analysis_provider text;
alter table public.order_documents add column if not exists analysis_error text;
alter table public.order_documents add column if not exists analysed_at timestamptz;
alter table public.order_documents add column if not exists uploaded_by_label text;

-- 'unconfigured' is the honest status for "no AI/OCR provider is configured".
-- It is distinct from 'failed' (we tried and could not read it) and from
-- 'review_required' (we read it and a human should check).
select public.gorush_widen_value_check(
  'order_documents', 'extraction_status', 'order_documents_extraction_status_check',
  array['unconfigured']
);

create index if not exists order_documents_order_idx on public.order_documents(order_id);
create index if not exists order_documents_created_at_idx on public.order_documents(created_at desc);

-- orders.source_document_id needs order_documents, hence the deferred FK.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_source_document_id_fkey') then
    alter table public.orders
      add constraint orders_source_document_id_fkey
      foreign key (source_document_id) references public.order_documents(id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- order_status_history
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: old_status, new_status, changed_by (uuid),
-- notes, changed_at. This table is why "Delete Order" can be a safe
-- cancellation without losing the order's history.

-- Text actor label for the Phase 1 dev admin session ("admin:test"), since
-- changed_by is a uuid reserved for real auth.
alter table public.order_status_history add column if not exists changed_by_label text;

create index if not exists order_status_history_order_idx
  on public.order_status_history(order_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- inventory_incidents
-- ---------------------------------------------------------------------------
-- Phase 1 does not build the returns workflow, but must not break its model.
-- The existing vocabulary already keeps 'missing' (expected but not currently
-- findable) and 'lost' (loss confirmed after investigation) distinct, which is
-- the important part. Only quarantine/disposed are missing.
select public.gorush_widen_value_check(
  'inventory_incidents', 'incident_type', 'inventory_incidents_incident_type_check',
  array['quarantine', 'disposed']
);

create index if not exists inventory_incidents_unit_idx on public.inventory_incidents(inventory_unit_id);

-- ---------------------------------------------------------------------------
-- customer_locations
-- ---------------------------------------------------------------------------
-- Existing columns reused as-is: location_name, address_line1 (NOT NULL),
-- city (NOT NULL), province, region, postal_code, country_code, contact_name,
-- phone, email, delivery_notes, is_primary, active.
alter table public.customer_locations add column if not exists recipient_name text;

create index if not exists customer_locations_customer_idx on public.customer_locations(customer_id);
create index if not exists customer_locations_city_idx on public.customer_locations(lower(city));

create index if not exists customers_name_idx on public.customers(lower(name));
create index if not exists customers_vat_idx on public.customers(lower(vat_number));

-- ---------------------------------------------------------------------------
-- Row Level Security for the new tables
-- ---------------------------------------------------------------------------
-- Same posture as every existing table in this project: RLS ON with NO
-- policies, so the anon key cannot read or write. All access goes through
-- server-side code using the service-role key
-- (src/lib/supabase/server-admin.ts), which bypasses RLS by design. Public
-- read-only pages (/stand/[code], /orders/[id]) are server-rendered and expose
-- only a hand-picked, non-sensitive projection.
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;

-- ---------------------------------------------------------------------------
-- Private storage bucket for original supplier documents
-- ---------------------------------------------------------------------------
-- Private: documents are only ever served through server-side code that has
-- already checked the admin session. The source document is never discarded
-- after extraction.
insert into storage.buckets (id, name, public)
values ('order-documents', 'order-documents', false)
on conflict (id) do nothing;
