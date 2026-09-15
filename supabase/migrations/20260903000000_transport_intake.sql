-- Transport-only document intake: ingestion records, an immutable event log,
-- quantity reconciliation, and the inbound leg as its own axis.
--
-- Forward-only and additive. Nothing is dropped, no existing row is rewritten,
-- and no historical order is reclassified.
--
-- Independent of 20260901000000 and 20260902000000, which remain unapplied by
-- deliberate decision. Nothing here references document_analyses.
--
-- ===========================================================================
-- SAFETY FINDINGS FROM INSPECTING THE LIVE SCHEMA FIRST
-- ===========================================================================
--
-- 1. orders.status is NOT touched. Its CHECK already holds the seventeen
--    values the depot/loading/delivery axis needs, and the inbound leg gets
--    its own column instead. `expected` already means "awaiting arrival at
--    the warehouse", which is true for the whole inbound leg, so this
--    feature adds no status values at all.
--
-- 2. DUPLICATE PROTECTION ALREADY EXISTS AT THE DATABASE LEVEL. Two unique
--    indexes on orders both enforce distributor + document number:
--       orders_supplier_doc_number_key  (supplier_id, normalized_document_number)
--       orders_supplier_document_unique (supplier_id, supplier_document_number)
--    They are redundant with each other, but they are live and they are
--    pre-existing. No third index is created here. Those indexes ARE the
--    final transactional duplicate check: a second concurrent confirmation
--    of the same DDT fails on a unique violation inside the transaction,
--    which is exactly the guarantee required.
--
-- 3. orders.payment_status already has a CHECK with the values
--    ('unknown','not_required','pending','collected','paid','failed').
--    That vocabulary maps cleanly onto the new operational statuses, so it
--    is reused rather than replaced -- the driver app keeps reading the
--    column it already reads.
--
-- 4. orders.source_type has a CHECK of ('pdf','image','manual','email').
--    Pasted text is none of those. Recording it as 'manual' would be false
--    (the data was machine-extracted) and 'pdf' would be false (there was no
--    file). The value is widened through the project's own
--    gorush_widen_value_check helper, which merges the existing constraint
--    values with the values actually present in data before rebuilding the
--    CHECK, so no live row can be invalidated.
--
-- 5. orders.amount_to_collect is numeric and nullable, so it already
--    supports the three-state money semantics: a positive number, a
--    deliberate 0, or NULL for "collection does not apply". Reused as-is.
--
-- 6. orders_source_hash_idx already exists on orders(source_hash). Not
--    recreated.

-- ---------------------------------------------------------------------------
-- 0. Prerequisites
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'MIGRATION_PREREQUISITE_MISSING: public.orders does not exist';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'gorush_widen_value_check'
  ) then
    raise exception 'MIGRATION_PREREQUISITE_MISSING: gorush_widen_value_check() is required to widen source_type safely';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Business type
-- ---------------------------------------------------------------------------
-- The commercial discriminator. Set at creation, never inferred from a
-- supplier name -- the same company could one day be both a transport client
-- and a goods supplier, so the TRANSACTION carries the type, not the party.
--
-- No default and no backfill. Historical orders stay NULL rather than being
-- guessed; classifying them is a separate, deliberate decision.
alter table public.orders add column if not exists business_type text;

alter table public.orders drop constraint if exists orders_business_type_chk;
alter table public.orders
  add constraint orders_business_type_chk
  check (business_type is null or business_type in ('TRANSPORT_JOB', 'OWN_SALE'));

create index if not exists orders_business_type_idx
  on public.orders (business_type) where business_type is not null;

comment on column public.orders.business_type is
  'TRANSPORT_JOB: we carry goods a distributor sold to its own customer; no GommaRush sale exists. OWN_SALE: GommaRush bought and sold the goods. NULL on historical rows, never guessed.';

-- ---------------------------------------------------------------------------
-- 2. The inbound axis
-- ---------------------------------------------------------------------------
-- Kept separate from orders.status on purpose: how goods reach our depot and
-- what has happened to them since are two concurrent facts, and the delivery
-- board, driver app and status RPCs have no business knowing about a pickup
-- leg.
--
-- Defaults to 'not_required', which makes every existing row and every
-- non-transport order correct with no backfill.
alter table public.orders add column if not exists inbound_status text not null default 'not_required';

alter table public.orders drop constraint if exists orders_inbound_status_chk;
alter table public.orders
  add constraint orders_inbound_status_chk
  check (inbound_status in (
    'not_required',
    'awaiting_pickup',
    'pickup_assigned',
    'picked_up',
    'in_transit_to_depot',
    'supplier_delivery_expected',
    'arrived_at_depot',
    'inbound_exception'
  ));

alter table public.orders add column if not exists inbound_method text;

alter table public.orders drop constraint if exists orders_inbound_method_chk;
alter table public.orders
  add constraint orders_inbound_method_chk
  check (inbound_method is null or inbound_method in (
    'GORUSH_PICKUP', 'SUPPLIER_DELIVERY_TO_DEPOT', 'THIRD_PARTY_CARRIER', 'UNKNOWN'
  ));

-- Pickup detail. Address is stored flat rather than as an FK: the distributor
-- warehouse a consignment is collected from is a fact about the document, and
-- may not correspond to any supplier_locations row we hold.
alter table public.orders add column if not exists pickup_company text;
alter table public.orders add column if not exists pickup_address text;
alter table public.orders add column if not exists requested_pickup_date date;
alter table public.orders add column if not exists requested_pickup_window text;
alter table public.orders add column if not exists pickup_vehicle_id uuid references public.vehicles(id) on delete set null;
alter table public.orders add column if not exists pickup_driver_id uuid references public.drivers(id) on delete set null;
alter table public.orders add column if not exists picked_up_at timestamptz;
alter table public.orders add column if not exists arrived_at_depot_at timestamptz;
alter table public.orders add column if not exists inbound_exception_reason text;

-- Partial index: the operations board asks "what do we owe an action on?",
-- which is a small slice of a growing table.
create index if not exists orders_inbound_action_idx
  on public.orders (inbound_status, requested_pickup_date)
  where inbound_status in ('awaiting_pickup', 'pickup_assigned', 'inbound_exception');

comment on column public.orders.inbound_status is
  'How the goods reach our depot. Independent of orders.status, which continues to represent depot, loading and delivery progress. not_required for orders with no inbound leg.';

-- ---------------------------------------------------------------------------
-- 3. Operational payment status
-- ---------------------------------------------------------------------------
-- The existing payment_status ('unknown','not_required','pending',...) tells
-- the driver app what to do. This column records the OPERATIONAL reading of
-- the document, which carries a distinction payment_status cannot:
-- "no collection required" and "already paid" are different facts, and a
-- deferred bank term means the first, never the second.
alter table public.orders add column if not exists payment_operational_status text;

alter table public.orders drop constraint if exists orders_payment_operational_status_chk;
alter table public.orders
  add constraint orders_payment_operational_status_chk
  check (payment_operational_status is null or payment_operational_status in (
    'COLLECT_CASH', 'COLLECT_OTHER', 'NO_COLLECTION_REQUIRED',
    'ALREADY_PAID_EXPLICIT', 'UNKNOWN_REVIEW_REQUIRED'
  ));

-- The verbatim terms and the substring that justified the reading, so a
-- disputed collection instruction can be traced to the document.
alter table public.orders add column if not exists payment_printed_terms text;
alter table public.orders add column if not exists payment_evidence text;

-- A job whose payment status is unresolved must not reach a driver.
create index if not exists orders_payment_review_idx
  on public.orders (payment_operational_status)
  where payment_operational_status = 'UNKNOWN_REVIEW_REQUIRED';

comment on column public.orders.payment_operational_status is
  'Operational reading of the printed payment terms. NO_COLLECTION_REQUIRED means the carrier collects nothing; it does NOT assert the invoice is paid. UNKNOWN_REVIEW_REQUIRED blocks dispatch.';

comment on column public.orders.amount_to_collect is
  'Three distinct states: a positive number to collect, 0 for a deliberate zero collection, NULL when collection does not apply or was not specified. A document total must never be written here.';

-- ---------------------------------------------------------------------------
-- 4. Widen source_type for pasted text
-- ---------------------------------------------------------------------------
-- Via the project's own helper, which merges the existing constraint values
-- and the values present in data with these before rebuilding the CHECK.
select public.gorush_widen_value_check(
  'orders', 'source_type', 'orders_source_type_check',
  array['paste', 'transport_intake']
);

-- ---------------------------------------------------------------------------
-- 5. transport_document_ingestions
-- ---------------------------------------------------------------------------
-- One row per pasted or uploaded transport document. The AI produces a draft
-- here; only an operator confirmation creates orders.
create table if not exists public.transport_document_ingestions (
  id uuid primary key default gen_random_uuid(),

  -- Channel. One canonical service serves all of them.
  source_type text not null,
  -- Stable id within that channel: an email message-id, an FTP filename.
  source_reference text,

  -- Present for uploads, null for pasted text.
  original_file_path text,
  original_file_bucket text,

  -- The pasted text itself, kept privately so an extraction can be replayed
  -- and an operator correction can be audited against what was actually read.
  source_text text,
  -- SHA-256 of the NORMALISED text (whitespace collapsed, case folded), so
  -- the same document copied twice hashes identically.
  source_sha256 text,

  status text not null default 'uploaded',

  distributor_id uuid references public.suppliers(id) on delete set null,
  document_number text,
  normalized_document_number text,
  document_date date,

  provider text,
  provider_model text,
  provider_request_id text,
  schema_version text,
  prompt_version text,
  used_escalation_model boolean not null default false,
  input_tokens integer,
  output_tokens integer,

  raw_provider_response jsonb,
  extracted_data jsonb,
  normalized_data jsonb,
  validation_result jsonb,
  -- What the operator changed before confirming, for the correction-rate
  -- metrics the rollout plan depends on.
  operator_corrections jsonb,

  created_delivery_count integer not null default 0,
  created_order_ids uuid[] not null default '{}',

  error_code text,
  error_message text,
  attempt_count integer not null default 0,
  warnings text[] not null default '{}',

  correlation_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table public.transport_document_ingestions
  drop constraint if exists transport_ingestions_status_chk;
alter table public.transport_document_ingestions
  add constraint transport_ingestions_status_chk
  check (status in (
    'uploaded', 'extracting', 'extracted', 'needs_review', 'ready_to_create',
    'deliveries_created', 'partially_created', 'failed', 'rejected'
  ));

alter table public.transport_document_ingestions
  drop constraint if exists transport_ingestions_source_type_chk;
alter table public.transport_document_ingestions
  add constraint transport_ingestions_source_type_chk
  check (source_type in ('PASTED_TEXT', 'PDF_UPLOAD', 'EMAIL_ATTACHMENT', 'MANUAL_LIST'));

-- Duplicate signals. These are INDEXES, not unique constraints: a possible
-- duplicate must be shown to an operator with its matching signals and a
-- choice, never silently rejected. The only hard uniqueness is the
-- pre-existing pair on orders, which fires inside the confirm transaction.
create index if not exists transport_ingestions_sha_idx
  on public.transport_document_ingestions (source_sha256) where source_sha256 is not null;
create index if not exists transport_ingestions_docnum_idx
  on public.transport_document_ingestions (distributor_id, normalized_document_number)
  where normalized_document_number is not null;
create index if not exists transport_ingestions_source_ref_idx
  on public.transport_document_ingestions (source_type, source_reference)
  where source_reference is not null;
create index if not exists transport_ingestions_status_idx
  on public.transport_document_ingestions (status, created_at desc);

drop trigger if exists transport_ingestions_set_updated_at on public.transport_document_ingestions;
create trigger transport_ingestions_set_updated_at
  before update on public.transport_document_ingestions
  for each row execute function public.set_updated_at();

alter table public.transport_document_ingestions enable row level security;

comment on table public.transport_document_ingestions is
  'One transport document received through any channel. Holds the raw provider response, the normalized draft and the operator corrections. Orders are created only by an explicit confirmation.';

-- ---------------------------------------------------------------------------
-- 6. transport_events
-- ---------------------------------------------------------------------------
-- The immutable operational log. order_status_history already records status
-- changes, but it carries only old/new status, an actor label and a note.
-- This table records the things history must not be inferred from: who acted
-- and in what capacity, which van, which zone, where, and what happened to
-- the money.
--
-- Deliberately append-only. No update trigger, and no UPDATE path in the
-- application: an event that can be edited is not evidence.
create table if not exists public.transport_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  ingestion_id uuid references public.transport_document_ingestions(id) on delete set null,

  event_kind text not null,

  -- Either axis may move, or neither.
  previous_status text,
  new_status text,
  previous_inbound_status text,
  new_inbound_status text,

  actor_type text not null,
  actor_label text,

  vehicle_id uuid references public.vehicles(id) on delete set null,
  driver_id uuid references public.drivers(id) on delete set null,
  zone_id uuid references public.warehouse_zones(id) on delete set null,

  latitude numeric(9,6),
  longitude numeric(9,6),

  -- Payment outcome, when this event is a collection.
  payment_amount_expected numeric(10,2),
  payment_amount_collected numeric(10,2),
  payment_method text,
  payment_outcome text,

  notes text,
  exception_reason text,
  metadata jsonb,

  created_at timestamptz not null default now()
);

alter table public.transport_events drop constraint if exists transport_events_kind_chk;
alter table public.transport_events
  add constraint transport_events_kind_chk
  check (event_kind in (
    'INGESTION_CONFIRMED', 'ORDER_STATUS_CHANGED', 'INBOUND_STATUS_CHANGED',
    'PICKUP_ASSIGNED', 'ARRIVAL_RECORDED', 'QUANTITY_RECONCILED',
    'ZONE_ASSIGNED', 'VEHICLE_ASSIGNED', 'PAYMENT_COLLECTED',
    'DELIVERY_FAILED', 'EXCEPTION_RAISED', 'NOTE_ADDED'
  ));

alter table public.transport_events drop constraint if exists transport_events_actor_chk;
alter table public.transport_events
  add constraint transport_events_actor_chk
  check (actor_type in ('OPERATOR', 'DRIVER', 'SYSTEM', 'WAREHOUSE'));

alter table public.transport_events drop constraint if exists transport_events_payment_outcome_chk;
alter table public.transport_events
  add constraint transport_events_payment_outcome_chk
  check (payment_outcome is null or payment_outcome in (
    'COLLECTED_IN_FULL', 'PARTIALLY_COLLECTED', 'NOT_COLLECTED',
    'CUSTOMER_REFUSED', 'PAYMENT_ISSUE'
  ));

create index if not exists transport_events_order_idx
  on public.transport_events (order_id, created_at desc);
create index if not exists transport_events_ingestion_idx
  on public.transport_events (ingestion_id) where ingestion_id is not null;
create index if not exists transport_events_kind_idx
  on public.transport_events (event_kind, created_at desc);

alter table public.transport_events enable row level security;

comment on table public.transport_events is
  'Append-only operational log for a transport job. Records actor capacity, van, zone, GPS and payment outcome, none of which can be inferred from the current status. No UPDATE path exists: an event that can be edited is not evidence.';

-- ---------------------------------------------------------------------------
-- 7. transport_quantity_reconciliations
-- ---------------------------------------------------------------------------
-- What the document said, what actually arrived, and the difference.
--
-- The expected quantity on the order is NEVER rewritten to match reality.
-- Overwriting it would erase the discrepancy, and the discrepancy is the
-- thing the distributor needs to be told about. The order keeps the
-- document's number; this table records what was counted.
create table if not exists public.transport_quantity_reconciliations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,

  expected_tyres integer,
  actual_tyres integer,
  expected_packages integer,
  actual_packages integer,

  -- Generated, so it can never drift from its operands.
  tyre_difference integer generated always as (coalesce(actual_tyres, 0) - coalesce(expected_tyres, 0)) stored,

  discrepancy_type text,
  reason text,

  zone_id uuid references public.warehouse_zones(id) on delete set null,

  resolved boolean not null default false,
  resolution text,
  resolved_by text,
  resolved_at timestamptz,

  recorded_by text,
  created_at timestamptz not null default now()
);

alter table public.transport_quantity_reconciliations
  drop constraint if exists transport_qty_discrepancy_chk;
alter table public.transport_quantity_reconciliations
  add constraint transport_qty_discrepancy_chk
  check (discrepancy_type is null or discrepancy_type in (
    'MATCH', 'SHORTAGE', 'EXCESS', 'DAMAGED', 'MIXED'
  ));

-- An unresolved mismatch must stay visible until someone closes it.
create index if not exists transport_qty_unresolved_idx
  on public.transport_quantity_reconciliations (order_id)
  where resolved = false;

alter table public.transport_quantity_reconciliations enable row level security;

comment on table public.transport_quantity_reconciliations is
  'Expected versus actual counts at depot arrival. The order keeps the document''s expected quantity; this records what was counted and stays unresolved until someone closes it.';

-- ---------------------------------------------------------------------------
-- 8. Link orders back to their ingestion
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists transport_ingestion_id uuid
  references public.transport_document_ingestions(id) on delete set null;

create index if not exists orders_transport_ingestion_idx
  on public.orders (transport_ingestion_id) where transport_ingestion_id is not null;

comment on column public.orders.transport_ingestion_id is
  'The intake record that created this job. Gives every order a path back to the original document text and the extraction that produced it.';
