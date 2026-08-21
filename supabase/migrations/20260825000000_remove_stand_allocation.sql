-- ============================================================================
-- GoRush Logistics — Remove stand/stativ allocation
-- ============================================================================
-- Product decision: the temporary sorting-stand concept (A-E, assigned to an
-- active order) is removed from the active product entirely, and NOT
-- replaced with any other warehouse-location abstraction (no zones, shelves,
-- racks, bins, or QR locations). Order status alone tracks warehouse
-- progress now — see docs/LOGISTICS.md.
--
-- What this migration does, and why:
--
--   * gorush_create_order       — rewritten in place (create or replace) to
--     drop stand allocation while preserving every other atomic-transaction
--     guarantee (order + items + units + history in one transaction).
--   * gorush_set_order_status   — rewritten in place to drop the
--     restore-stand-on-reactivate branch; the two update branches were
--     already identical except for stand_code, so this collapses to one.
--   * gorush_assign_stand, gorush_stand_is_occupied, gorush_first_free_stand,
--     gorush_stand_holding_statuses — DROPPED. These existed only to
--     allocate/free/collision-check stands; nothing else in the schema calls
--     them (verified: the historical per-unit scan functions
--     gorush_receive_unit / gorush_store_unit / gorush_load_unit /
--     gorush_manual_load_unit read/write the stand_code columns directly,
--     never through these helpers).
--   * orders_active_stand_key, orders_stand_code_idx — DROPPED. These
--     indexes existed solely to enforce/serve stand allocation; dropping an
--     index never touches data, and nothing queries by stand_code anymore.
--   * orders.stand_code, inventory_units.last_stand_code,
--     inventory_scans.stand_code — KEPT. Historical order data should not
--     be destroyed because a feature was removed. These columns are marked
--     deprecated below (data dictionary comment); the application's
--     TypeScript layer already types them as plain `string | null` with
--     `@deprecated` JSDoc and no active code path reads or writes them.
--   * gorush_schema_health() — rewritten in place to drop gorush_assign_stand
--     from its expected-functions check (it no longer exists by design).
--
-- Safe to re-run: every function definition is `create or replace`; the
-- drops and comments below are all idempotent (`if exists`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- gorush_create_order — same atomicity guarantee, no stand allocation
-- ---------------------------------------------------------------------------
create or replace function public.gorush_create_order(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order_id uuid;
  v_order_number bigint;
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

  insert into public.orders (
    supplier_id, supplier_document_number, document_date, supplier_order_reference,
    document_type, source_type,
    customer_id, customer_location_id,
    delivery_name, delivery_address_line1, delivery_address_line2,
    delivery_postal_code, delivery_city, delivery_province, delivery_country_code,
    delivery_notes,
    planned_delivery_date, expected_at, driver_id, vehicle_id, status,
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

    -- One inventory_unit per physical object: quantity 4 => 4 rows. No
    -- ceiling of any kind on how many orders/units can exist concurrently —
    -- the removed stand system was the only artificial cap here.
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
    'inventory_unit_count', v_unit_count,
    'item_count', v_line
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- gorush_set_order_status — same signature/behaviour, no stand restore
-- ---------------------------------------------------------------------------
-- The two update branches in the prior version were identical except for
-- stand_code, so removing stand allocation collapses them into one.
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
begin
  select status into v_current
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

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (p_order_id, v_current, p_status, nullif(p_changed_by, ''), nullif(p_reason, ''));

  return jsonb_build_object(
    'ok', true, 'status', p_status, 'previous_status', v_current
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Drop stand-only functions — verified callers (see comment header above):
-- only gorush_create_order, gorush_set_order_status and gorush_assign_stand
-- itself ever called these, and the first two no longer do.
-- ---------------------------------------------------------------------------
drop function if exists public.gorush_assign_stand(uuid, text, text);
drop function if exists public.gorush_first_free_stand(uuid);
drop function if exists public.gorush_stand_is_occupied(text, uuid);
drop function if exists public.gorush_stand_holding_statuses();

-- ---------------------------------------------------------------------------
-- Drop stand-only indexes — indexes are derived structures, never data.
-- ---------------------------------------------------------------------------
drop index if exists public.orders_active_stand_key;
drop index if exists public.orders_stand_code_idx;

-- ---------------------------------------------------------------------------
-- Deprecation markers on the columns kept for historical data only.
-- ---------------------------------------------------------------------------
comment on column public.orders.stand_code is
  'DEPRECATED: stand/stativ allocation was removed from the active product. Historical value only — no active application code reads or writes this column.';
comment on column public.inventory_units.last_stand_code is
  'DEPRECATED: stand/stativ allocation was removed from the active product. Historical value only — no active application code reads or writes this column.';
comment on column public.inventory_scans.stand_code is
  'DEPRECATED: stand/stativ allocation was removed from the active product. Historical value only — no active application code reads or writes this column.';

-- ---------------------------------------------------------------------------
-- gorush_schema_health — drop the now-removed function from its own check
-- ---------------------------------------------------------------------------
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
    'gorush_create_order', 'gorush_set_order_status',
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
