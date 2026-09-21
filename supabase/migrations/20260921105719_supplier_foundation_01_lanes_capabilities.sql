-- Phase 1 / part 1: supplier lane identity, explicit capabilities, commercial rules.
-- Additive only. No existing column is dropped or retyped.
set search_path = "$user", public, extensions;

-- ---------------------------------------------------------------------------
-- Lane identity on the existing suppliers table.
-- suppliers currently mixes sourcing lanes with logistics-only counterparties
-- (hauliers, consignors). is_sourcing_lane separates the two WITHOUT deleting
-- or merging any existing row.
-- ---------------------------------------------------------------------------
alter table public.suppliers add column if not exists lane_code text;
alter table public.suppliers add column if not exists integration_type text;
alter table public.suppliers add column if not exists is_sourcing_lane boolean not null default false;
alter table public.suppliers add column if not exists default_lead_time_days integer;
alter table public.suppliers add column if not exists delivery_class text;
alter table public.suppliers add column if not exists price_ttl_hours integer;
alter table public.suppliers add column if not exists stock_ttl_hours integer;
alter table public.suppliers add column if not exists stale_multiplier numeric(4,2) not null default 2.00;

create unique index if not exists suppliers_lane_code_uidx
  on public.suppliers (lane_code) where lane_code is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='suppliers_integration_type_chk') then
    alter table public.suppliers add constraint suppliers_integration_type_chk
      check (integration_type is null or integration_type = any (array['manual','file_import','ftp_feed','api']));
  end if;
  if not exists (select 1 from pg_constraint where conname='suppliers_delivery_class_chk') then
    alter table public.suppliers add constraint suppliers_delivery_class_chk
      check (delivery_class is null or delivery_class = any (array['24h','48h','5_7d','unknown']));
  end if;
  if not exists (select 1 from pg_constraint where conname='suppliers_sourcing_lane_chk') then
    alter table public.suppliers add constraint suppliers_sourcing_lane_chk
      check (is_sourcing_lane = false or (lane_code is not null and integration_type is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname='suppliers_ttl_positive_chk') then
    alter table public.suppliers add constraint suppliers_ttl_positive_chk
      check ((price_ttl_hours is null or price_ttl_hours > 0)
         and (stock_ttl_hours is null or stock_ttl_hours > 0)
         and stale_multiplier > 0);
  end if;
end $$;

comment on column public.suppliers.lane_code is
  'Stable internal sourcing-lane code (intersprint|deldo|it_48h). NULL for logistics-only counterparties.';
comment on column public.suppliers.is_sourcing_lane is
  'True only for suppliers GommaRush can source stock from. Logistics-only counterparties stay false.';
comment on column public.suppliers.price_ttl_hours is
  'Freshness budget for a price observation. NULL means freshness is UNKNOWN - never assumed fresh.';

-- ---------------------------------------------------------------------------
-- Explicit capabilities. ABSENCE MEANS UNAVAILABLE.
--
-- supplier_capabilities_no_ordering_chk makes enabling supplier ordering
-- structurally impossible at the database level, not merely a convention: no
-- row may ever carry enabled=true for production_ordering or test_ordering.
-- Enabling supplier ordering is an OWNER_DECISION and would require dropping
-- this constraint deliberately.
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_capabilities (
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  capability text not null,
  enabled boolean not null default false,
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (supplier_id, capability),
  constraint supplier_capabilities_known_chk check (capability = any (array[
    'catalogue_feed','price_feed','stock_feed','live_stock_lookup','live_price_lookup',
    'test_ordering','production_ordering','order_status','delivery_documents','invoices'])),
  constraint supplier_capabilities_no_ordering_chk check (
    not (enabled = true and capability = any (array['production_ordering','test_ordering'])))
);

create index if not exists supplier_capabilities_enabled_idx
  on public.supplier_capabilities (capability) where enabled = true;

drop trigger if exists supplier_capabilities_set_updated_at on public.supplier_capabilities;
create trigger supplier_capabilities_set_updated_at
  before update on public.supplier_capabilities
  for each row execute function set_updated_at();

alter table public.supplier_capabilities enable row level security;

comment on table public.supplier_capabilities is
  'Explicit per-lane capabilities. An absent row means UNAVAILABLE - never infer a capability from the existence of an integration. supplier_capabilities_no_ordering_chk makes enabling supplier ordering structurally impossible in V1.';

-- ---------------------------------------------------------------------------
-- Commercial rules, so supplier terms live in data rather than scattered
-- hard-coded checks (docs/architecture/02_SUPPLIER_RULES.md).
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_commercial_rules (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  rule_type text not null,
  scope text not null default 'all',
  numeric_value numeric(14,4),
  currency text,
  source_note text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_commercial_rules_type_chk check (rule_type = any (array[
    'min_order_qty','prepayment_required','balance_gated'])),
  constraint supplier_commercial_rules_scope_chk check (scope = any (array['all','pcr','truck']))
);

alter table public.supplier_commercial_rules enable row level security;
create index if not exists supplier_commercial_rules_supplier_idx
  on public.supplier_commercial_rules (supplier_id, rule_type);

drop trigger if exists supplier_commercial_rules_set_updated_at on public.supplier_commercial_rules;
create trigger supplier_commercial_rules_set_updated_at
  before update on public.supplier_commercial_rules
  for each row execute function set_updated_at();

comment on table public.supplier_commercial_rules is
  'Supplier commercial terms as data (minimum order quantities, prepayment/balance gating). Read by sourcing, never by an adapter.';
