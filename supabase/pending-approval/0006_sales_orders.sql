-- M13 customer sales orders — PENDING APPROVAL, NOT APPLIED.
-- Separate commercial sale from existing logistics public.orders.
create sequence if not exists public.sales_order_number_seq start with 1000;

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null default nextval('public.sales_order_number_seq'),
  customer_id uuid not null references public.customers(id),
  customer_location_id uuid references public.customer_locations(id),
  source text not null default 'portal' check (source in ('portal','admin','whatsapp','email','phone','quote')),
  status text not null default 'requested' check (status in ('requested','confirmed','rejected','cancelled')),
  fulfilment_class text not null default 'standard' check (fulfilment_class in ('standard','express')),
  payment_method text not null check (payment_method in ('bank_transfer','pos_on_delivery','cash')),
  currency text not null default 'EUR',
  monetary_status text not null default 'pending_pfu' check (monetary_status in ('complete','pending_pfu','pending_tax_policy')),
  tyre_net_total_cents bigint,
  pfu_total_cents bigint,
  vat_total_cents bigint,
  grand_total_cents bigint,
  delivery_snapshot jsonb not null,
  customer_note text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_number)
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
  price_observed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(sales_order_id,line_number)
);

create index if not exists sales_orders_customer_created_idx on public.sales_orders(customer_id, created_at desc);
create index if not exists sales_orders_status_created_idx on public.sales_orders(status, created_at);
create index if not exists sales_order_items_order_idx on public.sales_order_items(sales_order_id);
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
-- No browser policies: portal access is server-side after customer session resolution.
