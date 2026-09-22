-- M12 customer-account identity foundation.
-- Maps Supabase Auth identities to existing customer companies.
-- No customer is inferred from email: every binding is explicit and admin-controlled.

create table if not exists public.customer_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  customer_id uuid not null references public.customers(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_accounts_customer_id_idx
  on public.customer_accounts(customer_id)
  where active = true;

alter table public.customer_accounts enable row level security;

-- Intentionally no browser-facing policies. Portal server code resolves the
-- authenticated user then reads through the server-only admin client.
-- This keeps customer/company binding out of client-controlled queries.
