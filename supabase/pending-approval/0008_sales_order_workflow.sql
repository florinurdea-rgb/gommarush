-- 0008 — SALES-ORDER WORKFLOW — PENDING APPROVAL, NOT APPLIED.
--
-- Run manually, as one script, in the production Supabase SQL Editor.
-- Requires 0005 + 0006 (verified present on production 2026-09-25).
--
-- WHAT IT ADDS
--   * status 'pending_payment' on sales_orders (after 'confirmed');
--   * pending_payment_at, status_note (reason for a rejection/cancellation),
--     status_changed_by (operator's auth user id);
--   * sales_order_status_history — one row per operator transition;
--   * transition_sales_order(...) — the ONLY write path for a status change:
--     it checks the move against the allowed table, requires a note for
--     rejected/cancelled, compare-and-sets on the CURRENT status (two
--     operators cannot both move one order), stamps the matching timestamp
--     and writes the history row, all in one transaction.
--
-- The allowed moves mirror src/lib/commerce/sales-order-status.ts:
--   requested       -> confirmed | rejected | cancelled
--   confirmed       -> pending_payment | cancelled
--   pending_payment -> cancelled
--
-- WHAT IT NEVER DOES
--   No row of any existing table is inserted, updated or deleted. Existing
--   statuses stay valid (the new CHECK is a superset). Nothing touches
--   catalogue, supplier, pricing, logistics, driver or auth data. Nothing can
--   contact a supplier: 'confirmed' is GommaRush accepting the order, not a
--   purchase.
--
-- FAILURE BEHAVIOUR
--   One transaction. Any failed assertion raises; PostgreSQL then turns the
--   final COMMIT into a ROLLBACK and nothing is kept. Safe to run twice.

begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PRE-FLIGHT
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.sales_orders') is null or to_regclass('public.sales_order_items') is null then
    raise exception 'PREFLIGHT: 0006 is not applied (sales_orders missing)';
  end if;
  if exists (
    select 1 from public.sales_orders
     where status not in ('requested','confirmed','pending_payment','rejected','cancelled')
  ) then
    raise exception 'PREFLIGHT: sales_orders holds a status outside the new set - review before continuing';
  end if;
end $$;

create temp table gr_0008_before on commit drop as
select 'sales_orders' t, count(*) n from public.sales_orders
union all select 'sales_order_items', count(*) from public.sales_order_items
union all select 'customers', count(*) from public.customers
union all select 'orders', count(*) from public.orders
union all select 'catalogue_products', count(*) from public.catalogue_products;

-- ---------------------------------------------------------------------------
-- 2. SCHEMA
-- ---------------------------------------------------------------------------
alter table public.sales_orders drop constraint if exists sales_orders_status_check;
alter table public.sales_orders add constraint sales_orders_status_check
  check (status in ('requested','confirmed','pending_payment','rejected','cancelled'));

alter table public.sales_orders add column if not exists pending_payment_at timestamptz;
alter table public.sales_orders add column if not exists status_note text;
alter table public.sales_orders add column if not exists status_changed_by uuid;

create table if not exists public.sales_order_status_history (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  note text,
  actor_user_id uuid,
  actor_label text,
  created_at timestamptz not null default now()
);
create index if not exists sales_order_status_history_order_idx
  on public.sales_order_status_history(sales_order_id, created_at);

-- Server-only, like 0005/0006: RLS on, no policies, browser roles revoked.
alter table public.sales_order_status_history enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.sales_order_status_history from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.sales_order_status_history from authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. THE TRANSITION FUNCTION
-- ---------------------------------------------------------------------------
create or replace function public.transition_sales_order(
  p_order_id uuid,
  p_from text,
  p_to text,
  p_note text,
  p_actor_user_id uuid,
  p_actor_label text
)
returns table (order_id uuid, new_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
  v_status text;
begin
  if not ((p_from, p_to) in (
    ('requested', 'confirmed'),
    ('requested', 'rejected'),
    ('requested', 'cancelled'),
    ('confirmed', 'pending_payment'),
    ('confirmed', 'cancelled'),
    ('pending_payment', 'cancelled')
  )) then
    raise exception 'SALES_ORDER_TRANSITION_NOT_ALLOWED' using errcode = 'check_violation';
  end if;

  if p_to in ('rejected', 'cancelled') and v_note is null then
    raise exception 'SALES_ORDER_NOTE_REQUIRED' using errcode = 'check_violation';
  end if;

  update public.sales_orders so
     set status = p_to,
         confirmed_at       = case when p_to = 'confirmed'       then now() else so.confirmed_at end,
         pending_payment_at = case when p_to = 'pending_payment' then now() else so.pending_payment_at end,
         rejected_at        = case when p_to = 'rejected'        then now() else so.rejected_at end,
         cancelled_at       = case when p_to = 'cancelled'       then now() else so.cancelled_at end,
         status_note        = case when p_to in ('rejected', 'cancelled') then v_note else so.status_note end,
         status_changed_by  = p_actor_user_id,
         updated_at         = now()
   where so.id = p_order_id
     and so.status = p_from
  returning so.id, so.status into v_id, v_status;

  -- Nothing matched: the order does not exist, or someone else moved it first.
  if v_id is null then
    raise exception 'SALES_ORDER_STATUS_CONFLICT' using errcode = 'check_violation';
  end if;

  insert into public.sales_order_status_history
    (sales_order_id, from_status, to_status, note, actor_user_id, actor_label)
  values (v_id, p_from, p_to, v_note, p_actor_user_id, p_actor_label);

  return query select v_id, v_status;
end;
$$;

revoke all on function public.transition_sales_order(uuid, text, text, text, uuid, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.transition_sales_order(uuid, text, text, text, uuid, text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.transition_sales_order(uuid, text, text, text, uuid, text) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.transition_sales_order(uuid, text, text, text, uuid, text) to service_role';
    execute 'grant select, insert on table public.sales_order_status_history to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. POST-FLIGHT
-- ---------------------------------------------------------------------------
do $$
declare
  v_changed text;
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'sales_orders_status_check'
       and pg_get_constraintdef(oid) like '%pending_payment%'
  ) then
    raise exception 'POSTFLIGHT: status check does not include pending_payment';
  end if;
  if to_regclass('public.sales_order_status_history') is null then
    raise exception 'POSTFLIGHT: history table missing';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sales_order_status_history'::regclass) then
    raise exception 'POSTFLIGHT: RLS not enabled on history table';
  end if;
  if exists (select 1 from pg_roles where rolname = 'anon')
     and has_function_privilege('anon', 'public.transition_sales_order(uuid, text, text, text, uuid, text)', 'EXECUTE') then
    raise exception 'POSTFLIGHT: anon can execute transition_sales_order';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated')
     and has_function_privilege('authenticated', 'public.transition_sales_order(uuid, text, text, text, uuid, text)', 'EXECUTE') then
    raise exception 'POSTFLIGHT: authenticated can execute transition_sales_order';
  end if;

  select string_agg(b.t || ' ' || b.n || '->' || a.n, ', ') into v_changed
    from gr_0008_before b
    join (
      select 'sales_orders' t, count(*) n from public.sales_orders
      union all select 'sales_order_items', count(*) from public.sales_order_items
      union all select 'customers', count(*) from public.customers
      union all select 'orders', count(*) from public.orders
      union all select 'catalogue_products', count(*) from public.catalogue_products
    ) a using (t)
   where a.n <> b.n;
  if v_changed is not null then
    raise exception 'POSTFLIGHT: row counts changed: %', v_changed;
  end if;

  raise notice 'GR 0008: all assertions passed.';
end $$;

commit;
