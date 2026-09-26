-- M13 customer sales orders — PENDING APPROVAL, NOT APPLIED.
--
-- Separates a COMMERCIAL SALE by GommaRush from the existing logistics
-- public.orders, which is a transport job and frequently concerns goods
-- GommaRush never owned. One table cannot carry both without making transport
-- revenue indistinguishable from product margin.
--
-- Nothing here commits GommaRush to a supplier. An order arrives as
-- 'requested' and waits for a human.

create sequence if not exists public.sales_order_number_seq start with 1000;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null default nextval('public.sales_order_number_seq'),
  customer_id uuid not null references public.customers(id),
  customer_location_id uuid references public.customer_locations(id),
  idempotency_key text not null,
  customer_snapshot jsonb not null,
  source text not null default 'portal' check (source in ('portal','admin','whatsapp','email','phone','quote')),
  status text not null default 'requested' check (status in ('requested','confirmed','rejected','cancelled')),
  fulfilment_class text not null default 'standard' check (fulfilment_class in ('standard','express')),
  -- V1 payment methods, owner-confirmed 2026-09-23. POS on delivery is
  -- deliberately absent: it is not an approved settlement channel, and the
  -- constraint is what stops it being written by a path that bypasses the app.
  payment_method text not null check (payment_method in ('bank_transfer','cash_on_delivery')),
  currency text not null default 'EUR',
  monetary_status text not null default 'pending_pfu' check (monetary_status in ('complete','pending_pfu','pending_tax_policy')),
  tyre_net_total_cents bigint,
  pfu_total_cents bigint,
  vat_total_cents bigint,
  grand_total_cents bigint,

  -- THE PFU PROVENANCE OF THIS ORDER, as first-class columns rather than
  -- buried in pricing_snapshot.
  --
  -- Why columns: the question "which orders were priced with the temporary
  -- estimate, and under which version of it?" has to be answerable with a
  -- WHERE clause the day a real tariff arrives. Digging it out of jsonb on
  -- every row is the kind of thing that does not get done.
  --
  -- An order NEVER has these rewritten. A later verified tariff changes what
  -- NEW orders are charged; it does not reach back and restate what this
  -- customer was quoted.
  pfu_status text not null default 'TO_CONFIRM'
    check (pfu_status in ('SUPPLIER_EXACT','RULE_CALCULATED','MANUAL_CONFIRMED','ESTIMATED','TO_CONFIRM')),
  pfu_estimate_version text,
  vat_rate_percent numeric(5,2),
  /** The delivery promise made at the time, in days. A commitment, not a date. */
  delivery_promise_max_days integer,

  -- An estimated PFU must always name the rule that produced it.
  constraint sales_orders_estimated_pfu_has_version check (
    pfu_status <> 'ESTIMATED' or pfu_estimate_version is not null
  ),
  -- ...and a non-estimated one must not pretend it was estimated.
  constraint sales_orders_version_only_for_estimates check (
    pfu_status = 'ESTIMATED' or pfu_estimate_version is null
  ),
  delivery_snapshot jsonb not null,
  pricing_snapshot jsonb not null,
  customer_note text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_number),

  -- Idempotency is scoped TO THE CUSTOMER, matching how the application looks
  -- an order up. A globally unique key would let one customer's client-chosen
  -- key collide with another's and fail that customer's checkout, while the
  -- customer-scoped lookup would not even find the row that caused it.
  constraint sales_orders_customer_idempotency_key unique (customer_id, idempotency_key),

  -- A 'complete' order states a final amount, so it must actually carry one.
  -- This is the database-level half of the PRICING_NOT_FINAL gate: it makes a
  -- falsely final total unrepresentable rather than merely unwritten.
  constraint sales_orders_complete_has_totals check (
    monetary_status <> 'complete'
    or (tyre_net_total_cents is not null
        and pfu_total_cents is not null
        and vat_total_cents is not null
        and grand_total_cents is not null)
  )
);

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  line_number integer not null,
  catalogue_product_id uuid not null references public.catalogue_products(id),
  -- Internal reproducibility/sourcing hint only. Never customer-facing.
  source_listing_id uuid references public.supplier_product_listings(id),
  quantity integer not null check (quantity > 0),
  tyre_snapshot jsonb not null,
  condition_snapshot text not null default 'normal' check (condition_snapshot in ('normal','older_dot')),
  unit_tyre_net_cents bigint,
  unit_pfu_cents bigint,
  unit_vat_cents bigint,
  unit_total_cents bigint,
  pricing_status text not null check (pricing_status in ('complete','pending_pfu','pending_tax_policy','unavailable')),
  -- Per line, because two lines of one order can have different PFU
  -- provenance: one tyre may carry a supplier-stated figure while another
  -- falls back to the estimate.
  pfu_status text not null default 'TO_CONFIRM'
    check (pfu_status in ('SUPPLIER_EXACT','RULE_CALCULATED','MANUAL_CONFIRMED','ESTIMATED','TO_CONFIRM')),
  pfu_estimate_version text,
  vat_rate_percent numeric(5,2),
  price_observed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (sales_order_id, line_number),

  constraint sales_order_items_estimated_pfu_has_version check (
    pfu_status <> 'ESTIMATED' or pfu_estimate_version is not null
  )
);

create index if not exists sales_orders_customer_created_idx on public.sales_orders(customer_id, created_at desc);
create index if not exists sales_orders_status_created_idx on public.sales_orders(status, created_at);
create index if not exists sales_order_items_order_idx on public.sales_order_items(sales_order_id);
-- Answers "which orders still rest on an estimate?" directly.
create index if not exists sales_orders_pfu_status_idx
  on public.sales_orders(pfu_status, created_at desc)
  where pfu_status = 'ESTIMATED';

alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
-- No browser policies, deliberately. RLS with no policy denies anon and
-- authenticated outright; the portal reads and writes server-side through the
-- service role AFTER resolving the customer session, so company binding is
-- never a client-controlled query parameter.

-- ---------------------------------------------------------------------------
-- Atomic order creation
-- ---------------------------------------------------------------------------

-- WHY AN RPC AND NOT TWO INSERTS. PostgREST gives each statement its own
-- transaction, so "insert the header, then insert the items" can leave a header
-- with a grand total and NO LINES — an order that reaches the operator's
-- confirmation inbox looking real. A compensating delete does not fix it: the
-- case that produces it is the process dying between the two statements, which
-- is exactly when the compensation does not run.
--
-- A function body is one transaction. Either the order and every line exist, or
-- nothing does.
create or replace function public.create_portal_sales_order(
  p_customer_id uuid,
  p_customer_location_id uuid,
  p_idempotency_key text,
  p_customer_snapshot jsonb,
  p_delivery_snapshot jsonb,
  p_pricing_snapshot jsonb,
  p_fulfilment_class text,
  p_payment_method text,
  p_currency text,
  p_monetary_status text,
  p_tyre_net_total_cents bigint,
  p_pfu_total_cents bigint,
  p_vat_total_cents bigint,
  p_grand_total_cents bigint,
  p_customer_note text,
  p_pfu_status text,
  p_pfu_estimate_version text,
  p_vat_rate_percent numeric,
  p_delivery_promise_max_days integer,
  p_items jsonb
)
returns table (id uuid, order_number bigint, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_status text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'SALES_ORDER_NO_ITEMS' using errcode = 'check_violation';
  end if;

  -- Returning the existing order rather than raising lets a retry carrying the
  -- same key succeed idempotently instead of failing the customer's second
  -- click. The unique constraint still guarantees only one row exists.
  select so.id, so.order_number, so.status
    into v_order_id, v_order_number, v_status
    from public.sales_orders so
   where so.customer_id = p_customer_id
     and so.idempotency_key = p_idempotency_key;

  if found then
    return query select v_order_id, v_order_number, v_status;
    return;
  end if;

  insert into public.sales_orders (
    customer_id, customer_location_id, idempotency_key,
    customer_snapshot, delivery_snapshot, pricing_snapshot,
    source, status, fulfilment_class, payment_method, currency, monetary_status,
    tyre_net_total_cents, pfu_total_cents, vat_total_cents, grand_total_cents,
    pfu_status, pfu_estimate_version, vat_rate_percent, delivery_promise_max_days,
    customer_note, requested_at
  ) values (
    p_customer_id, p_customer_location_id, p_idempotency_key,
    p_customer_snapshot, p_delivery_snapshot, p_pricing_snapshot,
    'portal', 'requested', p_fulfilment_class, p_payment_method, p_currency, p_monetary_status,
    p_tyre_net_total_cents, p_pfu_total_cents, p_vat_total_cents, p_grand_total_cents,
    coalesce(p_pfu_status,'TO_CONFIRM'), p_pfu_estimate_version, p_vat_rate_percent,
    p_delivery_promise_max_days,
    p_customer_note, now()
  )
  returning sales_orders.id, sales_orders.order_number, sales_orders.status
       into v_order_id, v_order_number, v_status;

  insert into public.sales_order_items (
    sales_order_id, line_number, catalogue_product_id, source_listing_id, quantity,
    tyre_snapshot, condition_snapshot,
    unit_tyre_net_cents, unit_pfu_cents, unit_vat_cents, unit_total_cents,
    pricing_status, pfu_status, pfu_estimate_version, vat_rate_percent, price_observed_at
  )
  select
    v_order_id,
    (item->>'line_number')::integer,
    (item->>'catalogue_product_id')::uuid,
    nullif(item->>'source_listing_id','')::uuid,
    (item->>'quantity')::integer,
    item->'tyre_snapshot',
    item->>'condition_snapshot',
    (item->>'unit_tyre_net_cents')::bigint,
    (item->>'unit_pfu_cents')::bigint,
    (item->>'unit_vat_cents')::bigint,
    (item->>'unit_total_cents')::bigint,
    item->>'pricing_status',
    coalesce(item->>'pfu_status','TO_CONFIRM'),
    nullif(item->>'pfu_estimate_version',''),
    nullif(item->>'vat_rate_percent','')::numeric,
    nullif(item->>'price_observed_at','')::timestamptz
  from jsonb_array_elements(p_items) as item;

  return query select v_order_id, v_order_number, v_status;
end;
$$;

-- The portal calls this as the service role only. No browser role is granted
-- execute, so the function cannot be used to write an order for a customer the
-- caller is not bound to.
revoke all on function public.create_portal_sales_order(
  uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text,
  bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb
) from public;

-- anon/authenticated exist on Supabase but not on a plain PostgreSQL used to
-- verify this file, so the grant is withdrawn only where the role is defined.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.create_portal_sales_order(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text, bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.create_portal_sales_order(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text, bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb) from authenticated';
  end if;
end $$;
