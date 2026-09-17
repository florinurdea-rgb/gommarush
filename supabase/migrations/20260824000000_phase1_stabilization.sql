-- ============================================================================
-- GommaRush Phase 1 — Production Stabilisation & Simplified Operational System
-- ============================================================================
-- Additive only, same posture as every prior migration in this project.
-- Written after re-verifying the LIVE schema directly (only the first two
-- migrations had ever run — see the stabilisation audit). This migration
-- brings production the rest of the way to what the deployed application
-- code expects, and adds what Phase 1's simplified (scan-free) operational
-- model needs on top:
--
--   * orders: ready_at / payment-collection / delivery-failure columns
--   * gorush_mark_order_loaded  — order-level "LOADED", no unit scanning
--   * gorush_mark_delivery_failed — order-level delivery exception
--   * gorush_set_order_status patched to stamp ready_at
--   * gorush_schema_health() — the permanent schema-drift safety check
--   * Realtime: lightweight change-signal broadcast on orders/vehicles
--
-- Deliberately NOT touched: inventory_units, inventory_scans, the
-- gorush_receive_unit / gorush_store_unit / gorush_load_unit /
-- gorush_manual_load_unit / gorush_refresh_order_status functions. Phase 1
-- removes the ACTIVE UI paths that scan individual tyres (see the
-- application-layer changes in the same change set), but per the product
-- brief's explicit instruction, historical scan infrastructure is not
-- destroyed — it simply has no remaining caller in the Phase 1 workflow.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- orders: Phase 1 operational timestamps + structured COD fields
-- ---------------------------------------------------------------------------
alter table public.orders add column if not exists ready_at timestamptz;
alter table public.orders add column if not exists amount_collected numeric(10, 2);
alter table public.orders add column if not exists payment_collected_at timestamptz;
alter table public.orders add column if not exists delivery_failure_reason text;
alter table public.orders add column if not exists delivery_failed_at timestamptz;

-- ---------------------------------------------------------------------------
-- drivers: real authentication (§17) + explicit vehicle selection
-- ---------------------------------------------------------------------------
-- auth_user_id already exists (added in the very first migration,
-- unused until now). current_vehicle_id is the one new column: "which van
-- today" is an operational preference, not part of identity, so it is
-- deliberately separate from auth_user_id and never used to decide who
-- someone is.
alter table public.drivers add column if not exists current_vehicle_id uuid references public.vehicles(id) on delete set null;
create unique index if not exists drivers_auth_user_id_key on public.drivers(auth_user_id) where auth_user_id is not null;

-- ---------------------------------------------------------------------------
-- gorush_set_order_status: stamp ready_at when an order reaches
-- 'ready_for_loading' (the "Pregătește comanda" action). Same signature,
-- same behaviour otherwise — safe to `create or replace` in place.
-- ---------------------------------------------------------------------------
create or replace function public.gorush_set_order_status(
  p_order_id uuid,
  p_status text,
  p_reason text default null,
  p_changed_by text default null,
  p_planned_delivery_date date default null
)
returns jsonb
language plpgsql
as $$
declare
  v_current text;
  v_current_stand text;
  v_restore_stand text;
  v_stand_warning text := null;
begin
  perform pg_advisory_xact_lock(hashtext('gorush_stand_allocation'));

  select status, stand_code into v_current, v_current_stand
    from public.orders where id = p_order_id for update;

  if v_current is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  if v_current = p_status and p_planned_delivery_date is null then
    return jsonb_build_object('ok', true, 'code', 'NO_CHANGE', 'status', v_current);
  end if;

  if p_status = 'on_hold' then
    update public.orders
       set status = 'on_hold', status_before_hold = v_current, held_at = now()
     where id = p_order_id;

  elsif p_status = 'cancelled' then
    update public.orders
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = nullif(p_reason, '')
     where id = p_order_id;

  else
    if v_current = 'on_hold' and v_current_stand is not null then
      if public.gorush_stand_is_occupied(v_current_stand, p_order_id) then
        v_stand_warning := 'STAND_OCCUPIED';
        v_restore_stand := public.gorush_first_free_stand(p_order_id);
        if v_restore_stand is null then
          v_stand_warning := 'NO_STAND_AVAILABLE';
        end if;
      else
        v_restore_stand := v_current_stand;
      end if;

      update public.orders
         set status = p_status,
             stand_code = v_restore_stand,
             held_at = null,
             status_before_hold = null,
             delivery_failure_reason = null,
             planned_delivery_date = coalesce(p_planned_delivery_date, planned_delivery_date),
             expected_at = coalesce(p_planned_delivery_date::timestamptz, expected_at),
             ready_at = case when p_status = 'ready_for_loading' then coalesce(ready_at, now()) else ready_at end
       where id = p_order_id;
    else
      update public.orders
         set status = p_status,
             held_at = null,
             status_before_hold = null,
             delivery_failure_reason = null,
             planned_delivery_date = coalesce(p_planned_delivery_date, planned_delivery_date),
             expected_at = coalesce(p_planned_delivery_date::timestamptz, expected_at),
             ready_at = case when p_status = 'ready_for_loading' then coalesce(ready_at, now()) else ready_at end
       where id = p_order_id;
    end if;
  end if;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (p_order_id, v_current, p_status, nullif(p_changed_by, ''), nullif(p_reason, ''));

  return jsonb_build_object(
    'ok', true, 'status', p_status, 'previous_status', v_current,
    'stand_warning', v_stand_warning
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_mark_order_loaded — Phase 1 order-level "LOADED", no tyre scanning
-- ---------------------------------------------------------------------------
-- One tap per order: "Autoservice Rossi / 8 tyres / Van 3 / [MARK AS
-- LOADED]". Idempotent — pressing twice returns the existing successful
-- state rather than erroring or double-recording. Requires a vehicle to
-- already be assigned (either passed in or already on the order); loading
-- an unassigned order is a contradiction the UI should prevent, but the
-- database is the actual backstop.
create or replace function public.gorush_mark_order_loaded(
  p_order_id uuid,
  p_vehicle_id uuid default null,
  p_operator text default null
) returns jsonb language plpgsql as $$
declare
  v_order public.orders;
  v_vehicle_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  if v_order.status in ('loaded', 'out_for_delivery', 'partially_delivered', 'delivered') then
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_LOADED',
      'status', v_order.status, 'loaded_at', v_order.loaded_at
    );
  end if;

  if v_order.status not in ('stored', 'ready_for_loading') then
    return jsonb_build_object('ok', false, 'code', 'NOT_READY', 'status', v_order.status);
  end if;

  v_vehicle_id := coalesce(p_vehicle_id, v_order.vehicle_id);
  if v_vehicle_id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_VEHICLE');
  end if;

  update public.orders
     set status = 'loaded',
         loaded_at = now(),
         vehicle_id = v_vehicle_id
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (p_order_id, v_order.status, 'loaded', nullif(p_operator, ''), 'marked_loaded');

  return jsonb_build_object('ok', true, 'code', 'LOADED', 'status', 'loaded', 'loaded_at', now());
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_mark_delivery_failed — the delivery exception path
-- ---------------------------------------------------------------------------
-- "Reality needs exceptions" (brief §21): a required reason, one audit
-- event, and the order returns to an explicit attention state rather than
-- inventing a new status. Reuses the existing on_hold / status_before_hold
-- bookkeeping so the order shows up wherever "needs attention" already
-- looks, and can be reactivated with reactivateOrder() like any other hold.
create or replace function public.gorush_mark_delivery_failed(
  p_order_id uuid,
  p_driver_id uuid default null,
  p_operator text default null,
  p_reason text default null
) returns jsonb language plpgsql as $$
declare
  v_order public.orders;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  if p_driver_id is not null and v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;
  if v_order.status = 'delivered' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DELIVERED');
  end if;
  if v_order.status = 'on_hold' then
    -- Already flagged; update the reason rather than double-recording.
    update public.orders
       set delivery_failure_reason = v_reason, delivery_failed_at = now()
     where id = p_order_id;
    insert into public.order_status_history (order_id, old_status, new_status, changed_by, changed_by_label, notes)
    values (p_order_id, 'on_hold', 'on_hold', p_driver_id, nullif(p_operator, ''), 'delivery_failed:' || v_reason);
    return jsonb_build_object('ok', true, 'code', 'DELIVERY_FAILED', 'status', 'on_hold');
  end if;

  update public.orders
     set status = 'on_hold',
         status_before_hold = v_order.status,
         held_at = now(),
         delivery_failure_reason = v_reason,
         delivery_failed_at = now()
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by, changed_by_label, notes)
  values (p_order_id, v_order.status, 'on_hold', p_driver_id, nullif(p_operator, ''), 'delivery_failed:' || v_reason);

  return jsonb_build_object('ok', true, 'code', 'DELIVERY_FAILED', 'status', 'on_hold');
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime: lightweight change-signal broadcast (brief §14)
-- ---------------------------------------------------------------------------
-- Deliberately NOT "postgres_changes" (which would need RLS SELECT policies
-- opened up for anon/authenticated — a real weakening of this project's
-- service-role-only boundary, see §39 "do not damage what is already
-- good"). Instead: a public Broadcast channel carrying only a non-sensitive
-- change signal (table + id + status + vehicle_id — never a customer name,
-- address, or payment amount). The browser reacts by refetching from the
-- authenticated Next.js server, which re-checks the session and returns
-- the real, authorized data. This is the "mutation -> realtime notification
-- -> refetch canonical read model" pattern from the brief, achieved without
-- opening a single new read path to the database.
create or replace function public.gorush_broadcast_order_change()
returns trigger language plpgsql as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'table', 'orders',
      'id', new.id,
      'status', new.status,
      'vehicle_id', new.vehicle_id,
      'driver_id', new.driver_id
    ),
    'change',
    'gorush-ops',
    false
  );
  return new;
exception
  when others then
    -- Realtime must never block or fail the underlying write.
    return new;
end;
$$;

create or replace function public.gorush_broadcast_vehicle_change()
returns trigger language plpgsql as $$
begin
  perform realtime.send(
    jsonb_build_object('table', 'vehicles', 'id', new.id, 'active', new.active),
    'change',
    'gorush-ops',
    false
  );
  return new;
exception
  when others then
    return new;
end;
$$;

drop trigger if exists orders_broadcast_change on public.orders;
create trigger orders_broadcast_change
  after insert or update on public.orders
  for each row execute function public.gorush_broadcast_order_change();

drop trigger if exists vehicles_broadcast_change on public.vehicles;
create trigger vehicles_broadcast_change
  after insert or update on public.vehicles
  for each row execute function public.gorush_broadcast_vehicle_change();

-- ---------------------------------------------------------------------------
-- gorush_schema_health — permanent schema-drift safety mechanism (brief §6)
-- ---------------------------------------------------------------------------
-- Checked from an admin-visible health banner and callable in CI/deploy.
-- Never silently degrades a business feature: if this reports missing, the
-- app must say so loudly rather than let isMissingSchemaError() quietly
-- swallow it forever.
create or replace function public.gorush_schema_health()
returns jsonb language plpgsql stable as $$
declare
  v_missing_tables text[] := '{}';
  v_missing_columns text[] := '{}';
  v_missing_functions text[] := '{}';
  v_tbl text;
  v_fn text;
  v_col record;
begin
  foreach v_tbl in array array[
    'orders', 'order_items', 'order_documents', 'document_charges', 'app_settings',
    'geocode_cache', 'vehicles', 'drivers', 'client_offer_requests', 'order_status_history'
  ]
  loop
    if not exists (
      select 1 from information_schema.tables
       where table_schema = 'public' and table_name = v_tbl
    ) then
      v_missing_tables := array_append(v_missing_tables, v_tbl);
    end if;
  end loop;

  for v_col in
    select * from (values
      ('vehicles', 'capacity_units'), ('vehicles', 'display_order'), ('vehicles', 'color_key'),
      ('orders', 'delivery_sequence'), ('orders', 'normalized_document_number'),
      ('orders', 'ready_at'), ('orders', 'amount_collected'), ('orders', 'delivery_failure_reason'),
      ('drivers', 'current_vehicle_id')
    ) as t(tbl, col)
  loop
    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = v_col.tbl and column_name = v_col.col
    ) then
      v_missing_columns := array_append(v_missing_columns, v_col.tbl || '.' || v_col.col);
    end if;
  end loop;

  foreach v_fn in array array[
    'gorush_create_order', 'gorush_set_order_status', 'gorush_assign_stand',
    'gorush_deliver_order', 'gorush_mark_order_loaded', 'gorush_mark_delivery_failed',
    'gorush_remove_vehicle'
  ]
  loop
    if not exists (
      select 1 from information_schema.routines
       where routine_schema = 'public' and routine_name = v_fn
    ) then
      v_missing_functions := array_append(v_missing_functions, v_fn);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', array_length(v_missing_tables, 1) is null
      and array_length(v_missing_columns, 1) is null
      and array_length(v_missing_functions, 1) is null,
    'missing_tables', v_missing_tables,
    'missing_columns', v_missing_columns,
    'missing_functions', v_missing_functions,
    'checked_at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: same defence-in-depth posture as every RPC in this project.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  for fn in
    select unnest(array[
      'gorush_mark_order_loaded(uuid, uuid, text)',
      'gorush_mark_delivery_failed(uuid, uuid, text, text)',
      'gorush_schema_health()'
    ])
  loop
    begin
      execute format('revoke all on function public.%s from anon, authenticated', fn);
    exception
      when undefined_object then null;
    end;
  end loop;
end;
$$;
