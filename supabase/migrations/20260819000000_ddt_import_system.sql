-- ---------------------------------------------------------------------------
-- DDT/invoice import system — Phase 1: deterministic core schema
-- ---------------------------------------------------------------------------
-- Additive only, same posture as every prior migration in this project.
--
-- This extends the EXISTING orders/order_items tables rather than creating
-- parallel ones — those already exist and are load-bearing for the whole
-- logistics system (stands, driver loading, print labels, the vehicle
-- board). "orders", "order_items" in the DDT-import spec map onto them.
--
-- Genuinely new: document_charges (PFU/logistics/transport/discount lines —
-- kept for audit, never turned into order_items/inventory), and
-- app_settings (so transport_rate_per_tyre can change without a redeploy).
--
-- Deliberately NOT included here: a document_imports table for multi-DDT
-- upload tracking. The existing order_documents table already covers
-- per-file storage + AI extraction bookkeeping for the current
-- one-document-per-upload flow; multi-document-per-PDF tracking needs
-- designing against the actual extraction pipeline (Phase 2), not
-- speculatively now.

-- ---------------------------------------------------------------------------
-- orders: DDT-import fields
-- ---------------------------------------------------------------------------
-- supplier_document_number (existing column) IS the DDT/document number —
-- the spec's primary logistics identifier. normalized_document_number is
-- its dedup-safe form (trimmed/upper/whitespace-collapsed) — see
-- normaliseDocumentNumber() in src/lib/logistics/ddt-dedup.ts.
alter table public.orders add column if not exists normalized_document_number text;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists giro text;
alter table public.orders add column if not exists agent text;
alter table public.orders add column if not exists carrier text;

-- Distinct from the existing cash_on_delivery flag: these capture WHICH
-- payment instruction the document gave ("CASH AUTISTA" vs "CONTRASSEGNO
-- ASSEGNO" are different obligations), never inferred — see
-- detectPaymentSignals() in src/lib/logistics/ddt-payment.ts.
alter table public.orders add column if not exists cash_required boolean;
alter table public.orders add column if not exists cheque_required boolean;

-- THE most important pair of fields in this system (spec §11/§40): computed
-- in code from classified order_items, never trusted as an AI-reported sum.
-- See calculateTyreCount()/calculatePhysicalItemCount() in
-- src/lib/logistics/ddt-calculations.ts.
alter table public.orders add column if not exists tyre_count integer;
alter table public.orders add column if not exists physical_item_count integer;

-- The rate is looked up from app_settings at order-creation time and frozen
-- here, so a later rate change never rewrites historical revenue.
alter table public.orders add column if not exists transport_rate_snapshot numeric(10,2);
alter table public.orders add column if not exists transport_revenue numeric(10,2);

alter table public.orders add column if not exists source_hash text;
alter table public.orders add column if not exists fingerprint text;
alter table public.orders add column if not exists extraction_confidence numeric(4,3);

-- THE duplicate-prevention guarantee (spec §15): the same supplier can never
-- have two orders with the same normalized DDT number. Partial index (only
-- when the number is known) — a null document number is "unidentified", not
-- "duplicate of every other unidentified order".
create unique index if not exists orders_supplier_doc_number_key
  on public.orders(supplier_id, normalized_document_number)
  where normalized_document_number is not null;

create index if not exists orders_fingerprint_idx on public.orders(fingerprint) where fingerprint is not null;
create index if not exists orders_source_hash_idx on public.orders(source_hash) where source_hash is not null;

-- ---------------------------------------------------------------------------
-- order_items: additional structured tyre fields
-- ---------------------------------------------------------------------------
-- brand/model/width/aspect_ratio/rim_diameter/load_index/speed_rating/
-- extra_load(XL)/run_flat/season already exist from Phase 1. Adding the
-- remaining fields this spec calls for.
alter table public.order_items add column if not exists manufacturer_code text;
alter table public.order_items add column if not exists ean text;
alter table public.order_items add column if not exists commercial_c boolean;
alter table public.order_items add column if not exists mud_snow boolean;
alter table public.order_items add column if not exists three_pmsf boolean;

-- ---------------------------------------------------------------------------
-- document_charges: non-physical lines, kept for audit — never order_items
-- ---------------------------------------------------------------------------
-- The whole point of this table (spec §9/§10): a PFU/logistics/transport/
-- discount/VAT line is real money on the document and worth keeping for
-- financial audit, but it is NEVER a physical object — it must never
-- reach order_items, inventory_units, stands, or a printed label.
create table if not exists public.document_charges (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  charge_type text not null check (
    charge_type in ('PFU', 'LOGISTICS_FEE', 'TRANSPORT_FEE', 'DISCOUNT', 'VAT', 'OTHER_FEE')
  ),
  description text,
  raw_description text,
  quantity numeric(10, 2),
  unit_amount numeric(10, 2),
  total_amount numeric(10, 2),
  line_number integer,
  created_at timestamptz not null default now()
);

create index if not exists document_charges_order_idx on public.document_charges(order_id);

-- ---------------------------------------------------------------------------
-- app_settings: small key/value store
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value)
values ('transport_rate_per_tyre', '2.00')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security — same posture as every table in this project: RLS ON,
-- no policies, all access via the service-role key server-side.
-- ---------------------------------------------------------------------------
alter table public.document_charges enable row level security;
alter table public.app_settings enable row level security;
