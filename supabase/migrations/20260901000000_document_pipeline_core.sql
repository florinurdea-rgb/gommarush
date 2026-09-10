-- ============================================================================
-- Document pipeline: order type, server-side analyses, source-line audit,
-- party memory, idempotency
-- ============================================================================
-- Forward-only. Adds tables and columns; changes no existing data except
-- where explicitly noted. Nothing here is destructive.
--
-- The five problems this schema exists to make structurally impossible:
--
--   1. An order whose type (transport job vs own sale) is assumed rather
--      than confirmed. Purchase prices and transport revenue mean opposite
--      things in the two cases, so guessing wrong misprices the business.
--   2. An extracted source line that silently disappears. Every line now has
--      a row and exactly one recorded outcome.
--   3. A confirmation the browser decides. The analysis is persisted
--      server-side and versioned, so confirm re-derives from stored truth.
--   4. The same file imported twice. source_hash is unique per document.
--   5. Re-answering "which supplier / which delivery point" on every
--      document from the same issuer.
--
-- ROLLBACK NOTE: forward-only by convention. To undo, a later migration
-- should drop the tables added here in reverse dependency order
-- (document_import_idempotency, document_extracted_lines,
-- document_party_mappings, document_analyses) and drop the orders /
-- order_documents columns. No existing column is altered destructively, so
-- an un-deployed rollback loses only data created by this feature.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Order type
-- ---------------------------------------------------------------------------
-- TRANSPORT_JOB = Trasporto per conto terzi. GommaRush moves someone else's
--   goods. Document product totals are NOT GommaRush revenue; transport
--   revenue comes from the configured rate.
-- OWN_SALE      = Vendita GommaRush. We bought and are selling. Document
--   values are supplier COST, never the customer selling price.
--
-- Deliberately NOT backfilled. Every existing order predates the
-- distinction, and inferring it from data that never encoded it would
-- silently assert a commercial fact. confirmed_order_type stays NULL and the
-- UI treats that as "needs correction".
alter table public.orders add column if not exists suggested_order_type text;
alter table public.orders add column if not exists confirmed_order_type text;
alter table public.orders add column if not exists order_type_detection_source text;
alter table public.orders add column if not exists order_type_confidence numeric(4,3);
alter table public.orders add column if not exists order_type_confirmed_by text;
alter table public.orders add column if not exists order_type_confirmed_at timestamptz;

alter table public.orders drop constraint if exists orders_suggested_order_type_chk;
alter table public.orders
  add constraint orders_suggested_order_type_chk
  check (suggested_order_type is null or suggested_order_type in ('TRANSPORT_JOB', 'OWN_SALE'));

alter table public.orders drop constraint if exists orders_confirmed_order_type_chk;
alter table public.orders
  add constraint orders_confirmed_order_type_chk
  check (confirmed_order_type is null or confirmed_order_type in ('TRANSPORT_JOB', 'OWN_SALE'));

alter table public.orders drop constraint if exists orders_order_type_source_chk;
alter table public.orders
  add constraint orders_order_type_source_chk
  check (order_type_detection_source is null or order_type_detection_source in (
    'APPROVED_MAPPING',      -- a previously confirmed pattern for this issuer
    'DOCUMENT_EVIDENCE',     -- explicit wording on the document
    'RELATIONSHIP_CONFIG',   -- supplier/customer relationship setup
    'OPERATOR',              -- a human chose it
    'LEGACY_UNKNOWN'         -- predates the distinction
  ));

-- A confirmed type must record who confirmed it: an unattributed commercial
-- classification is not auditable.
alter table public.orders drop constraint if exists orders_order_type_attribution_chk;
alter table public.orders
  add constraint orders_order_type_attribution_chk
  check (confirmed_order_type is null or order_type_confirmed_by is not null);

comment on column public.orders.confirmed_order_type is
  'TRANSPORT_JOB (Trasporto per conto terzi) or OWN_SALE (Vendita GommaRush). NULL means unconfirmed — never treat NULL as either.';
comment on column public.orders.suggested_order_type is
  'What detection proposed. Never authoritative on its own: AI or heuristic confidence must not make an ambiguous order auto-confirmable.';

-- Supplier cost, kept apart from any customer selling price. For OWN_SALE a
-- supplier document gives us cost; for TRANSPORT_JOB it gives us the value of
-- goods we are merely moving. Neither is revenue.
alter table public.orders add column if not exists supplier_cost_total_cents bigint;
alter table public.orders add column if not exists document_total_cents bigint;
alter table public.orders add column if not exists document_currency text;
alter table public.orders add column if not exists transport_rate_rule text;

comment on column public.orders.supplier_cost_total_cents is
  'What the supplier document says WE pay, in integer cents. Never a customer selling price.';
comment on column public.orders.document_total_cents is
  'The document own stated total, in integer cents, for reconciliation only.';

-- ---------------------------------------------------------------------------
-- 2. order_documents: file identity and honest upload metadata
-- ---------------------------------------------------------------------------
-- source_hash is the SHA-256 of the ORIGINAL uploaded bytes. The filename is
-- never document identity — the same file arrives under a dozen names.
alter table public.order_documents add column if not exists source_hash text;
alter table public.order_documents add column if not exists detected_mime_type text;
alter table public.order_documents add column if not exists reported_mime_type text;
alter table public.order_documents add column if not exists actual_file_size bigint;
alter table public.order_documents add column if not exists page_count integer;
alter table public.order_documents add column if not exists upload_status text;

alter table public.order_documents drop constraint if exists order_documents_upload_status_chk;
alter table public.order_documents
  add constraint order_documents_upload_status_chk
  check (upload_status is null or upload_status in ('UPLOADED', 'REJECTED', 'ANALYZED', 'FAILED'));

-- The real file-level dedup guarantee. Partial so historical rows (NULL) do
-- not collide, and unique so two concurrent uploads of one file cannot both
-- proceed — the loser gets a constraint violation and recovers the winner.
create unique index if not exists order_documents_source_hash_key
  on public.order_documents (source_hash)
  where source_hash is not null;

comment on column public.order_documents.source_hash is
  'SHA-256 of the original uploaded bytes. The file identity — never the filename.';
comment on column public.order_documents.detected_mime_type is
  'MIME determined server-side from magic bytes. reported_mime_type is what the browser claimed and is not trusted.';

-- ---------------------------------------------------------------------------
-- 3. document_analyses — the server-side, immutable, versioned analysis
-- ---------------------------------------------------------------------------
-- Confirmation must not trust the browser. The analysis lives here; the
-- client receives a read-only projection and sends back only an id, a
-- version and operator decisions.
create table if not exists public.document_analyses (
  id uuid primary key default gen_random_uuid(),
  source_document_id uuid not null references public.order_documents(id) on delete cascade,
  source_hash text,

  status text not null default 'UPLOADED',

  -- Optimistic concurrency: confirm sends the version it saw. A stale version
  -- is rejected rather than applied to changed data.
  version integer not null default 1,

  -- Provenance, so a disputed extraction can be reproduced exactly.
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  validator_version text,

  raw_extraction jsonb,
  normalized_extraction jsonb,

  source_document_count integer not null default 0,
  page_count integer,

  attempts integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,

  correlation_id text,
  warnings text[] not null default '{}',
  error_summary text,

  latency_ms integer,
  input_tokens integer,
  output_tokens integer,

  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.document_analyses drop constraint if exists document_analyses_status_chk;
alter table public.document_analyses
  add constraint document_analyses_status_chk
  check (status in (
    'UPLOADED', 'QUEUED', 'EXTRACTING', 'EXTRACTED', 'VALIDATING',
    'READY', 'NEEDS_REVIEW', 'DUPLICATE', 'FAILED',
    'IMPORTING', 'IMPORTED', 'CANCELLED'
  ));

create index if not exists document_analyses_document_idx
  on public.document_analyses (source_document_id);
create index if not exists document_analyses_status_idx
  on public.document_analyses (status, created_at desc);
create index if not exists document_analyses_hash_idx
  on public.document_analyses (source_hash) where source_hash is not null;
-- Finds analyses stuck in a non-terminal state, for the admin retry view.
create index if not exists document_analyses_stuck_idx
  on public.document_analyses (status, updated_at)
  where status in ('QUEUED', 'EXTRACTING', 'VALIDATING', 'IMPORTING');

drop trigger if exists document_analyses_set_updated_at on public.document_analyses;
create trigger document_analyses_set_updated_at before update on public.document_analyses
  for each row execute function public.set_updated_at();

alter table public.document_analyses enable row level security;

comment on table public.document_analyses is
  'The authoritative analysis of one uploaded document. Confirmation re-derives from this row, never from the browser payload.';

-- ---------------------------------------------------------------------------
-- 4. document_extracted_lines — every source line, and what became of it
-- ---------------------------------------------------------------------------
-- The invariant this table enforces:
--   sourceLineCount = orderItems + charges + textNotes + excluded + unresolved
-- A line with no outcome is UNRESOLVED and blocks import. Nothing vanishes.
create table if not exists public.document_extracted_lines (
  id uuid primary key default gen_random_uuid(),
  document_analysis_id uuid not null references public.document_analyses(id) on delete cascade,

  source_document_index integer not null default 0,
  source_page integer,
  source_line_index integer not null,

  -- May be NULL: a line the model returned without readable text still gets a
  -- row. Discarding the object because one field was missing is exactly how
  -- lines used to disappear.
  raw_description text,
  raw_values_json jsonb,
  normalized_values_json jsonb,

  ai_item_type_hint text,
  deterministic_classification text,
  final_classification text,
  classification_source text,
  classification_override_by text,
  classification_override_reason text,

  field_confidences_json jsonb,
  validation_status text not null default 'PENDING',
  validation_issues_json jsonb,

  resolution_action text not null default 'UNRESOLVED',
  included_in_order boolean not null default false,
  order_item_id uuid references public.order_items(id) on delete set null,
  document_charge_id uuid,

  excluded_by text,
  excluded_at timestamptz,
  exclusion_reason text,

  created_at timestamptz not null default now()
);

alter table public.document_extracted_lines drop constraint if exists document_extracted_lines_resolution_chk;
alter table public.document_extracted_lines
  add constraint document_extracted_lines_resolution_chk
  check (resolution_action in (
    'ORDER_ITEM', 'DOCUMENT_CHARGE', 'TEXT_NOTE', 'EXPLICITLY_EXCLUDED', 'UNRESOLVED'
  ));

alter table public.document_extracted_lines drop constraint if exists document_extracted_lines_validation_chk;
alter table public.document_extracted_lines
  add constraint document_extracted_lines_validation_chk
  check (validation_status in ('PENDING', 'VALID', 'REVIEW', 'BLOCKING'));

alter table public.document_extracted_lines drop constraint if exists document_extracted_lines_classification_source_chk;
alter table public.document_extracted_lines
  add constraint document_extracted_lines_classification_source_chk
  check (classification_source is null or classification_source in (
    'DETERMINISTIC_TEXT', 'CATALOGUE_MATCH', 'AI_HINT', 'SUPPLIER_RULE', 'OPERATOR'
  ));

-- An exclusion is only ever an explicit operator act, and it must say why.
-- Without this a line could be dropped with no attribution and no reason,
-- which is indistinguishable from the silent loss this table prevents.
alter table public.document_extracted_lines drop constraint if exists document_extracted_lines_exclusion_chk;
alter table public.document_extracted_lines
  add constraint document_extracted_lines_exclusion_chk
  check (
    resolution_action <> 'EXPLICITLY_EXCLUDED'
    or (excluded_by is not null and exclusion_reason is not null and length(trim(exclusion_reason)) > 0)
  );

create unique index if not exists document_extracted_lines_unique_idx
  on public.document_extracted_lines (document_analysis_id, source_document_index, source_line_index);
create index if not exists document_extracted_lines_analysis_idx
  on public.document_extracted_lines (document_analysis_id, resolution_action);
create index if not exists document_extracted_lines_order_item_idx
  on public.document_extracted_lines (order_item_id) where order_item_id is not null;

alter table public.document_extracted_lines enable row level security;

comment on table public.document_extracted_lines is
  'One row per extracted source line, with exactly one recorded outcome. Enforces that no line silently disappears between extraction and order.';

-- ---------------------------------------------------------------------------
-- 5. document_party_mappings — remembered supplier / delivery decisions
-- ---------------------------------------------------------------------------
-- Learned ONLY from a confirmed import or an explicit admin save. An
-- abandoned analysis teaches nothing, and "use for this order only" creates
-- no mapping at all.
create table if not exists public.document_party_mappings (
  id uuid primary key default gen_random_uuid(),

  -- Which issuer's documents this mapping applies to. NULL = issuer-agnostic.
  document_issuer_supplier_id uuid references public.suppliers(id) on delete cascade,
  order_type text,
  mapping_role text not null,

  -- Normalized lookup keys. Structured, not free text, so a materially
  -- different postcode or VAT number cannot match by accident.
  raw_party_identifier_key text,
  raw_company_name_key text,
  raw_vat_key text,
  raw_supplier_customer_code_key text,
  raw_address_key text,
  raw_postal_code text,
  raw_city_key text,

  resolved_company_id uuid,
  resolved_location_id uuid,
  resolved_order_type text,

  approved boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  disabled boolean not null default false,
  disabled_by text,
  disabled_reason text,

  use_count integer not null default 0,
  last_used_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.document_party_mappings drop constraint if exists document_party_mappings_role_chk;
alter table public.document_party_mappings
  add constraint document_party_mappings_role_chk
  check (mapping_role in (
    'SUPPLIER', 'CONTRACTING_COMPANY', 'PICKUP_POINT',
    'DELIVERY_CUSTOMER', 'DELIVERY_POINT', 'BILLING_CUSTOMER', 'ORDER_TYPE'
  ));

alter table public.document_party_mappings drop constraint if exists document_party_mappings_order_type_chk;
alter table public.document_party_mappings
  add constraint document_party_mappings_order_type_chk
  check (
    (order_type is null or order_type in ('TRANSPORT_JOB', 'OWN_SALE'))
    and (resolved_order_type is null or resolved_order_type in ('TRANSPORT_JOB', 'OWN_SALE'))
  );

-- An approved mapping is the only kind allowed to preselect automatically, so
-- approval must be attributable.
alter table public.document_party_mappings drop constraint if exists document_party_mappings_approval_chk;
alter table public.document_party_mappings
  add constraint document_party_mappings_approval_chk
  check (approved = false or approved_by is not null);

-- An ORDER_TYPE mapping resolves a type; every other role resolves a company.
alter table public.document_party_mappings drop constraint if exists document_party_mappings_resolution_chk;
alter table public.document_party_mappings
  add constraint document_party_mappings_resolution_chk
  check (
    (mapping_role = 'ORDER_TYPE' and resolved_order_type is not null)
    or (mapping_role <> 'ORDER_TYPE' and resolved_company_id is not null)
  );

-- One approved mapping per (issuer, role, identity). Partial on approved so a
-- rejected or superseded suggestion does not block a later correct one.
create unique index if not exists document_party_mappings_identity_key
  on public.document_party_mappings (
    coalesce(document_issuer_supplier_id, '00000000-0000-0000-0000-000000000000'::uuid),
    mapping_role,
    coalesce(raw_vat_key, ''),
    coalesce(raw_supplier_customer_code_key, ''),
    coalesce(raw_company_name_key, ''),
    coalesce(raw_address_key, '')
  )
  where approved = true and disabled = false;

create index if not exists document_party_mappings_lookup_idx
  on public.document_party_mappings (document_issuer_supplier_id, mapping_role, approved, disabled);
create index if not exists document_party_mappings_vat_idx
  on public.document_party_mappings (raw_vat_key) where raw_vat_key is not null;
create index if not exists document_party_mappings_name_idx
  on public.document_party_mappings (raw_company_name_key) where raw_company_name_key is not null;

drop trigger if exists document_party_mappings_set_updated_at on public.document_party_mappings;
create trigger document_party_mappings_set_updated_at before update on public.document_party_mappings
  for each row execute function public.set_updated_at();

alter table public.document_party_mappings enable row level security;

comment on table public.document_party_mappings is
  'Remembered supplier / delivery-point decisions per document issuer. Only approved, non-disabled rows may preselect, and only a confirmed import or explicit admin save creates one.';

-- ---------------------------------------------------------------------------
-- 6. document_import_idempotency
-- ---------------------------------------------------------------------------
-- A retried confirm must return the original order, not create a second one.
create table if not exists public.document_import_idempotency (
  idempotency_key text primary key,
  document_analysis_id uuid references public.document_analyses(id) on delete cascade,
  source_document_index integer,
  order_id uuid references public.orders(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists document_import_idempotency_analysis_idx
  on public.document_import_idempotency (document_analysis_id);

alter table public.document_import_idempotency enable row level security;

comment on table public.document_import_idempotency is
  'Confirm is idempotent on this key: a replay returns the recorded order instead of creating another.';

-- ---------------------------------------------------------------------------
-- 7. document_charges: make charge writes idempotent
-- ---------------------------------------------------------------------------
-- Charges were inserted after the order transaction with the error only
-- logged, so an order could exist with its PFU/fee lines missing. With this
-- index the write becomes an upsert, safe to repeat from the retry path.
create unique index if not exists document_charges_order_line_key
  on public.document_charges (order_id, line_number)
  where line_number is not null;

alter table public.document_charges add column if not exists extracted_line_id uuid;
alter table public.document_charges add column if not exists total_amount_cents bigint;
alter table public.document_charges add column if not exists unit_amount_cents bigint;

comment on column public.document_charges.total_amount_cents is
  'Integer cents. The numeric columns remain for compatibility; money arithmetic uses these.';

-- ---------------------------------------------------------------------------
-- 8. Duplicate-detection indexes
-- ---------------------------------------------------------------------------
-- Near-duplicate search was capped at the most recent 2000 orders in
-- application code. These indexes let it be a bounded database query over the
-- whole history instead.
create index if not exists orders_dup_candidate_idx
  on public.orders (supplier_id, document_date);
create index if not exists orders_customer_date_idx
  on public.orders (customer_id, document_date);
