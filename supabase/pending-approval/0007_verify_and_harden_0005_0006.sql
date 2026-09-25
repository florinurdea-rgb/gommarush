-- 0007 — VERIFY 0005 + 0006 ON PRODUCTION, AND HARDEN THEIR GRANTS.
--
-- Run manually, as one script, in the production Supabase SQL Editor.
--
-- WHY THIS IS NOT "APPLY 0005 AND 0006". A read-only inspection of production
-- on 2026-09-25 found both migrations ALREADY PRESENT and byte-identical to
-- the reviewed files: every column, default, constraint, index, RLS flag, the
-- sequence, and the create_portal_sales_order body (md5
-- 2115c7c3a028d01192425767089b053c, 2878 chars) and its EXECUTE grants. They
-- are not in supabase_migrations (applied through the SQL Editor), so nothing
-- recorded them. Re-running them would be a no-op at best; this script
-- instead PROVES that state and fails before changing anything if it is
-- different.
--
-- THE ONE CHANGE IT MAKES. anon and authenticated hold Supabase's default
-- table grants (SELECT/INSERT/UPDATE/DELETE) on the three new tables and
-- USAGE on the sequence. RLS is enabled with no policies, so those grants
-- already return zero rows — but a single permissive policy added later would
-- open customer bindings and orders to the browser. The portal reaches these
-- objects ONLY through the service role (customer-session.ts, sales-orders.ts,
-- customer-accounts.ts, the admin accounts route), so the grants are removed.
-- service_role keeps everything it has.
--
-- WHAT IT NEVER TOUCHES. No row is inserted, updated or deleted anywhere. No
-- catalogue, supplier, price, logistics, document or auth.users object is
-- altered. Counts of those are taken before and after and must be equal.
--
-- FAILURE BEHAVIOUR. Everything runs inside one transaction. Any failed
-- assertion raises, the transaction aborts, and the closing COMMIT is turned
-- into a ROLLBACK by PostgreSQL: nothing is kept.

begin;

-- One snapshot for the whole script: the before/after counts compare what
-- THIS script did, and a customer order placed meanwhile cannot make them
-- disagree. lock_timeout stops the REVOKEs waiting behind a long query.
set transaction isolation level repeatable read;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. PRE-FLIGHT — fail before any change if production is not what was reviewed
-- ---------------------------------------------------------------------------
do $$
declare
  v_body text;
  v_missing text;
begin
  -- The right database: the one production Inter-Sprint supplier.
  if not exists (select 1 from public.suppliers where id = '4ce0b557-9575-4784-aa80-99e78af4da2f') then
    raise exception 'PREFLIGHT: Inter-Sprint supplier 4ce0b557-9575-4784-aa80-99e78af4da2f not found - wrong project?';
  end if;

  -- 0005 and 0006 objects all present.
  select string_agg(o, ', ') into v_missing
    from unnest(array['public.customer_accounts','public.sales_orders','public.sales_order_items','public.sales_order_number_seq']) o
   where to_regclass(o) is null;
  if v_missing is not null then
    raise exception 'PREFLIGHT: missing objects: % - 0005/0006 are NOT applied; do not run this script, apply them first', v_missing;
  end if;

  -- The order function is exactly the reviewed one.
  select p.prosrc into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_portal_sales_order'
     and pg_get_function_identity_arguments(p.oid) =
       'p_customer_id uuid, p_customer_location_id uuid, p_idempotency_key text, p_customer_snapshot jsonb, p_delivery_snapshot jsonb, p_pricing_snapshot jsonb, p_fulfilment_class text, p_payment_method text, p_currency text, p_monetary_status text, p_tyre_net_total_cents bigint, p_pfu_total_cents bigint, p_vat_total_cents bigint, p_grand_total_cents bigint, p_customer_note text, p_pfu_status text, p_pfu_estimate_version text, p_vat_rate_percent numeric, p_delivery_promise_max_days integer, p_items jsonb';
  if v_body is null then
    raise exception 'PREFLIGHT: create_portal_sales_order with the reviewed signature not found';
  end if;
  if md5(v_body) <> '2115c7c3a028d01192425767089b053c' then
    raise exception 'PREFLIGHT: create_portal_sales_order body differs from the reviewed 0006 (md5 %)', md5(v_body);
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'create_portal_sales_order'
       and p.prosecdef and p.proconfig @> array['search_path=public']
  ) then
    raise exception 'PREFLIGHT: create_portal_sales_order is not SECURITY DEFINER with search_path=public';
  end if;

  -- The constraints the application relies on.
  select string_agg(c, ', ') into v_missing
    from unnest(array[
      'customer_accounts_auth_user_id_key',          -- one Auth user -> one binding
      'customer_accounts_customer_id_fkey',
      'sales_orders_customer_idempotency_key',        -- idempotent create, per customer
      'sales_orders_order_number_key',                -- GR numbering unique
      'sales_orders_customer_id_fkey',
      'sales_orders_customer_location_id_fkey',
      'sales_orders_payment_method_check',            -- no POS
      'sales_orders_complete_has_totals',             -- no falsely final total
      'sales_orders_estimated_pfu_has_version',
      'sales_orders_version_only_for_estimates',
      'sales_order_items_sales_order_id_fkey',
      'sales_order_items_catalogue_product_id_fkey',
      'sales_order_items_source_listing_id_fkey',
      'sales_order_items_sales_order_id_line_number_key',
      'sales_order_items_estimated_pfu_has_version'
    ]) c
   where not exists (select 1 from pg_constraint where conname = c);
  if v_missing is not null then
    raise exception 'PREFLIGHT: missing constraints: %', v_missing;
  end if;

  -- RLS on, and no policy anywhere on the three tables.
  if exists (
    select 1 from pg_class
     where oid in ('public.customer_accounts'::regclass, 'public.sales_orders'::regclass, 'public.sales_order_items'::regclass)
       and not relrowsecurity
  ) then
    raise exception 'PREFLIGHT: RLS is not enabled on every 0005/0006 table';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename in ('customer_accounts','sales_orders','sales_order_items')
  ) then
    raise exception 'PREFLIGHT: a policy exists on a 0005/0006 table - review it before continuing';
  end if;

  -- The browser roles must not be able to call the order function.
  if has_function_privilege('anon', 'public.create_portal_sales_order(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text, bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_portal_sales_order(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text, bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb)', 'EXECUTE') then
    raise exception 'PREFLIGHT: anon/authenticated can EXECUTE create_portal_sales_order';
  end if;

  -- The portal's only access path must keep working.
  if not has_function_privilege('service_role', 'public.create_portal_sales_order(uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text, bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb)', 'EXECUTE') then
    raise exception 'PREFLIGHT: service_role cannot EXECUTE create_portal_sales_order';
  end if;
end $$;

-- Snapshot of everything that must NOT change.
create temp table gr_0007_before on commit drop as
select 'suppliers' t, count(*) n from public.suppliers
union all select 'catalogue_products', count(*) from public.catalogue_products
union all select 'supplier_product_listings', count(*) from public.supplier_product_listings
union all select 'supplier_listing_prices', count(*) from public.supplier_listing_prices
union all select 'customers', count(*) from public.customers
union all select 'customer_locations', count(*) from public.customer_locations
union all select 'orders', count(*) from public.orders
union all select 'order_items', count(*) from public.order_items
union all select 'order_documents', count(*) from public.order_documents
union all select 'customer_accounts', count(*) from public.customer_accounts
union all select 'sales_orders', count(*) from public.sales_orders
union all select 'sales_order_items', count(*) from public.sales_order_items
union all select 'auth.users', count(*) from auth.users;

-- ---------------------------------------------------------------------------
-- 2. THE CHANGE — browser roles lose direct table/sequence access
-- ---------------------------------------------------------------------------
revoke all on table public.customer_accounts  from anon, authenticated;
revoke all on table public.sales_orders       from anon, authenticated;
revoke all on table public.sales_order_items  from anon, authenticated;
revoke all on sequence public.sales_order_number_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. POST-FLIGHT — the change did exactly that, and nothing else moved
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_changed text;
begin
  for r in
    select rol, tbl from (values ('anon'),('authenticated')) a(rol),
      (values ('public.customer_accounts'),('public.sales_orders'),('public.sales_order_items')) b(tbl)
  loop
    if has_table_privilege(r.rol, r.tbl, 'SELECT') or has_table_privilege(r.rol, r.tbl, 'INSERT')
       or has_table_privilege(r.rol, r.tbl, 'UPDATE') or has_table_privilege(r.rol, r.tbl, 'DELETE') then
      raise exception 'POSTFLIGHT: % still has a privilege on %', r.rol, r.tbl;
    end if;
  end loop;
  if has_sequence_privilege('anon', 'public.sales_order_number_seq', 'USAGE')
     or has_sequence_privilege('authenticated', 'public.sales_order_number_seq', 'USAGE') then
    raise exception 'POSTFLIGHT: a browser role still has USAGE on sales_order_number_seq';
  end if;

  for r in select unnest(array['public.customer_accounts','public.sales_orders','public.sales_order_items']) tbl loop
    if not (has_table_privilege('service_role', r.tbl, 'SELECT') and has_table_privilege('service_role', r.tbl, 'INSERT')
            and has_table_privilege('service_role', r.tbl, 'UPDATE') and has_table_privilege('service_role', r.tbl, 'DELETE')) then
      raise exception 'POSTFLIGHT: service_role lost access to %', r.tbl;
    end if;
  end loop;
  if not has_sequence_privilege('service_role', 'public.sales_order_number_seq', 'USAGE') then
    raise exception 'POSTFLIGHT: service_role lost USAGE on sales_order_number_seq';
  end if;

  select string_agg(b.t || ' ' || b.n || '->' || a.n, ', ') into v_changed
    from gr_0007_before b
    join (
      select 'suppliers' t, count(*) n from public.suppliers
      union all select 'catalogue_products', count(*) from public.catalogue_products
      union all select 'supplier_product_listings', count(*) from public.supplier_product_listings
      union all select 'supplier_listing_prices', count(*) from public.supplier_listing_prices
      union all select 'customers', count(*) from public.customers
      union all select 'customer_locations', count(*) from public.customer_locations
      union all select 'orders', count(*) from public.orders
      union all select 'order_items', count(*) from public.order_items
      union all select 'order_documents', count(*) from public.order_documents
      union all select 'customer_accounts', count(*) from public.customer_accounts
      union all select 'sales_orders', count(*) from public.sales_orders
      union all select 'sales_order_items', count(*) from public.sales_order_items
      union all select 'auth.users', count(*) from auth.users
    ) a using (t)
   where a.n <> b.n;
  if v_changed is not null then
    raise exception 'POSTFLIGHT: row counts changed: %', v_changed;
  end if;

  raise notice 'GR 0007: all assertions passed.';
end $$;

-- The evidence, shown in the SQL Editor's result pane.
select t as "unchanged table", n as "rows" from gr_0007_before order by t;

-- Reached only if every assertion above passed. After any error PostgreSQL
-- has already aborted the transaction and this COMMIT becomes a ROLLBACK.
commit;
