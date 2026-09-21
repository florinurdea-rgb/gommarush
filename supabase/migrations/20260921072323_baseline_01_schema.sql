-- =====================================================================
-- GommaRush - PRODUCTION SCHEMA BASELINE
-- =====================================================================
-- Captured from production project sfvaqextratpnprcamwd on 2026-09-21
-- via read-only catalog introspection (pg_catalog / information_schema)
-- over the read-only Supabase connector. Production was NOT modified.
--
-- Purpose: put the real production schema under version control and make
-- it reproducible on staging. This file is a BASELINE, not an incremental
-- migration: it is intended to build an EMPTY database from nothing.
--
-- Do NOT run this against production. See docs/SCHEMA_BASELINE.md.
--
-- Load order matters:
--   extensions -> sequences -> tables -> functions -> constraints
--   -> indexes -> triggers -> RLS -> comments
-- Functions come before constraints because
-- client_offer_requests.valid_client_offer_request_tyres calls
-- is_valid_tyre_request().
--
-- EXCLUSIONS (Supabase-managed or environment-specific; see docs):
--   - schemas auth, storage, realtime, vault, graphql, extensions, cron
--   - extensions pg_stat_statements, supabase_vault (platform-managed)
--   - supabase_migrations.schema_migrations ledger rows
--   - all table DATA (schema only - no production data is copied)
--   - roles, grants, publications, webhooks, secrets
-- =====================================================================

-- SEARCH PATH (fidelity, not preference)
-- Production migrations run as the `postgres` role, whose setting is
--   search_path = "$user", public, extensions
-- public.gorush_new_unit_token() is LANGUAGE sql and calls gen_random_bytes()
-- UNQUALIFIED, so it only creates (and only runs) when `extensions` is on the
-- search_path. We reproduce that environment here rather than rewriting the
-- function body, so every function in this file stays byte-identical to
-- production. See docs/SCHEMA_BASELINE.md -> "Known fragility".
set search_path = "$user", public, extensions;

-- Extensions actually used by application objects:
--   pgcrypto   -> gen_random_uuid(), extensions.gen_random_bytes()
--   uuid-ossp  -> present in production; retained for parity
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ============================ SEQUENCES ==============================
-- NOTE: orders_order_number_seq is deliberately absent - it is owned by
-- the orders.order_number IDENTITY column and is created automatically.
create sequence if not exists public.client_offer_request_sequence as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1 cache 1 no cycle;
create sequence if not exists public.quote_request_number_seq as bigint increment by 1 minvalue 1 maxvalue 9223372036854775807 start with 1000 cache 1 no cycle;

-- ============================== TABLES ===============================

create table if not exists public.app_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.catalogue_conflicts (
  id uuid default gen_random_uuid() not null,
  import_run_id uuid,
  import_row_id uuid,
  conflict_type text not null,
  supplier_id uuid,
  supplier_listing_key text,
  catalogue_product_id uuid,
  competing_product_id uuid,
  field text,
  existing_value text,
  incoming_value text,
  detail jsonb,
  status text default 'open'::text not null,
  resolution text,
  resolved_by text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.catalogue_import_rows (
  id uuid default gen_random_uuid() not null,
  import_run_id uuid not null,
  source_row integer not null,
  supplier_listing_key text,
  raw_payload jsonb not null,
  normalized_payload jsonb,
  validation_result text default 'pending'::text not null,
  validation_errors text[] default '{}'::text[] not null,
  match_result text,
  matched_product_id uuid,
  matched_listing_id uuid,
  action text,
  change_set jsonb,
  review_reasons text[] default '{}'::text[] not null,
  committed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.catalogue_import_runs (
  id uuid default gen_random_uuid() not null,
  supplier_id uuid,
  adapter text default 'isb'::text not null,
  original_filename text,
  file_checksum text not null,
  file_size integer,
  storage_bucket text,
  storage_path text,
  import_mode text default 'partial'::text not null,
  status text default 'uploaded'::text not null,
  uploaded_by text,
  started_at timestamp with time zone default now() not null,
  analyzed_at timestamp with time zone,
  committed_at timestamp with time zone,
  finished_at timestamp with time zone,
  source_row_count integer default 0 not null,
  inserted_listings integer default 0 not null,
  updated_listings integer default 0 not null,
  unchanged_listings integer default 0 not null,
  new_products integer default 0 not null,
  updated_products integer default 0 not null,
  deactivated_listings integer default 0 not null,
  missing_ean_count integer default 0 not null,
  invalid_ean_count integer default 0 not null,
  missing_weight_count integer default 0 not null,
  conflict_count integer default 0 not null,
  rejected_rows integer default 0 not null,
  committed_row_count integer default 0 not null,
  batch_size integer default 500 not null,
  error_summary text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.catalogue_products (
  id uuid default gen_random_uuid() not null,
  product_key text not null,
  ean text,
  ean_status text default 'missing'::text not null,
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
  old_dot boolean default false not null,
  weight_kg numeric(8,3),
  weight_status text default 'missing_or_zero'::text not null,
  weight_category text,
  e_mark text,
  european boolean,
  eprel_id text,
  scan_ready boolean default false not null,
  review_required boolean default false not null,
  review_reasons text[] default '{}'::text[] not null,
  active boolean default true not null,
  first_seen_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.client_offer_requests (
  id uuid default gen_random_uuid() not null,
  request_number text default ((('GR-'::text || ((EXTRACT(year FROM now()))::integer)::text) || '-'::text) || lpad((nextval('client_offer_request_sequence'::regclass))::text, 6, '0'::text)) not null,
  company_name text,
  contact_value text not null,
  contact_type text not null,
  delivery_preference text default 'any'::text not null,
  tyres jsonb not null,
  customer_message text,
  status text default 'new'::text not null,
  internal_notes text,
  notification_email_status text default 'pending'::text not null,
  notification_email_id text,
  notification_email_sent_at timestamp with time zone,
  notification_email_error text,
  idempotency_key text,
  source text default 'website'::text not null,
  submitted_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.customer_locations (
  id uuid default gen_random_uuid() not null,
  customer_id uuid not null,
  location_name text,
  address_line1 text not null,
  address_line2 text,
  postal_code text,
  city text not null,
  province text,
  region text,
  country_code text default 'IT'::text not null,
  contact_name text,
  phone text,
  email text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  delivery_notes text,
  opening_hours jsonb,
  is_primary boolean default false not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  recipient_name text
);

create table if not exists public.customers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  legal_name text,
  vat_number text,
  fiscal_code text,
  phone text,
  email text,
  notes text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.document_charges (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  charge_type text not null,
  description text,
  raw_description text,
  quantity numeric(10,2),
  unit_amount numeric(10,2),
  total_amount numeric(10,2),
  line_number integer,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.drivers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text,
  phone text,
  email text,
  notes text,
  auth_user_id uuid,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  current_vehicle_id uuid
);

create table if not exists public.geocode_cache (
  address_key text not null,
  address_text text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.inventory_incidents (
  id uuid default gen_random_uuid() not null,
  inventory_unit_id uuid not null,
  order_id uuid,
  incident_type text not null,
  reason text,
  description text,
  reported_by uuid,
  reported_at timestamp with time zone default now() not null,
  resolved boolean default false not null,
  resolution text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.inventory_scans (
  id uuid default gen_random_uuid() not null,
  inventory_unit_id uuid not null,
  order_id uuid,
  scan_type text not null,
  warehouse_zone_id uuid,
  scanned_by uuid,
  device_type text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  scanned_at timestamp with time zone default now() not null,
  order_item_id uuid,
  result text default 'success'::text not null,
  raw_value text,
  driver_id uuid,
  vehicle_id uuid,
  operator_session text,
  stand_code text,
  manual boolean default false not null,
  reason text,
  metadata jsonb,
  idempotency_key text
);

create table if not exists public.inventory_units (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  order_item_id uuid not null,
  unit_type text not null,
  unit_sequence integer,
  qr_token text default encode(extensions.gen_random_bytes(12), 'hex'::text) not null,
  status text default 'expected'::text not null,
  current_zone_id uuid,
  received_at timestamp with time zone,
  stored_at timestamp with time zone,
  loaded_at timestamp with time zone,
  delivered_at timestamp with time zone,
  returned_at timestamp with time zone,
  missing_at timestamp with time zone,
  lost_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  description text,
  last_stand_code text,
  last_vehicle_id uuid,
  matched_manually boolean default false not null
);

create table if not exists public.order_documents (
  id uuid default gen_random_uuid() not null,
  order_id uuid,
  supplier_id uuid,
  source_type text not null,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  extraction_status text default 'pending'::text not null,
  extraction_confidence numeric(5,4),
  raw_extracted_data jsonb,
  customer_match_confidence numeric(5,4),
  location_match_confidence numeric(5,4),
  address_difference_detected boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  file_size integer,
  analysis_provider text,
  analysis_error text,
  analysed_at timestamp with time zone,
  uploaded_by_label text
);

create table if not exists public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  line_number integer,
  item_type text default 'tyre'::text not null,
  supplier_sku text,
  raw_description text,
  brand text,
  model text,
  width integer,
  aspect_ratio integer,
  rim_diameter numeric(4,1),
  load_index text,
  speed_rating text,
  season text,
  extra_load boolean,
  run_flat boolean,
  quantity integer default 1 not null,
  unit_of_measure text default 'NR'::text,
  unit_price numeric(12,2),
  discount_percent numeric(7,3),
  line_subtotal numeric(12,2),
  vat_percent numeric(5,2),
  line_total numeric(12,2),
  environmental_fee numeric(12,2),
  logistics_fee numeric(12,2),
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  description text,
  is_physical boolean default true not null,
  needs_review boolean default false not null,
  review_fields text[] default '{}'::text[] not null,
  confidence numeric(4,3),
  manufacturer_code text,
  ean text,
  commercial_c boolean,
  mud_snow boolean,
  three_pmsf boolean
);
create table if not exists public.order_status_history (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  old_status text,
  new_status text not null,
  changed_by uuid,
  notes text,
  changed_at timestamp with time zone default now() not null,
  changed_by_label text
);

create table if not exists public.orders (
  id uuid default gen_random_uuid() not null,
  order_number bigint generated always as identity not null,
  qr_token text default encode(extensions.gen_random_bytes(12), 'hex'::text) not null,
  supplier_id uuid not null,
  supplier_location_id uuid,
  customer_id uuid,
  customer_location_id uuid,
  supplier_document_number text,
  supplier_order_reference text,
  document_type text,
  document_date date,
  source_type text default 'manual'::text not null,
  delivery_name text,
  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_postal_code text,
  delivery_city text,
  delivery_province text,
  delivery_region text,
  delivery_country_code text default 'IT'::text not null,
  payment_method text,
  cash_on_delivery boolean default false not null,
  collection_method text,
  amount_to_collect numeric(12,2),
  payment_status text default 'unknown'::text not null,
  currency text default 'EUR'::text not null,
  subtotal_amount numeric(12,2),
  tax_amount numeric(12,2),
  total_amount numeric(12,2),
  carrier_name text,
  tracking_number text,
  package_count integer,
  weight_kg numeric(10,2),
  assigned_zone_id uuid,
  status text default 'draft'::text not null,
  expected_at timestamp with time zone,
  received_at timestamp with time zone,
  stored_at timestamp with time zone,
  loaded_at timestamp with time zone,
  delivered_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  planned_delivery_date date,
  stand_code text,
  driver_id uuid,
  vehicle_id uuid,
  held_at timestamp with time zone,
  status_before_hold text,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  delivery_notes text,
  source_document_id uuid,
  delivery_sequence integer,
  normalized_document_number text,
  giro text,
  agent text,
  carrier text,
  cash_required boolean,
  cheque_required boolean,
  tyre_count integer,
  physical_item_count integer,
  transport_rate_snapshot numeric(10,2),
  transport_revenue numeric(10,2),
  source_hash text,
  fingerprint text,
  extraction_confidence numeric(4,3),
  ready_at timestamp with time zone,
  amount_collected numeric(10,2),
  payment_collected_at timestamp with time zone,
  delivery_failure_reason text,
  delivery_failed_at timestamp with time zone
);

create table if not exists public.print_jobs (
  id uuid default gen_random_uuid() not null,
  order_id uuid,
  inventory_unit_id uuid,
  print_type text not null,
  status text default 'pending'::text not null,
  printer_name text,
  label_data jsonb,
  requested_at timestamp with time zone default now() not null,
  printed_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  claimed_by text,
  claimed_at timestamp with time zone,
  attempts integer default 0 not null,
  idempotency_key text
);

create table if not exists public.product_identifiers (
  id uuid default gen_random_uuid() not null,
  catalogue_product_id uuid not null,
  identifier_type text not null,
  identifier_value text not null,
  normalized_value text not null,
  supplier_id uuid,
  validation_status text default 'unverified'::text not null,
  source text,
  first_seen_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.quote_request_events (
  id uuid default gen_random_uuid() not null,
  quote_request_id uuid,
  event_type text not null,
  meta jsonb default '{}'::jsonb not null,
  duration_ms integer,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.quote_request_items (
  id uuid default gen_random_uuid() not null,
  quote_request_id uuid not null,
  product_type text not null,
  description text,
  width integer,
  profile integer,
  rim integer,
  load_speed_index text,
  quantity integer not null,
  preference_type text,
  preferred_brand text,
  delivery_speed text not null,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  season text
);

create table if not exists public.quote_request_reference_counter (
  day date not null,
  last_value integer default 0 not null
);

create table if not exists public.quote_request_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text,
  received_at timestamp with time zone default now() not null
);

create table if not exists public.quote_requests (
  id uuid default gen_random_uuid() not null,
  request_number text default ('GR-'::text || (nextval('quote_request_number_seq'::regclass))::text) not null,
  company_name text not null,
  contact_email text not null,
  whatsapp text,
  language text default 'it'::text not null,
  status text default 'submitted'::text not null,
  notification_email_sent boolean default false not null,
  notification_email_error text,
  notification_email_sent_at timestamp with time zone,
  idempotency_key text,
  source text default 'web'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  public_reference text not null,
  notes text,
  delivery_preference text,
  submitted_at timestamp with time zone default now(),
  notification_status text default 'pending'::text not null,
  notification_provider text,
  provider_message_id text,
  notification_attempts integer default 0 not null,
  last_notification_attempt_at timestamp with time zone,
  notification_sent_at timestamp with time zone,
  notification_delivered_at timestamp with time zone,
  notification_failed_at timestamp with time zone,
  last_notification_error text
);

create table if not exists public.supplier_customer_refs (
  id uuid default gen_random_uuid() not null,
  supplier_id uuid not null,
  customer_id uuid not null,
  customer_location_id uuid,
  supplier_customer_code text,
  supplier_customer_name text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.supplier_listing_prices (
  id uuid default gen_random_uuid() not null,
  supplier_listing_id uuid not null,
  purchase_price numeric(12,4),
  currency text default 'EUR'::text not null,
  stock_raw text,
  stock_exact integer,
  stock_minimum integer,
  observed_at timestamp with time zone default now() not null,
  import_run_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.supplier_locations (
  id uuid default gen_random_uuid() not null,
  supplier_id uuid not null,
  location_name text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  province text,
  region text,
  country_code text default 'IT'::text not null,
  phone text,
  email text,
  is_primary boolean default false not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.supplier_product_listings (
  id uuid default gen_random_uuid() not null,
  supplier_id uuid not null,
  catalogue_product_id uuid not null,
  supplier_listing_key text not null,
  supplier_article_id text not null,
  supplier_item_code text,
  source_product_key text,
  source_row integer,
  old_dot boolean default false not null,
  active boolean default true not null,
  first_seen_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null,
  deactivated_at timestamp with time zone,
  last_import_run_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.suppliers (
  id uuid default gen_random_uuid() not null,
  name text not null,
  legal_name text,
  vat_number text,
  fiscal_code text,
  phone text,
  email text,
  website text,
  notes text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.vehicles (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text,
  registration text,
  notes text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  capacity_units integer,
  display_order integer,
  color_key text
);

create table if not exists public.warehouse_zones (
  id uuid default gen_random_uuid() not null,
  code text not null,
  name text not null,
  zone_type text not null,
  sort_order integer,
  qr_token text default encode(extensions.gen_random_bytes(12), 'hex'::text) not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

