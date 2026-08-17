-- ============================================================================
-- GoRush Logistics — Phase 1 transactional operations
-- ============================================================================
-- Every function here exists because one logical operation needs several writes
-- that must all succeed or all fail. A PL/pgSQL function body runs in a single
-- transaction, which makes this the cheapest correct place for them.
--
-- Written against the REAL live column names, not idealised ones:
--   orders.order_number      bigint GENERATED ALWAYS AS IDENTITY — never written
--   orders.document_date, orders.supplier_order_reference, orders.delivery_name,
--   orders.cash_on_delivery, orders.delivery_country_code, orders.source_type
--   order_items.environmental_fee (= PFU), order_items.vat_percent
--   inventory_units.unit_type / unit_sequence / qr_token
--   inventory_scans.scan_type from the existing vocabulary
--   print_jobs.print_type = 'inventory_unit_label'
--   order_status_history.old_status / new_status / changed_at
--
-- SECURITY MODEL — read before changing:
-- These are SECURITY INVOKER (the default) on purpose. Postgres grants EXECUTE
-- to PUBLIC by default, so a SECURITY DEFINER function here would hand the anon
-- key a write path straight through Row Level Security. As SECURITY INVOKER, RLS
-- still applies to the caller: anon/authenticated get nothing (no policies
-- exist), and only the service-role key — used solely by server-side code — can
-- write. EXECUTE is additionally revoked from anon/authenticated at the bottom.
--
-- Safe to re-run: every function is `create or replace`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Stand occupancy
-- ---------------------------------------------------------------------------
-- These statuses MUST match the partial unique index `orders_active_stand_key`.
-- A stand frees itself as soon as the order leaves them — there is no explicit
-- release step to forget.
create or replace function public.gorush_stand_holding_statuses()
returns text[]
language sql
immutable
as $$
  select array['expected', 'partially_received', 'received', 'sorting', 'stored', 'ready_for_loading'];
$$;

create or replace function public.gorush_stand_is_occupied(
  p_stand_code text,
  p_exclude_order uuid default null
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.orders o
    where o.stand_code = p_stand_code
      and o.status = any (public.gorush_stand_holding_statuses())
      and (p_exclude_order is null or o.id <> p_exclude_order)
  );
$$;

create or replace function public.gorush_first_free_stand(p_exclude_order uuid default null)
returns text
language plpgsql
stable
as $$
declare
  candidate text;
begin
  for candidate in select unnest(array['A', 'B', 'C', 'D', 'E'])
  loop
    if not public.gorush_stand_is_occupied(candidate, p_exclude_order) then
      return candidate;
    end if;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unit token
-- ---------------------------------------------------------------------------
-- The value printed as Code128 + QR and submitted by a scanner. Must be
-- unguessable (it is effectively a bearer identifier for one physical object)
-- and Code128-friendly.
--
-- The 'GRU' prefix is deliberate: it lets the warehouse scan interface tell a
-- GoRush token apart from a supplier's own barcode at a glance. The column's
-- existing default (bare hex) is left in place for any other writer.
create or replace function public.gorush_new_unit_token()
returns text
language sql
volatile
as $$
  select 'GRU' || upper(encode(gen_random_bytes(12), 'hex'));
$$;

-- ---------------------------------------------------------------------------
-- gorush_create_order — the single atomic "Salvează" write
-- ---------------------------------------------------------------------------
-- Creates the order, its item lines, one inventory_unit per physical object, the
-- status-history entry, and links the source document. Stand allocation happens
-- under an advisory lock so two concurrent saves cannot both take stand A (the
-- partial unique index is the belt to this braces).
--
-- Customer / customer_location resolution happens in TypeScript before this call
-- (src/lib/server/customers.ts): those decisions need the fuzzy matching rules
-- and, unlike the writes below, are individually meaningful and idempotent.
create or replace function public.gorush_create_order(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
  v_requested_stand text := nullif(payload->>'stand_code', '');
  v_auto_allocate boolean := coalesce((payload->>'auto_allocate_stand')::boolean, false);
  v_stand text := null;
  v_stand_warning text := null;
  v_status text := coalesce(nullif(payload->>'status', ''), 'expected');
  v_item jsonb;
  v_item_id uuid;
  v_line integer := 0;
  v_unit_count integer := 0;
  v_quantity integer;
  v_is_physical boolean;
  v_item_type text;
  v_unit_type text;
  i integer;
begin
  if payload is null then
    raise exception 'MISSING_PAYLOAD';
  end if;
  if nullif(payload->>'supplier_id', '') is null then
    -- orders.supplier_id is NOT NULL in this schema: an order always originates
    -- from a supplier document.
    raise exception 'SUPPLIER_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('gorush_stand_allocation'));

  if v_requested_stand is not null then
    if v_requested_stand not in ('A', 'B', 'C', 'D', 'E') then
      raise exception 'INVALID_STAND';
    end if;
    if public.gorush_stand_is_occupied(v_requested_stand) then
      -- Never silently reuse an occupied stand. The order is created unassigned
      -- and the caller surfaces a visible warning for manual resolution.
      v_stand := null;
      v_stand_warning := 'STAND_OCCUPIED';
    else
      v_stand := v_requested_stand;
    end if;
  elsif v_auto_allocate then
    v_stand := public.gorush_first_free_stand();
    if v_stand is null then
      v_stand_warning := 'NO_STAND_AVAILABLE';
    end if;
  end if;

  insert into public.orders (
    supplier_id, supplier_document_number, document_date, supplier_order_reference,
    document_type, source_type,
    customer_id, customer_location_id,
    delivery_name, delivery_address_line1, delivery_address_line2,
    delivery_postal_code, delivery_city, delivery_province, delivery_country_code,
    delivery_notes,
    planned_delivery_date, expected_at, stand_code, driver_id, vehicle_id, status,
    cash_on_delivery, payment_method, amount_to_collect, currency, collection_method,
    payment_status, notes, source_document_id
  )
  values (
    (payload->>'supplier_id')::uuid,
    nullif(payload->>'supplier_document_number', ''),
    nullif(payload->>'supplier_document_date', '')::date,
    nullif(payload->>'supplier_reference', ''),
    nullif(payload->>'document_type', ''),
    coalesce(nullif(payload->>'source_type', ''), 'manual'),
    nullif(payload->>'customer_id', '')::uuid,
    nullif(payload->>'customer_location_id', '')::uuid,
    nullif(payload->>'delivery_recipient', ''),
    nullif(payload->>'delivery_address_line1', ''),
    nullif(payload->>'delivery_address_line2', ''),
    nullif(payload->>'delivery_postal_code', ''),
    nullif(payload->>'delivery_city', ''),
    nullif(payload->>'delivery_province', ''),
    coalesce(nullif(payload->>'delivery_country', ''), 'IT'),
    nullif(payload->>'delivery_notes', ''),
    nullif(payload->>'planned_delivery_date', '')::date,
    -- expected_at mirrors the planned date so the pre-existing timestamp column
    -- stays meaningful alongside the new date column.
    nullif(payload->>'planned_delivery_date', '')::date::timestamptz,
    v_stand,
    nullif(payload->>'driver_id', '')::uuid,
    nullif(payload->>'vehicle_id', '')::uuid,
    v_status,
    coalesce((payload->>'requires_payment_on_delivery')::boolean, false),
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'amount_to_collect', '')::numeric,
    coalesce(nullif(payload->>'currency', ''), 'EUR'),
    nullif(payload->>'collection_method', ''),
    case
      when coalesce((payload->>'requires_payment_on_delivery')::boolean, false) then 'pending'
      else 'not_required'
    end,
    nullif(payload->>'notes', ''),
    nullif(payload->>'source_document_id', '')::uuid
  )
  returning id, order_number into v_order_id, v_order_number;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_line := v_line + 1;
    v_item_type := coalesce(nullif(v_item->>'item_type', ''), 'other');
    v_quantity := greatest(coalesce((v_item->>'quantity')::integer, 1), 1);
    -- Services and fees are order items but not physical inventory. An explicit
    -- is_physical always wins, which is the hook for a future "fee that ships".
    v_is_physical := coalesce(
      (v_item->>'is_physical')::boolean,
      v_item_type not in ('service', 'fee')
    );

    insert into public.order_items (
      order_id, line_number, item_type, is_physical, supplier_sku,
      raw_description, description, brand, model,
      width, aspect_ratio, rim_diameter, load_index, speed_rating, season,
      extra_load, run_flat,
      quantity, unit_price, vat_percent, environmental_fee, logistics_fee,
      line_subtotal, notes, needs_review, review_fields, confidence
    )
    values (
      v_order_id,
      coalesce((v_item->>'line_number')::integer, v_line),
      v_item_type,
      v_is_physical,
      nullif(v_item->>'supplier_sku', ''),
      nullif(v_item->>'raw_description', ''),
      nullif(v_item->>'description', ''),
      nullif(v_item->>'brand', ''),
      nullif(v_item->>'model', ''),
      nullif(v_item->>'width', '')::integer,
      nullif(v_item->>'aspect_ratio', '')::integer,
      nullif(v_item->>'rim_diameter', '')::numeric,
      nullif(v_item->>'load_index', ''),
      nullif(v_item->>'speed_rating', ''),
      nullif(v_item->>'season', ''),
      nullif(v_item->>'extra_load', '')::boolean,
      nullif(v_item->>'run_flat', '')::boolean,
      v_quantity,
      nullif(v_item->>'unit_price', '')::numeric,
      nullif(v_item->>'tax_rate', '')::numeric,
      nullif(v_item->>'pfu_fee', '')::numeric,
      nullif(v_item->>'logistics_fee', '')::numeric,
      case
        when nullif(v_item->>'unit_price', '') is not null
          then round((v_item->>'unit_price')::numeric * v_quantity, 2)
        else null
      end,
      nullif(v_item->>'notes', ''),
      coalesce((v_item->>'needs_review')::boolean, false),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(coalesce(v_item->'review_fields', '[]'::jsonb)) as value),
        '{}'
      ),
      nullif(v_item->>'confidence', '')::numeric
    )
    returning id into v_item_id;

    -- One inventory_unit per physical object: quantity 4 => 4 rows.
    if v_is_physical then
      -- inventory_units.unit_type has a narrower vocabulary than
      -- order_items.item_type (no service/fee), so anything unexpected lands on
      -- 'other' rather than violating the constraint.
      v_unit_type := case
        when v_item_type in ('tyre', 'tube', 'wheel', 'accessory') then v_item_type
        else 'other'
      end;

      for i in 1..v_quantity loop
        insert into public.inventory_units (
          order_id, order_item_id, unit_type, unit_sequence, qr_token, description, status
        )
        values (
          v_order_id, v_item_id, v_unit_type, i,
          public.gorush_new_unit_token(),
          coalesce(nullif(v_item->>'description', ''), nullif(v_item->>'raw_description', '')),
          'expected'
        );
        v_unit_count := v_unit_count + 1;
      end loop;
    end if;
  end loop;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (v_order_id, null, v_status, nullif(payload->>'created_by', ''), 'order_created');

  if nullif(payload->>'source_document_id', '') is not null then
    update public.order_documents
       set order_id = v_order_id,
           extraction_status = 'confirmed'
     where id = (payload->>'source_document_id')::uuid;
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'stand_code', v_stand,
    'stand_warning', v_stand_warning,
    'inventory_unit_count', v_unit_count,
    'item_count', v_line
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_assign_stand — manual stand resolution from the Admin UI
-- ---------------------------------------------------------------------------
create or replace function public.gorush_assign_stand(
  p_order_id uuid,
  p_stand_code text,
  p_changed_by text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_stand text := nullif(p_stand_code, '');
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtext('gorush_stand_allocation'));

  if v_stand is not null and v_stand not in ('A', 'B', 'C', 'D', 'E') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_STAND');
  end if;

  select status into v_status from public.orders where id = p_order_id;
  if v_status is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;

  if v_stand is not null and public.gorush_stand_is_occupied(v_stand, p_order_id) then
    return jsonb_build_object('ok', false, 'code', 'STAND_OCCUPIED');
  end if;

  update public.orders set stand_code = v_stand where id = p_order_id;

  update public.inventory_units
     set last_stand_code = v_stand
   where order_id = p_order_id
     and status in ('expected', 'received', 'stored');

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (
    p_order_id, v_status, v_status, nullif(p_changed_by, ''),
    case when v_stand is null then 'stand_cleared' else 'stand_assigned:' || v_stand end
  );

  return jsonb_build_object('ok', true, 'stand_code', v_stand);
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_set_order_status — hold / reactivate / cancel / advance
-- ---------------------------------------------------------------------------
-- "Delete" in the Admin UI routes here with p_status = 'cancelled'. Nothing is
-- hard-deleted: items, units, scans and history all survive.
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
    -- Remember where it came from so reactivation can restore it.
    update public.orders
       set status = 'on_hold', status_before_hold = v_current, held_at = now()
     where id = p_order_id;

  elsif p_status = 'cancelled' then
    update public.orders
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = nullif(p_reason, '')
     where id = p_order_id;

  else
    -- Reactivating out of hold: the stand may have been taken meanwhile, so
    -- re-check rather than assume.
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
             planned_delivery_date = coalesce(p_planned_delivery_date, planned_delivery_date),
             expected_at = coalesce(p_planned_delivery_date::timestamptz, expected_at)
       where id = p_order_id;
    else
      update public.orders
         set status = p_status,
             held_at = null,
             status_before_hold = null,
             planned_delivery_date = coalesce(p_planned_delivery_date, planned_delivery_date),
             expected_at = coalesce(p_planned_delivery_date::timestamptz, expected_at)
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
-- gorush_refresh_order_status — derive order status from physical units
-- ---------------------------------------------------------------------------
-- Called by the scan RPCs so `orders.status` stays an honest cache of the unit
-- statuses rather than a second source of truth. Administrative statuses
-- (on_hold, cancelled) and later delivery stages always win.
create or replace function public.gorush_refresh_order_status(
  p_order_id uuid,
  p_operator text default null
)
returns text
language plpgsql
as $$
declare
  v_current text;
  v_total integer;
  v_received integer;
  v_stored integer;
  v_loaded integer;
  v_target text;
begin
  select status into v_current from public.orders where id = p_order_id;
  if v_current is null then return null; end if;

  if v_current in ('on_hold', 'cancelled', 'out_for_delivery', 'partially_delivered',
                   'delivered', 'returned') then
    return v_current;
  end if;

  select
    count(*),
    count(*) filter (where status in ('received', 'stored', 'ready_for_loading', 'loaded', 'out_for_delivery', 'delivered')),
    count(*) filter (where status in ('stored', 'ready_for_loading', 'loaded', 'out_for_delivery', 'delivered')),
    count(*) filter (where status in ('loaded', 'out_for_delivery', 'delivered'))
    into v_total, v_received, v_stored, v_loaded
    from public.inventory_units
   where order_id = p_order_id;

  if v_total = 0 then return v_current; end if;

  v_target := case
    when v_loaded = v_total then 'loaded'
    when v_loaded > 0 then 'partially_loaded'
    when v_stored = v_total then 'stored'
    when v_received > 0 or v_stored > 0 then 'partially_received'
    else 'expected'
  end;

  -- 'ready_for_loading' is an explicit human decision on top of 'stored'; don't
  -- undo it just because the derivation says 'stored'.
  if v_current = 'ready_for_loading' and v_target = 'stored' then
    return v_current;
  end if;

  if v_target <> v_current then
    update public.orders
       set status = v_target,
           received_at = case when v_target in ('partially_received') and received_at is null then now() else received_at end,
           stored_at = case when v_target = 'stored' and stored_at is null then now() else stored_at end,
           loaded_at = case when v_target = 'loaded' and loaded_at is null then now() else loaded_at end
     where id = p_order_id;

    insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
    values (p_order_id, v_current, v_target, nullif(p_operator, ''), 'derived_from_units');
  end if;

  return v_target;
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_receive_unit — supplier label matched to a physical expected unit
-- ---------------------------------------------------------------------------
-- One atomic step: claim the next expected unit on that order item, mark it
-- received, write the scan event, and queue the label print job.
--
-- The unit becomes 'received', NOT 'stored'. Physical storage is confirmed only
-- by the later GoRush barcode scan.
create or replace function public.gorush_receive_unit(
  p_order_item_id uuid,
  p_raw_value text default null,
  p_operator text default null,
  p_manual boolean default false,
  p_reason text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default null
)
returns jsonb
language plpgsql
as $$
declare
  v_unit public.inventory_units;
  v_order public.orders;
  v_item public.order_items;
  v_scan_id uuid;
  v_print_job_id uuid;
  v_existing_scan public.inventory_scans;
  v_label jsonb;
  v_customer_name text;
  v_product text;
  v_size text;
begin
  -- Idempotency first: a double-submitted capture must return the original
  -- result rather than consuming a second physical unit.
  if nullif(p_idempotency_key, '') is not null then
    select * into v_existing_scan from public.inventory_scans
     where idempotency_key = p_idempotency_key limit 1;
    if v_existing_scan.id is not null then
      select * into v_unit from public.inventory_units where id = v_existing_scan.inventory_unit_id;
      select * into v_order from public.orders where id = v_unit.order_id;
      return jsonb_build_object(
        'ok', true, 'code', 'ALREADY_PROCESSED',
        'inventory_unit_id', v_unit.id,
        'unit_token', v_unit.qr_token,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'stand_code', v_order.stand_code,
        'scan_id', v_existing_scan.id,
        'print_job_id', (
          select id from public.print_jobs
           where inventory_unit_id = v_unit.id order by created_at desc limit 1
        )
      );
    end if;
  end if;

  select * into v_item from public.order_items where id = p_order_item_id;
  if v_item.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_ITEM_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_item.order_id;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  if v_order.status in ('cancelled', 'on_hold') then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_ACTIVE', 'status', v_order.status);
  end if;

  -- SKIP LOCKED: two operators receiving the same order item at the same moment
  -- each claim a different physical unit instead of colliding.
  select * into v_unit from public.inventory_units
   where order_item_id = p_order_item_id and status = 'expected'
   order by unit_sequence
   for update skip locked
   limit 1;

  if v_unit.id is null then
    return jsonb_build_object(
      'ok', false, 'code', 'NO_UNIT_EXPECTED',
      'order_id', v_order.id, 'order_number', v_order.order_number
    );
  end if;

  update public.inventory_units
     set status = 'received',
         received_at = now(),
         last_stand_code = v_order.stand_code,
         matched_manually = p_manual
   where id = v_unit.id
   returning * into v_unit;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    raw_value, operator_session, stand_code, manual, reason, metadata,
    idempotency_key, device_type
  )
  values (
    v_unit.id, v_order.id, v_item.id,
    -- Existing vocabulary: 'received' for a supplier-label match,
    -- 'manual_check' when a human picked the association.
    case when p_manual then 'manual_check' else 'received' end,
    'success',
    nullif(p_raw_value, ''), nullif(p_operator, ''), v_order.stand_code,
    p_manual, nullif(p_reason, ''), p_metadata, nullif(p_idempotency_key, ''),
    case when p_manual then 'manual' else 'camera' end
  )
  returning id into v_scan_id;

  perform public.gorush_refresh_order_status(v_order.id, p_operator);

  select c.name into v_customer_name from public.customers c where c.id = v_order.customer_id;

  v_size := case
    when v_item.width is not null and v_item.aspect_ratio is not null and v_item.rim_diameter is not null
      then v_item.width || '/' || v_item.aspect_ratio || ' R' ||
           -- R18 rather than R18.0, but R17.5 keeps its decimal.
           case when v_item.rim_diameter = trunc(v_item.rim_diameter)
                then trunc(v_item.rim_diameter)::integer::text
                else v_item.rim_diameter::text end
    else ''
  end;

  v_product := coalesce(
    nullif(trim(coalesce(v_item.brand, '') || ' ' || coalesce(v_item.description, '')), ''),
    v_item.raw_description,
    'Produs'
  );

  -- label_data carries everything the Print Agent needs to render the exact
  -- label, and nothing sensitive: no payment amounts, no addresses, no keys.
  v_label := jsonb_build_object(
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'order_number', v_order.order_number,
    'stand_code', v_order.stand_code,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'product', v_product,
    'brand', coalesce(v_item.brand, ''),
    'size', v_size,
    'load_speed', trim(coalesce(v_item.load_index, '') || coalesce(v_item.speed_rating, '')),
    'unit_index', v_unit.unit_sequence,
    'unit_total', v_item.quantity,
    'item_type', v_item.item_type
  );

  -- print_jobs_open_unit_key makes this idempotent at the database level: if a
  -- pending/processing job already exists for this unit, keep it.
  insert into public.print_jobs (inventory_unit_id, order_id, print_type, label_data, status)
  values (v_unit.id, v_order.id, 'inventory_unit_label', v_label, 'pending')
  on conflict do nothing
  returning id into v_print_job_id;

  if v_print_job_id is null then
    select id into v_print_job_id from public.print_jobs
     where inventory_unit_id = v_unit.id order by created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'ok', true, 'code', 'RECEIVED',
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'stand_code', v_order.stand_code,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'product', v_product,
    'scan_id', v_scan_id,
    'print_job_id', v_print_job_id,
    'label_data', v_label
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_store_unit — the GoRush barcode scan that confirms storage
-- ---------------------------------------------------------------------------
create or replace function public.gorush_store_unit(
  p_unit_token text,
  p_operator text default null,
  p_zone_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_unit public.inventory_units;
  v_order public.orders;
  v_customer_name text;
  v_scan_type text := 'storage';
  v_result text := 'success';
  v_code text;
begin
  if nullif(p_idempotency_key, '') is not null
     and exists (select 1 from public.inventory_scans where idempotency_key = p_idempotency_key) then
    select u.* into v_unit from public.inventory_units u
      join public.inventory_scans s on s.inventory_unit_id = u.id
     where s.idempotency_key = p_idempotency_key limit 1;
    select * into v_order from public.orders where id = v_unit.order_id;
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_PROCESSED',
      'inventory_unit_id', v_unit.id, 'status', v_unit.status,
      'order_number', v_order.order_number, 'stand_code', v_order.stand_code
    );
  end if;

  select * into v_unit from public.inventory_units
   where qr_token = trim(p_unit_token) for update;

  if v_unit.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_unit.order_id;
  select c.name into v_customer_name from public.customers c where c.id = v_order.customer_id;

  if v_unit.status = 'stored' then
    -- Duplicate scan: record a harmless audit entry, corrupt nothing.
    v_scan_type := 'inventory_check';
    v_result := 'duplicate';
    v_code := 'ALREADY_STORED';
  elsif v_unit.status in ('loaded', 'out_for_delivery', 'delivered') then
    v_scan_type := 'inventory_check';
    v_result := 'duplicate';
    v_code := 'ALREADY_MOVED_ON';
  else
    update public.inventory_units
       set status = 'stored',
           stored_at = now(),
           last_stand_code = coalesce(v_order.stand_code, last_stand_code),
           current_zone_id = coalesce(p_zone_id, current_zone_id),
           -- A unit scanned straight to storage without a prior supplier-label
           -- match still gets a received timestamp.
           received_at = coalesce(received_at, now())
     where id = v_unit.id
     returning * into v_unit;
    v_code := 'STORED';
  end if;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    raw_value, operator_session, stand_code, warehouse_zone_id,
    idempotency_key, device_type
  )
  values (
    v_unit.id, v_unit.order_id, v_unit.order_item_id, v_scan_type, v_result,
    trim(p_unit_token), nullif(p_operator, ''), v_order.stand_code, p_zone_id,
    nullif(p_idempotency_key, ''), 'handheld_scanner'
  );

  if v_code = 'STORED' then
    perform public.gorush_refresh_order_status(v_order.id, p_operator);
  end if;

  return jsonb_build_object(
    'ok', v_code = 'STORED',
    'code', v_code,
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'status', v_unit.status,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'stand_code', v_order.stand_code,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'description', v_unit.description
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_load_unit — loading scan, with wrong-driver protection
-- ---------------------------------------------------------------------------
create or replace function public.gorush_load_unit(
  p_unit_token text,
  p_driver_id uuid,
  p_vehicle_id uuid default null,
  p_operator text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_unit public.inventory_units;
  v_order public.orders;
  v_customer_name text;
  v_code text;
  v_ok boolean := false;
  v_scan_type text := 'loading';
  v_result text := 'success';
begin
  if nullif(p_idempotency_key, '') is not null
     and exists (select 1 from public.inventory_scans where idempotency_key = p_idempotency_key) then
    select u.* into v_unit from public.inventory_units u
      join public.inventory_scans s on s.inventory_unit_id = u.id
     where s.idempotency_key = p_idempotency_key limit 1;
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_PROCESSED',
      'inventory_unit_id', v_unit.id, 'status', v_unit.status
    );
  end if;

  select * into v_unit from public.inventory_units
   where qr_token = trim(p_unit_token) for update;

  if v_unit.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_unit.order_id;
  select c.name into v_customer_name from public.customers c where c.id = v_order.customer_id;

  -- Order of checks matters: "this belongs to another delivery" is the more
  -- important thing to tell someone holding the wrong tyre, even if that tyre
  -- also happens to be already loaded.
  if v_order.status = 'cancelled' then
    v_code := 'ORDER_CANCELLED'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  elsif v_order.driver_id is distinct from p_driver_id then
    v_code := 'WRONG_DRIVER'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  elsif p_vehicle_id is not null and v_order.vehicle_id is not null
        and v_order.vehicle_id <> p_vehicle_id then
    v_code := 'WRONG_VEHICLE'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  elsif v_unit.status = 'loaded' then
    v_code := 'ALREADY_LOADED'; v_result := 'duplicate'; v_scan_type := 'inventory_check';
  elsif v_unit.status in ('out_for_delivery', 'delivered') then
    v_code := 'ALREADY_MOVED_ON'; v_result := 'duplicate'; v_scan_type := 'inventory_check';
  elsif v_unit.status not in ('stored', 'ready_for_loading') then
    -- Nothing gets on a van that the warehouse never checked in.
    v_code := 'NOT_STORED'; v_result := 'rejected'; v_scan_type := 'inventory_check';
  else
    update public.inventory_units
       set status = 'loaded',
           loaded_at = now(),
           last_vehicle_id = coalesce(p_vehicle_id, v_order.vehicle_id)
     where id = v_unit.id
     returning * into v_unit;
    v_code := 'LOADED';
    v_ok := true;
  end if;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    raw_value, driver_id, vehicle_id, operator_session, stand_code,
    idempotency_key, reason, device_type
  )
  values (
    v_unit.id, v_unit.order_id, v_unit.order_item_id, v_scan_type, v_result,
    trim(p_unit_token), p_driver_id, p_vehicle_id, nullif(p_operator, ''),
    v_order.stand_code, nullif(p_idempotency_key, ''),
    case when v_result <> 'success' then v_code else null end,
    'handheld_scanner'
  );

  if v_ok then
    perform public.gorush_refresh_order_status(v_order.id, p_operator);
  end if;

  return jsonb_build_object(
    'ok', v_ok, 'code', v_code,
    'inventory_unit_id', v_unit.id,
    'unit_token', v_unit.qr_token,
    'status', v_unit.status,
    'order_id', v_order.id,
    'order_number', v_order.order_number,
    'customer', coalesce(v_customer_name, v_order.delivery_name, ''),
    'description', v_unit.description,
    'stand_code', v_order.stand_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_manual_load_unit — exception path (damaged label, dead scanner)
-- ---------------------------------------------------------------------------
-- Recorded as scan_type 'manual_loading' with manual = true and a mandatory
-- reason, so it is never indistinguishable from a real barcode scan.
create or replace function public.gorush_manual_load_unit(
  p_inventory_unit_id uuid,
  p_driver_id uuid,
  p_vehicle_id uuid,
  p_reason text,
  p_operator text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_unit public.inventory_units;
  v_order public.orders;
begin
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'REASON_REQUIRED');
  end if;

  select * into v_unit from public.inventory_units where id = p_inventory_unit_id for update;
  if v_unit.id is null then
    return jsonb_build_object('ok', false, 'code', 'UNIT_NOT_FOUND');
  end if;

  select * into v_order from public.orders where id = v_unit.order_id;

  if v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;
  if v_unit.status = 'loaded' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_LOADED');
  end if;

  update public.inventory_units
     set status = 'loaded',
         loaded_at = now(),
         stored_at = coalesce(stored_at, now()),
         received_at = coalesce(received_at, now()),
         last_vehicle_id = coalesce(p_vehicle_id, v_order.vehicle_id)
   where id = v_unit.id
   returning * into v_unit;

  insert into public.inventory_scans (
    inventory_unit_id, order_id, order_item_id, scan_type, result,
    driver_id, vehicle_id, operator_session, manual, reason, device_type
  )
  values (
    v_unit.id, v_unit.order_id, v_unit.order_item_id, 'manual_loading', 'success',
    p_driver_id, p_vehicle_id, nullif(p_operator, ''), true, trim(p_reason), 'manual'
  );

  perform public.gorush_refresh_order_status(v_order.id, p_operator);

  return jsonb_build_object(
    'ok', true, 'code', 'LOADED',
    'inventory_unit_id', v_unit.id, 'status', v_unit.status,
    'order_number', v_order.order_number
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_claim_print_job — atomic single-job claim for the Print Agent
-- ---------------------------------------------------------------------------
-- FOR UPDATE SKIP LOCKED is what makes two agents on two machines safe: each
-- claims a different row, never the same one.
create or replace function public.gorush_claim_print_job(
  p_agent_id text,
  p_printer_name text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_job public.print_jobs;
begin
  select * into v_job from public.print_jobs
   where status = 'pending'
   order by created_at
   for update skip locked
   limit 1;

  if v_job.id is null then
    return jsonb_build_object('ok', true, 'code', 'NO_JOB');
  end if;

  update public.print_jobs
     set status = 'processing',
         claimed_by = nullif(p_agent_id, ''),
         claimed_at = now(),
         printer_name = coalesce(nullif(p_printer_name, ''), printer_name),
         attempts = attempts + 1
   where id = v_job.id
   returning * into v_job;

  return jsonb_build_object(
    'ok', true, 'code', 'CLAIMED',
    'job', jsonb_build_object(
      'id', v_job.id,
      'inventory_unit_id', v_job.inventory_unit_id,
      'order_id', v_job.order_id,
      'print_type', v_job.print_type,
      'label_data', v_job.label_data,
      'attempts', v_job.attempts
    )
  );
end;
$$;

create or replace function public.gorush_complete_print_job(
  p_job_id uuid,
  p_success boolean,
  p_error text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_exists boolean;
begin
  select true into v_exists from public.print_jobs where id = p_job_id for update;
  if v_exists is null then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;

  if p_success then
    update public.print_jobs
       set status = 'printed', printed_at = now(), error_message = null
     where id = p_job_id;
    return jsonb_build_object('ok', true, 'code', 'PRINTED');
  end if;

  -- Failure keeps the job recoverable: status 'failed' with the reason, ready
  -- for a manual retry. The label is never lost.
  update public.print_jobs
     set status = 'failed', error_message = left(coalesce(p_error, 'unknown error'), 1000)
   where id = p_job_id;
  return jsonb_build_object('ok', true, 'code', 'FAILED');
end;
$$;

create or replace function public.gorush_retry_print_job(p_job_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_status text;
begin
  select status into v_status from public.print_jobs where id = p_job_id for update;
  if v_status is null then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;
  if v_status = 'printed' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PRINTED');
  end if;

  -- A 'processing' job whose agent died is also retryable — that is the
  -- crashed-agent recovery path.
  update public.print_jobs
     set status = 'pending', claimed_by = null, claimed_at = null, error_message = null
   where id = p_job_id;

  return jsonb_build_object('ok', true, 'code', 'REQUEUED');
end;
$$;

create or replace function public.gorush_requeue_stale_print_jobs(
  p_stale_after interval default interval '5 minutes'
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with requeued as (
    update public.print_jobs
       set status = 'pending', claimed_by = null, claimed_at = null
     where status = 'processing' and claimed_at < now() - p_stale_after
    returning 1
  )
  select count(*) into v_count from requeued;
  return coalesce(v_count, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Defence in depth: no execute grants for browser-reachable roles.
-- ---------------------------------------------------------------------------
-- These functions are SECURITY INVOKER, so RLS already blocks anon even with the
-- default PUBLIC execute grant. Revoking anyway keeps the intent explicit and
-- survives someone later adding a permissive policy.
do $$
declare
  fn text;
begin
  for fn in
    select unnest(array[
      'gorush_create_order(jsonb)',
      'gorush_assign_stand(uuid, text, text)',
      'gorush_set_order_status(uuid, text, text, text, date)',
      'gorush_refresh_order_status(uuid, text)',
      'gorush_receive_unit(uuid, text, text, boolean, text, text, jsonb)',
      'gorush_store_unit(text, text, uuid, text)',
      'gorush_load_unit(text, uuid, uuid, text, text)',
      'gorush_manual_load_unit(uuid, uuid, uuid, text, text)',
      'gorush_claim_print_job(text, text)',
      'gorush_complete_print_job(uuid, boolean, text)',
      'gorush_retry_print_job(uuid)',
      'gorush_requeue_stale_print_jobs(interval)'
    ])
  loop
    begin
      execute format('revoke all on function public.%s from anon, authenticated', fn);
    exception
      when undefined_object then
        -- Roles don't exist outside a hosted Supabase project; harmless.
        null;
    end;
  end loop;
end;
$$;
