-- GommaRush canonical schema baseline
-- ===================================
--
-- Captured from the PRODUCTION database (project sfvaqextratpnprcamwd,
-- PostgreSQL 17.6) on 2026-09-21 by read-only introspection, and proved from
-- empty on a disposable PostgreSQL 17.6 instance.
--
-- WHY THIS FILE EXISTS
--
-- The repository's migration history could not build the schema. Applying all
-- 20 migrations to an empty database produced 10 of 32 tables: fourteen
-- tables, including orders, order_items, customers, suppliers,
-- inventory_units and warehouse_zones, were created directly against the
-- database and had no DDL in version control at all. Evidence and method:
-- docs/SCHEMA_RECONCILIATION_REPORT.md.
--
-- This file is therefore generated from what production actually contains,
-- not assembled from what the migrations intended. It is the new starting
-- point: every future schema change must be a migration on top of it, and
-- scripts/verify-migration-baseline.sh exists to keep that true.
--
-- WHAT IT IS NOT
--
-- It is not a rewrite of history. The previous migrations remain in git
-- history, where the reasoning behind each one is still readable. It is also
-- not a statement that everything here was deliberate — see
-- docs/SCHEMA_RECONCILIATION_REPORT.md section 8 for the observed
-- inconsistencies, which are documented rather than silently tidied away.
--
-- ORDER: extensions, tables, constraints, indexes, functions, triggers, RLS.
-- Foreign keys come after every table so the file has no ordering
-- dependencies between tables.
--
-- NOT APPLIED to production or staging.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Supabase provides the `extensions` schema and installs pgcrypto and
-- uuid-ossp there. pg_stat_statements and supabase_vault are platform-managed
-- and are NOT created here: a baseline that tried to install them would fail
-- on a plain PostgreSQL and would be claiming ownership of something the
-- platform owns.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;

-- ---------------------------------------------------------------------------
-- Sequences (owned by column defaults below)
-- ---------------------------------------------------------------------------
create sequence if not exists public.client_offer_request_sequence;
create sequence if not exists public.quote_request_number_seq;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  key text not null,
  value jsonb not null,
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.catalogue_conflicts (
  id uuid not null default gen_random_uuid(),
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
  status text not null default 'open'::text,
  resolution text,
  resolved_by text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.catalogue_import_rows (
  id uuid not null default gen_random_uuid(),
  import_run_id uuid not null,
  source_row integer not null,
  supplier_listing_key text,
  raw_payload jsonb not null,
  normalized_payload jsonb,
  validation_result text not null default 'pending'::text,
  validation_errors text[] not null default '{}'::text[],
  match_result text,
  matched_product_id uuid,
  matched_listing_id uuid,
  action text,
  change_set jsonb,
  review_reasons text[] not null default '{}'::text[],
  committed_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.catalogue_import_runs (
  id uuid not null default gen_random_uuid(),
  supplier_id uuid,
  adapter text not null default 'isb'::text,
  original_filename text,
  file_checksum text not null,
  file_size integer,
  storage_bucket text,
  storage_path text,
  import_mode text not null default 'partial'::text,
  status text not null default 'uploaded'::text,
  uploaded_by text,
  started_at timestamp with time zone not null default now(),
  analyzed_at timestamp with time zone,
  committed_at timestamp with time zone,
  finished_at timestamp with time zone,
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
  committed_row_count integer not null default 0,
  batch_size integer not null default 500,
  error_summary text,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.catalogue_products (
  id uuid not null default gen_random_uuid(),
  product_key text not null,
  ean text,
  ean_status text not null default 'missing'::text,
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
  weight_kg numeric(8,3),
  weight_status text not null default 'missing_or_zero'::text,
  weight_category text,
  e_mark text,
  european boolean,
  eprel_id text,
  scan_ready boolean not null default false,
  review_required boolean not null default false,
  review_reasons text[] not null default '{}'::text[],
  active boolean not null default true,
  first_seen_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.client_offer_requests (
  id uuid not null default gen_random_uuid(),
  request_number text not null default ((('GR-'::text || ((EXTRACT(year FROM now()))::integer)::text) || '-'::text) || lpad((nextval('client_offer_request_sequence'::regclass))::text, 6, '0'::text)),
  company_name text,
  contact_value text not null,
  contact_type text not null,
  delivery_preference text not null default 'any'::text,
  tyres jsonb not null,
  customer_message text,
  status text not null default 'new'::text,
  internal_notes text,
  notification_email_status text not null default 'pending'::text,
  notification_email_id text,
  notification_email_sent_at timestamp with time zone,
  notification_email_error text,
  idempotency_key text,
  source text not null default 'website'::text,
  submitted_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.customer_locations (
  id uuid not null default gen_random_uuid(),
  customer_id uuid not null,
  location_name text,
  address_line1 text not null,
  address_line2 text,
  postal_code text,
  city text not null,
  province text,
  region text,
  country_code text not null default 'IT'::text,
  contact_name text,
  phone text,
  email text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  delivery_notes text,
  opening_hours jsonb,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  recipient_name text
);

create table if not exists public.customers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  legal_name text,
  vat_number text,
  fiscal_code text,
  phone text,
  email text,
  notes text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.document_charges (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  charge_type text not null,
  description text,
  raw_description text,
  quantity numeric(10,2),
  unit_amount numeric(10,2),
  total_amount numeric(10,2),
  line_number integer,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.drivers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text,
  phone text,
  email text,
  notes text,
  auth_user_id uuid,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  current_vehicle_id uuid
);

create table if not exists public.geocode_cache (
  address_key text not null,
  address_text text not null,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.inventory_incidents (
  id uuid not null default gen_random_uuid(),
  inventory_unit_id uuid not null,
  order_id uuid,
  incident_type text not null,
  reason text,
  description text,
  reported_by uuid,
  reported_at timestamp with time zone not null default now(),
  resolved boolean not null default false,
  resolution text,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.inventory_scans (
  id uuid not null default gen_random_uuid(),
  inventory_unit_id uuid not null,
  order_id uuid,
  scan_type text not null,
  warehouse_zone_id uuid,
  scanned_by uuid,
  device_type text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  notes text,
  scanned_at timestamp with time zone not null default now(),
  order_item_id uuid,
  result text not null default 'success'::text,
  raw_value text,
  driver_id uuid,
  vehicle_id uuid,
  operator_session text,
  stand_code text,
  manual boolean not null default false,
  reason text,
  metadata jsonb,
  idempotency_key text
);

create table if not exists public.inventory_units (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  order_item_id uuid not null,
  unit_type text not null,
  unit_sequence integer,
  qr_token text not null default encode(extensions.gen_random_bytes(12), 'hex'::text),
  status text not null default 'expected'::text,
  current_zone_id uuid,
  received_at timestamp with time zone,
  stored_at timestamp with time zone,
  loaded_at timestamp with time zone,
  delivered_at timestamp with time zone,
  returned_at timestamp with time zone,
  missing_at timestamp with time zone,
  lost_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  description text,
  last_stand_code text,
  last_vehicle_id uuid,
  matched_manually boolean not null default false
);

create table if not exists public.order_documents (
  id uuid not null default gen_random_uuid(),
  order_id uuid,
  supplier_id uuid,
  source_type text not null,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  extraction_status text not null default 'pending'::text,
  extraction_confidence numeric(5,4),
  raw_extracted_data jsonb,
  customer_match_confidence numeric(5,4),
  location_match_confidence numeric(5,4),
  address_difference_detected boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  file_size integer,
  analysis_provider text,
  analysis_error text,
  analysed_at timestamp with time zone,
  uploaded_by_label text
);

create table if not exists public.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  line_number integer,
  item_type text not null default 'tyre'::text,
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
  quantity integer not null default 1,
  unit_of_measure text default 'NR'::text,
  unit_price numeric(12,2),
  discount_percent numeric(7,3),
  line_subtotal numeric(12,2),
  vat_percent numeric(5,2),
  line_total numeric(12,2),
  environmental_fee numeric(12,2),
  logistics_fee numeric(12,2),
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  description text,
  is_physical boolean not null default true,
  needs_review boolean not null default false,
  review_fields text[] not null default '{}'::text[],
  confidence numeric(4,3),
  manufacturer_code text,
  ean text,
  commercial_c boolean,
  mud_snow boolean,
  three_pmsf boolean
);

create table if not exists public.order_status_history (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  old_status text,
  new_status text not null,
  changed_by uuid,
  notes text,
  changed_at timestamp with time zone not null default now(),
  changed_by_label text
);

create table if not exists public.orders (
  id uuid not null default gen_random_uuid(),
  order_number bigint not null,
  qr_token text not null default encode(extensions.gen_random_bytes(12), 'hex'::text),
  supplier_id uuid not null,
  supplier_location_id uuid,
  customer_id uuid,
  customer_location_id uuid,
  supplier_document_number text,
  supplier_order_reference text,
  document_type text,
  document_date date,
  source_type text not null default 'manual'::text,
  delivery_name text,
  delivery_address_line1 text,
  delivery_address_line2 text,
  delivery_postal_code text,
  delivery_city text,
  delivery_province text,
  delivery_region text,
  delivery_country_code text not null default 'IT'::text,
  payment_method text,
  cash_on_delivery boolean not null default false,
  collection_method text,
  amount_to_collect numeric(12,2),
  payment_status text not null default 'unknown'::text,
  currency text not null default 'EUR'::text,
  subtotal_amount numeric(12,2),
  tax_amount numeric(12,2),
  total_amount numeric(12,2),
  carrier_name text,
  tracking_number text,
  package_count integer,
  weight_kg numeric(10,2),
  assigned_zone_id uuid,
  status text not null default 'draft'::text,
  expected_at timestamp with time zone,
  received_at timestamp with time zone,
  stored_at timestamp with time zone,
  loaded_at timestamp with time zone,
  delivered_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
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
  id uuid not null default gen_random_uuid(),
  order_id uuid,
  inventory_unit_id uuid,
  print_type text not null,
  status text not null default 'pending'::text,
  printer_name text,
  label_data jsonb,
  requested_at timestamp with time zone not null default now(),
  printed_at timestamp with time zone,
  error_message text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  claimed_by text,
  claimed_at timestamp with time zone,
  attempts integer not null default 0,
  idempotency_key text
);

create table if not exists public.product_identifiers (
  id uuid not null default gen_random_uuid(),
  catalogue_product_id uuid not null,
  identifier_type text not null,
  identifier_value text not null,
  normalized_value text not null,
  supplier_id uuid,
  validation_status text not null default 'unverified'::text,
  source text,
  first_seen_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now()
);

create table if not exists public.quote_request_events (
  id uuid not null default gen_random_uuid(),
  quote_request_id uuid,
  event_type text not null,
  meta jsonb not null default '{}'::jsonb,
  duration_ms integer,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.quote_request_items (
  id uuid not null default gen_random_uuid(),
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
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now(),
  season text
);

create table if not exists public.quote_request_reference_counter (
  day date not null,
  last_value integer not null default 0
);

create table if not exists public.quote_request_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text,
  received_at timestamp with time zone not null default now()
);

create table if not exists public.quote_requests (
  id uuid not null default gen_random_uuid(),
  request_number text not null default ('GR-'::text || (nextval('quote_request_number_seq'::regclass))::text),
  company_name text not null,
  contact_email text not null,
  whatsapp text,
  language text not null default 'it'::text,
  status text not null default 'submitted'::text,
  notification_email_sent boolean not null default false,
  notification_email_error text,
  notification_email_sent_at timestamp with time zone,
  idempotency_key text,
  source text not null default 'web'::text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  public_reference text not null,
  notes text,
  delivery_preference text,
  submitted_at timestamp with time zone default now(),
  notification_status text not null default 'pending'::text,
  notification_provider text,
  provider_message_id text,
  notification_attempts integer not null default 0,
  last_notification_attempt_at timestamp with time zone,
  notification_sent_at timestamp with time zone,
  notification_delivered_at timestamp with time zone,
  notification_failed_at timestamp with time zone,
  last_notification_error text
);

create table if not exists public.supplier_customer_refs (
  id uuid not null default gen_random_uuid(),
  supplier_id uuid not null,
  customer_id uuid not null,
  customer_location_id uuid,
  supplier_customer_code text,
  supplier_customer_name text,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.supplier_listing_prices (
  id uuid not null default gen_random_uuid(),
  supplier_listing_id uuid not null,
  purchase_price numeric(12,4),
  currency text not null default 'EUR'::text,
  stock_raw text,
  stock_exact integer,
  stock_minimum integer,
  observed_at timestamp with time zone not null default now(),
  import_run_id uuid,
  created_at timestamp with time zone not null default now()
);

create table if not exists public.supplier_locations (
  id uuid not null default gen_random_uuid(),
  supplier_id uuid not null,
  location_name text,
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  province text,
  region text,
  country_code text not null default 'IT'::text,
  phone text,
  email text,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.supplier_product_listings (
  id uuid not null default gen_random_uuid(),
  supplier_id uuid not null,
  catalogue_product_id uuid not null,
  supplier_listing_key text not null,
  supplier_article_id text not null,
  supplier_item_code text,
  source_product_key text,
  source_row integer,
  old_dot boolean not null default false,
  active boolean not null default true,
  first_seen_at timestamp with time zone not null default now(),
  last_seen_at timestamp with time zone not null default now(),
  deactivated_at timestamp with time zone,
  last_import_run_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.suppliers (
  id uuid not null default gen_random_uuid(),
  name text not null,
  legal_name text,
  vat_number text,
  fiscal_code text,
  phone text,
  email text,
  website text,
  notes text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create table if not exists public.vehicles (
  id uuid not null default gen_random_uuid(),
  name text not null,
  slug text,
  registration text,
  notes text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  capacity_units integer,
  display_order integer,
  color_key text
);

create table if not exists public.warehouse_zones (
  id uuid not null default gen_random_uuid(),
  code text not null,
  name text not null,
  zone_type text not null,
  sort_order integer,
  qr_token text not null default encode(extensions.gen_random_bytes(12), 'hex'::text),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- ---------------------------------------------------------------------------
-- Primary keys and unique constraints
-- ---------------------------------------------------------------------------
alter table public.app_settings add constraint app_settings_pkey PRIMARY KEY (key);
alter table public.catalogue_conflicts add constraint catalogue_conflicts_pkey PRIMARY KEY (id);
alter table public.catalogue_import_rows add constraint catalogue_import_rows_pkey PRIMARY KEY (id);
alter table public.catalogue_import_runs add constraint catalogue_import_runs_pkey PRIMARY KEY (id);
alter table public.catalogue_products add constraint catalogue_products_pkey PRIMARY KEY (id);
alter table public.catalogue_products add constraint catalogue_products_product_key_key UNIQUE (product_key);
alter table public.client_offer_requests add constraint client_offer_requests_idempotency_key_key UNIQUE (idempotency_key);
alter table public.client_offer_requests add constraint client_offer_requests_pkey PRIMARY KEY (id);
alter table public.client_offer_requests add constraint client_offer_requests_request_number_key UNIQUE (request_number);
alter table public.customer_locations add constraint customer_locations_pkey PRIMARY KEY (id);
alter table public.customers add constraint customers_pkey PRIMARY KEY (id);
alter table public.document_charges add constraint document_charges_pkey PRIMARY KEY (id);
alter table public.drivers add constraint drivers_pkey PRIMARY KEY (id);
alter table public.geocode_cache add constraint geocode_cache_pkey PRIMARY KEY (address_key);
alter table public.inventory_incidents add constraint inventory_incidents_pkey PRIMARY KEY (id);
alter table public.inventory_scans add constraint inventory_scans_pkey PRIMARY KEY (id);
alter table public.inventory_units add constraint inventory_units_order_item_id_unit_sequence_key UNIQUE (order_item_id, unit_sequence);
alter table public.inventory_units add constraint inventory_units_pkey PRIMARY KEY (id);
alter table public.inventory_units add constraint inventory_units_qr_token_key UNIQUE (qr_token);
alter table public.order_documents add constraint order_documents_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.order_status_history add constraint order_status_history_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_order_number_key UNIQUE (order_number);
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_qr_token_key UNIQUE (qr_token);
alter table public.print_jobs add constraint print_jobs_pkey PRIMARY KEY (id);
alter table public.product_identifiers add constraint product_identifiers_pkey PRIMARY KEY (id);
alter table public.quote_request_events add constraint quote_request_events_pkey PRIMARY KEY (id);
alter table public.quote_request_items add constraint quote_request_items_pkey PRIMARY KEY (id);
alter table public.quote_request_reference_counter add constraint quote_request_reference_counter_pkey PRIMARY KEY (day);
alter table public.quote_request_webhook_events add constraint quote_request_webhook_events_pkey PRIMARY KEY (provider, event_id);
alter table public.quote_requests add constraint quote_requests_pkey PRIMARY KEY (id);
alter table public.quote_requests add constraint quote_requests_request_number_key UNIQUE (request_number);
alter table public.supplier_customer_refs add constraint supplier_customer_refs_pkey PRIMARY KEY (id);
alter table public.supplier_customer_refs add constraint supplier_customer_refs_supplier_id_supplier_customer_code_key UNIQUE (supplier_id, supplier_customer_code);
alter table public.supplier_listing_prices add constraint supplier_listing_prices_pkey PRIMARY KEY (id);
alter table public.supplier_locations add constraint supplier_locations_pkey PRIMARY KEY (id);
alter table public.supplier_product_listings add constraint supplier_product_listings_pkey PRIMARY KEY (id);
alter table public.supplier_product_listings add constraint supplier_product_listings_supplier_listing_key_key UNIQUE (supplier_listing_key);
alter table public.suppliers add constraint suppliers_pkey PRIMARY KEY (id);
alter table public.vehicles add constraint vehicles_pkey PRIMARY KEY (id);
alter table public.warehouse_zones add constraint warehouse_zones_code_key UNIQUE (code);
alter table public.warehouse_zones add constraint warehouse_zones_pkey PRIMARY KEY (id);
alter table public.warehouse_zones add constraint warehouse_zones_qr_token_key UNIQUE (qr_token);

-- ---------------------------------------------------------------------------
-- Foreign keys (after every table, so the file has no table ordering deps)
-- ---------------------------------------------------------------------------
alter table public.catalogue_conflicts add constraint catalogue_conflicts_catalogue_product_id_fkey FOREIGN KEY (catalogue_product_id) REFERENCES catalogue_products(id) ON DELETE SET NULL;
alter table public.catalogue_conflicts add constraint catalogue_conflicts_competing_product_id_fkey FOREIGN KEY (competing_product_id) REFERENCES catalogue_products(id) ON DELETE SET NULL;
alter table public.catalogue_conflicts add constraint catalogue_conflicts_import_row_id_fkey FOREIGN KEY (import_row_id) REFERENCES catalogue_import_rows(id) ON DELETE SET NULL;
alter table public.catalogue_conflicts add constraint catalogue_conflicts_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES catalogue_import_runs(id) ON DELETE SET NULL;
alter table public.catalogue_conflicts add constraint catalogue_conflicts_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table public.catalogue_import_rows add constraint catalogue_import_rows_import_run_id_fkey FOREIGN KEY (import_run_id) REFERENCES catalogue_import_runs(id) ON DELETE CASCADE;
alter table public.catalogue_import_rows add constraint catalogue_import_rows_matched_listing_id_fkey FOREIGN KEY (matched_listing_id) REFERENCES supplier_product_listings(id) ON DELETE SET NULL;
alter table public.catalogue_import_rows add constraint catalogue_import_rows_matched_product_id_fkey FOREIGN KEY (matched_product_id) REFERENCES catalogue_products(id) ON DELETE SET NULL;
alter table public.catalogue_import_runs add constraint catalogue_import_runs_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
alter table public.customer_locations add constraint customer_locations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public.document_charges add constraint document_charges_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.drivers add constraint drivers_current_vehicle_id_fkey FOREIGN KEY (current_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
alter table public.inventory_incidents add constraint inventory_incidents_inventory_unit_id_fkey FOREIGN KEY (inventory_unit_id) REFERENCES inventory_units(id) ON DELETE CASCADE;
alter table public.inventory_incidents add constraint inventory_incidents_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.inventory_scans add constraint inventory_scans_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
alter table public.inventory_scans add constraint inventory_scans_inventory_unit_id_fkey FOREIGN KEY (inventory_unit_id) REFERENCES inventory_units(id) ON DELETE CASCADE;
alter table public.inventory_scans add constraint inventory_scans_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.inventory_scans add constraint inventory_scans_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE SET NULL;
alter table public.inventory_scans add constraint inventory_scans_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
alter table public.inventory_scans add constraint inventory_scans_warehouse_zone_id_fkey FOREIGN KEY (warehouse_zone_id) REFERENCES warehouse_zones(id) ON DELETE SET NULL;
alter table public.inventory_units add constraint inventory_units_current_zone_id_fkey FOREIGN KEY (current_zone_id) REFERENCES warehouse_zones(id) ON DELETE SET NULL;
alter table public.inventory_units add constraint inventory_units_last_vehicle_id_fkey FOREIGN KEY (last_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
alter table public.inventory_units add constraint inventory_units_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.inventory_units add constraint inventory_units_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE;
alter table public.order_documents add constraint order_documents_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_documents add constraint order_documents_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_status_history add constraint order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.orders add constraint orders_assigned_zone_id_fkey FOREIGN KEY (assigned_zone_id) REFERENCES warehouse_zones(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
alter table public.orders add constraint orders_customer_location_id_fkey FOREIGN KEY (customer_location_id) REFERENCES customer_locations(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES order_documents(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;
alter table public.orders add constraint orders_supplier_location_id_fkey FOREIGN KEY (supplier_location_id) REFERENCES supplier_locations(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
alter table public.print_jobs add constraint print_jobs_inventory_unit_id_fkey FOREIGN KEY (inventory_unit_id) REFERENCES inventory_units(id) ON DELETE CASCADE;
alter table public.print_jobs add constraint print_jobs_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.product_identifiers add constraint product_identifiers_catalogue_product_id_fkey FOREIGN KEY (catalogue_product_id) REFERENCES catalogue_products(id) ON DELETE CASCADE;
alter table public.product_identifiers add constraint product_identifiers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
alter table public.quote_request_events add constraint quote_request_events_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE;
alter table public.quote_request_items add constraint quote_request_items_quote_request_id_fkey FOREIGN KEY (quote_request_id) REFERENCES quote_requests(id) ON DELETE CASCADE;
alter table public.supplier_customer_refs add constraint supplier_customer_refs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
alter table public.supplier_customer_refs add constraint supplier_customer_refs_customer_location_id_fkey FOREIGN KEY (customer_location_id) REFERENCES customer_locations(id) ON DELETE SET NULL;
alter table public.supplier_customer_refs add constraint supplier_customer_refs_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
alter table public.supplier_listing_prices add constraint supplier_listing_prices_run_fkey FOREIGN KEY (import_run_id) REFERENCES catalogue_import_runs(id) ON DELETE SET NULL;
alter table public.supplier_listing_prices add constraint supplier_listing_prices_supplier_listing_id_fkey FOREIGN KEY (supplier_listing_id) REFERENCES supplier_product_listings(id) ON DELETE CASCADE;
alter table public.supplier_locations add constraint supplier_locations_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
alter table public.supplier_product_listings add constraint supplier_product_listings_catalogue_product_id_fkey FOREIGN KEY (catalogue_product_id) REFERENCES catalogue_products(id) ON DELETE RESTRICT;
alter table public.supplier_product_listings add constraint supplier_product_listings_last_run_fkey FOREIGN KEY (last_import_run_id) REFERENCES catalogue_import_runs(id) ON DELETE SET NULL;
alter table public.supplier_product_listings add constraint supplier_product_listings_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- Indexes not already created by a constraint
-- ---------------------------------------------------------------------------
-- NOTE: orders carries two overlapping partial unique indexes on the
-- supplier document number -- orders_supplier_doc_number_key on
-- (supplier_id, normalized_document_number) and orders_supplier_document_unique
-- on (supplier_id, supplier_document_number). Both are reproduced because both
-- exist in production. See docs/SCHEMA_RECONCILIATION_REPORT.md section 8.
CREATE INDEX catalogue_conflicts_open_idx ON public.catalogue_conflicts USING btree (status, created_at DESC);
CREATE INDEX catalogue_conflicts_run_idx ON public.catalogue_conflicts USING btree (import_run_id);
CREATE INDEX catalogue_import_rows_run_action_idx ON public.catalogue_import_rows USING btree (import_run_id, action);
CREATE UNIQUE INDEX catalogue_import_rows_run_row_uidx ON public.catalogue_import_rows USING btree (import_run_id, source_row);
CREATE INDEX catalogue_import_rows_run_validation_idx ON public.catalogue_import_rows USING btree (import_run_id, validation_result);
CREATE UNIQUE INDEX catalogue_import_runs_checksum_uidx ON public.catalogue_import_runs USING btree (supplier_id, adapter, file_checksum) WHERE (status = 'committed'::text);
CREATE INDEX catalogue_import_runs_recent_idx ON public.catalogue_import_runs USING btree (created_at DESC);
CREATE INDEX catalogue_import_runs_status_idx ON public.catalogue_import_runs USING btree (status);
CREATE INDEX catalogue_products_brand_idx ON public.catalogue_products USING btree (brand);
CREATE INDEX catalogue_products_ean_idx ON public.catalogue_products USING btree (ean) WHERE (ean IS NOT NULL);
CREATE INDEX catalogue_products_last_seen_idx ON public.catalogue_products USING btree (last_seen_at DESC);
CREATE INDEX catalogue_products_mfr_code_idx ON public.catalogue_products USING btree (manufacturer_product_code) WHERE (manufacturer_product_code IS NOT NULL);
CREATE INDEX catalogue_products_review_idx ON public.catalogue_products USING btree (review_required) WHERE (review_required = true);
CREATE INDEX catalogue_products_size_idx ON public.catalogue_products USING btree (width_mm, aspect_ratio, rim_inch, season);
CREATE UNIQUE INDEX catalogue_products_validated_ean_uidx ON public.catalogue_products USING btree (ean) WHERE ((ean IS NOT NULL) AND (ean_status = ANY (ARRAY['valid'::text, 'recovered_leading_zero'::text])));
CREATE INDEX client_offer_requests_company_name_idx ON public.client_offer_requests USING btree (company_name);
CREATE INDEX client_offer_requests_contact_value_idx ON public.client_offer_requests USING btree (contact_value);
CREATE INDEX client_offer_requests_created_at_idx ON public.client_offer_requests USING btree (created_at DESC);
CREATE INDEX client_offer_requests_request_number_idx ON public.client_offer_requests USING btree (request_number);
CREATE INDEX client_offer_requests_status_idx ON public.client_offer_requests USING btree (status);
CREATE INDEX client_offer_requests_tyres_gin_idx ON public.client_offer_requests USING gin (tyres);
CREATE INDEX customer_locations_city_idx ON public.customer_locations USING btree (lower(city));
CREATE INDEX customer_locations_customer_idx ON public.customer_locations USING btree (customer_id);
CREATE INDEX customers_fiscal_code_idx ON public.customers USING btree (fiscal_code);
CREATE INDEX customers_name_idx ON public.customers USING btree (lower(name));
CREATE INDEX customers_vat_idx ON public.customers USING btree (vat_number);
CREATE INDEX document_charges_order_idx ON public.document_charges USING btree (order_id);
CREATE INDEX drivers_active_idx ON public.drivers USING btree (active);
CREATE UNIQUE INDEX drivers_auth_user_id_key ON public.drivers USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);
CREATE UNIQUE INDEX drivers_slug_key ON public.drivers USING btree (slug) WHERE (slug IS NOT NULL);
CREATE INDEX inventory_incidents_open_idx ON public.inventory_incidents USING btree (resolved) WHERE (resolved = false);
CREATE INDEX inventory_incidents_type_idx ON public.inventory_incidents USING btree (incident_type);
CREATE INDEX inventory_incidents_unit_idx ON public.inventory_incidents USING btree (inventory_unit_id);
CREATE UNIQUE INDEX inventory_scans_idempotency_key ON public.inventory_scans USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX inventory_scans_order_idx ON public.inventory_scans USING btree (order_id);
CREATE INDEX inventory_scans_time_idx ON public.inventory_scans USING btree (scanned_at DESC);
CREATE INDEX inventory_scans_unit_idx ON public.inventory_scans USING btree (inventory_unit_id);
CREATE INDEX inventory_units_current_zone_idx ON public.inventory_units USING btree (current_zone_id);
CREATE INDEX inventory_units_item_status_idx ON public.inventory_units USING btree (order_item_id, status);
CREATE INDEX inventory_units_order_idx ON public.inventory_units USING btree (order_id);
CREATE INDEX inventory_units_order_item_idx ON public.inventory_units USING btree (order_item_id);
CREATE INDEX inventory_units_order_status_idx ON public.inventory_units USING btree (order_id, status);
CREATE INDEX inventory_units_qr_idx ON public.inventory_units USING btree (qr_token);
CREATE INDEX inventory_units_status_idx ON public.inventory_units USING btree (status);
CREATE INDEX order_documents_created_at_idx ON public.order_documents USING btree (created_at DESC);
CREATE INDEX order_documents_order_idx ON public.order_documents USING btree (order_id);
CREATE INDEX order_items_brand_idx ON public.order_items USING btree (lower(brand));
CREATE INDEX order_items_order_idx ON public.order_items USING btree (order_id);
CREATE INDEX order_items_physical_idx ON public.order_items USING btree (order_id, is_physical);
CREATE INDEX order_items_supplier_sku_idx ON public.order_items USING btree (supplier_sku);
CREATE INDEX order_items_tyre_size_idx ON public.order_items USING btree (width, aspect_ratio, rim_diameter);
CREATE INDEX order_status_history_order_idx ON public.order_status_history USING btree (order_id);
CREATE INDEX order_status_history_time_idx ON public.order_status_history USING btree (changed_at DESC);
CREATE INDEX orders_assigned_zone_idx ON public.orders USING btree (assigned_zone_id);
CREATE INDEX orders_customer_idx ON public.orders USING btree (customer_id);
CREATE INDEX orders_customer_location_idx ON public.orders USING btree (customer_location_id);
CREATE INDEX orders_document_date_idx ON public.orders USING btree (document_date);
CREATE INDEX orders_driver_idx ON public.orders USING btree (driver_id);
CREATE INDEX orders_fingerprint_idx ON public.orders USING btree (fingerprint) WHERE (fingerprint IS NOT NULL);
CREATE INDEX orders_planned_delivery_date_idx ON public.orders USING btree (planned_delivery_date);
CREATE INDEX orders_source_hash_idx ON public.orders USING btree (source_hash) WHERE (source_hash IS NOT NULL);
CREATE INDEX orders_status_idx ON public.orders USING btree (status);
CREATE UNIQUE INDEX orders_supplier_doc_number_key ON public.orders USING btree (supplier_id, normalized_document_number) WHERE (normalized_document_number IS NOT NULL);
CREATE UNIQUE INDEX orders_supplier_document_unique ON public.orders USING btree (supplier_id, supplier_document_number) WHERE (supplier_document_number IS NOT NULL);
CREATE INDEX orders_supplier_idx ON public.orders USING btree (supplier_id);
CREATE INDEX orders_vehicle_idx ON public.orders USING btree (vehicle_id);
CREATE INDEX orders_vehicle_sequence_idx ON public.orders USING btree (vehicle_id, delivery_sequence);
CREATE UNIQUE INDEX print_jobs_idempotency_key ON public.print_jobs USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE UNIQUE INDEX print_jobs_open_unit_key ON public.print_jobs USING btree (inventory_unit_id) WHERE ((inventory_unit_id IS NOT NULL) AND (status = ANY (ARRAY['pending'::text, 'processing'::text])));
CREATE INDEX print_jobs_order_idx ON public.print_jobs USING btree (order_id);
CREATE INDEX print_jobs_status_created_idx ON public.print_jobs USING btree (status, created_at);
CREATE INDEX print_jobs_status_idx ON public.print_jobs USING btree (status);
CREATE INDEX product_identifiers_lookup_idx ON public.product_identifiers USING btree (normalized_value, identifier_type);
CREATE UNIQUE INDEX product_identifiers_unique_idx ON public.product_identifiers USING btree (catalogue_product_id, identifier_type, normalized_value, COALESCE(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX quote_request_events_request_idx ON public.quote_request_events USING btree (quote_request_id, created_at DESC);
CREATE INDEX quote_request_events_type_time_idx ON public.quote_request_events USING btree (event_type, created_at DESC);
CREATE INDEX quote_request_items_request_idx ON public.quote_request_items USING btree (quote_request_id, sort_order);
CREATE INDEX quote_requests_company_lower_idx ON public.quote_requests USING btree (lower(company_name) text_pattern_ops);
CREATE INDEX quote_requests_created_at_idx ON public.quote_requests USING btree (created_at DESC);
CREATE INDEX quote_requests_email_lower_idx ON public.quote_requests USING btree (lower(contact_email) text_pattern_ops);
CREATE UNIQUE INDEX quote_requests_idempotency_key_idx ON public.quote_requests USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX quote_requests_notification_status_idx ON public.quote_requests USING btree (notification_status);
CREATE UNIQUE INDEX quote_requests_public_reference_idx ON public.quote_requests USING btree (public_reference);
CREATE INDEX quote_requests_request_number_idx ON public.quote_requests USING btree (request_number);
CREATE INDEX quote_requests_status_created_idx ON public.quote_requests USING btree (status, created_at DESC);
CREATE INDEX quote_requests_status_idx ON public.quote_requests USING btree (status);
CREATE INDEX supplier_listing_prices_listing_idx ON public.supplier_listing_prices USING btree (supplier_listing_id, observed_at DESC);
CREATE INDEX supplier_locations_supplier_idx ON public.supplier_locations USING btree (supplier_id);
CREATE INDEX supplier_product_listings_last_seen_idx ON public.supplier_product_listings USING btree (supplier_id, last_seen_at DESC);
CREATE INDEX supplier_product_listings_product_idx ON public.supplier_product_listings USING btree (catalogue_product_id);
CREATE INDEX supplier_product_listings_supplier_active_idx ON public.supplier_product_listings USING btree (supplier_id, active);
CREATE UNIQUE INDEX supplier_product_listings_supplier_article_uidx ON public.supplier_product_listings USING btree (supplier_id, supplier_article_id);
CREATE INDEX suppliers_name_idx ON public.suppliers USING btree (lower(name));
CREATE INDEX suppliers_vat_idx ON public.suppliers USING btree (vat_number);
CREATE INDEX vehicles_active_idx ON public.vehicles USING btree (active);
CREATE INDEX vehicles_display_order_idx ON public.vehicles USING btree (display_order);
CREATE UNIQUE INDEX vehicles_slug_key ON public.vehicles USING btree (slug) WHERE (slug IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- RLS enabled on every table, with NO policies. Deliberate: the anon key
-- can reach nothing, and all access goes through server-side code using
-- the service-role key. Production has 32/32 tables with RLS and 0 policies.
alter table public.app_settings enable row level security;
alter table public.catalogue_conflicts enable row level security;
alter table public.catalogue_import_rows enable row level security;
alter table public.catalogue_import_runs enable row level security;
alter table public.catalogue_products enable row level security;
alter table public.client_offer_requests enable row level security;
alter table public.customer_locations enable row level security;
alter table public.customers enable row level security;
alter table public.document_charges enable row level security;
alter table public.drivers enable row level security;
alter table public.geocode_cache enable row level security;
alter table public.inventory_incidents enable row level security;
alter table public.inventory_scans enable row level security;
alter table public.inventory_units enable row level security;
alter table public.order_documents enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;
alter table public.orders enable row level security;
alter table public.print_jobs enable row level security;
alter table public.product_identifiers enable row level security;
alter table public.quote_request_events enable row level security;
alter table public.quote_request_items enable row level security;
alter table public.quote_request_reference_counter enable row level security;
alter table public.quote_request_webhook_events enable row level security;
alter table public.quote_requests enable row level security;
alter table public.supplier_customer_refs enable row level security;
alter table public.supplier_listing_prices enable row level security;
alter table public.supplier_locations enable row level security;
alter table public.supplier_product_listings enable row level security;
alter table public.suppliers enable row level security;
alter table public.vehicles enable row level security;
alter table public.warehouse_zones enable row level security;

-- CHECK constraints live in 0002, after the functions: one of them
-- (valid_client_offer_request_tyres) calls is_valid_tyre_request().
