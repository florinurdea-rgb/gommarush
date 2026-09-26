-- ============================================================================
-- GommaRush Phase 1 stabilisation — order-level dispatch RPC test
-- ============================================================================
-- Exercises the RPCs added by supabase/migrations/20260822000000_deliver_order.sql
-- (rewritten) and 20260824000000_phase1_stabilization.sql: the scan-free,
-- order-level load/deliver/delivery-failed flow. Complements
-- supabase/tests/logistics_phase1_flow.sql, which still covers the
-- historical unit-scan RPCs (left in the schema, no longer called by the
-- active application).
--
-- Every check raises an exception on failure, so the script either runs to
-- completion or stops at the first broken invariant.
--
-- HOW TO RUN
--   Against a scratch database (recommended — it writes test rows):
--     createdb gorush_test
--     psql -d gorush_test -f supabase/migrations/20260817000000_logistics_phase1_schema.sql
--     psql -d gorush_test -f supabase/migrations/20260817000100_logistics_phase1_functions.sql
--     psql -d gorush_test -f supabase/migrations/20260818000000_vehicle_board.sql
--     psql -d gorush_test -f supabase/migrations/20260819000000_ddt_import_system.sql
--     psql -d gorush_test -f supabase/migrations/20260820000000_geocode_cache.sql
--     psql -d gorush_test -f supabase/migrations/20260821000000_depot_location.sql
--     psql -d gorush_test -f supabase/migrations/20260822000000_deliver_order.sql
--     psql -d gorush_test -f supabase/migrations/20260823000000_fleet_management.sql
--     psql -d gorush_test -f supabase/migrations/20260824000000_phase1_stabilization.sql
--     psql -d gorush_test -v ON_ERROR_STOP=1 -f supabase/tests/phase1_stabilization_flow.sql
--
--   Do NOT run this against production: it inserts orders and vehicles.
-- ============================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_supplier uuid;
  v_customer uuid;
  v_location uuid;
  v_driver1 uuid;
  v_driver2 uuid;
  v_van1 uuid;
  v_van2 uuid;
  v_result jsonb;
  v_order uuid;
  v_status text;
  v_history_count integer;
  v_health jsonb;
begin
  raise notice '--- setup ---';

  insert into public.suppliers (name, vat_number)
  values ('Pneus Test SRL', 'IT' || substr(md5(random()::text), 1, 9))
  returning id into v_supplier;

  insert into public.customers (name, vat_number)
  values ('Rossi Gomme Test SRL', 'IT' || substr(md5(random()::text), 1, 9))
  returning id into v_customer;

  insert into public.customer_locations (customer_id, location_name, city, province, address_line1, postal_code)
  values (v_customer, 'Filiala Vicenza', 'Vicenza', 'VI', 'Via Roma 12', '36100')
  returning id into v_location;

  insert into public.drivers (name, slug) values ('Test Driver 1', 'p1-driver-1-' || substr(md5(random()::text), 1, 6)) returning id into v_driver1;
  insert into public.drivers (name, slug) values ('Test Driver 2', 'p1-driver-2-' || substr(md5(random()::text), 1, 6)) returning id into v_driver2;
  insert into public.vehicles (name, slug) values ('Test Van 1', 'p1-van-1-' || substr(md5(random()::text), 1, 6)) returning id into v_van1;
  insert into public.vehicles (name, slug) values ('Test Van 2', 'p1-van-2-' || substr(md5(random()::text), 1, 6)) returning id into v_van2;

  -- ------------------------------------------------------------------
  raise notice '--- 1. create order: 4 tyres, no scanning involved ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_create_order(jsonb_build_object(
    'supplier_id', v_supplier,
    'supplier_document_number', 'FT-P1-001',
    'customer_id', v_customer,
    'customer_location_id', v_location,
    'delivery_city', 'Vicenza',
    'planned_delivery_date', current_date::text,
    'status', 'stored',
    'requires_payment_on_delivery', true,
    'amount_to_collect', '420.00',
    'created_by', 'test',
    'items', jsonb_build_array(
      jsonb_build_object(
        'item_type', 'tyre', 'brand', 'Michelin', 'description', 'Primacy 4',
        'width', 225, 'aspect_ratio', 45, 'rim_diameter', 17,
        'quantity', 4, 'unit_price', 112.50
      )
    )
  ));
  v_order := (v_result->>'order_id')::uuid;
  if v_order is null then raise exception 'FAIL: order not created (%)', v_result; end if;

  -- ------------------------------------------------------------------
  raise notice '--- 2. gorush_mark_order_loaded: rejects with no vehicle ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_mark_order_loaded(v_order, null, 'test');
  if (v_result->>'ok')::boolean is not false or v_result->>'code' <> 'NO_VEHICLE' then
    raise exception 'FAIL: expected NO_VEHICLE, got %', v_result;
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 3. gorush_mark_order_loaded: succeeds once a van is passed ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_mark_order_loaded(v_order, v_van1, 'test');
  if (v_result->>'ok')::boolean is not true or v_result->>'code' <> 'LOADED' then
    raise exception 'FAIL: expected LOADED, got %', v_result;
  end if;
  select status into v_status from public.orders where id = v_order;
  if v_status <> 'loaded' then raise exception 'FAIL: order status is % not loaded', v_status; end if;

  -- ------------------------------------------------------------------
  raise notice '--- 4. gorush_mark_order_loaded: idempotent (double tap is safe) ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_mark_order_loaded(v_order, v_van1, 'test');
  if (v_result->>'ok')::boolean is not true or v_result->>'code' <> 'ALREADY_LOADED' then
    raise exception 'FAIL: expected ALREADY_LOADED on retry, got %', v_result;
  end if;
  select count(*) into v_history_count from public.order_status_history where order_id = v_order and notes = 'marked_loaded';
  if v_history_count <> 1 then
    raise exception 'FAIL: expected exactly 1 marked_loaded history row after a duplicate tap, got %', v_history_count;
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 5. gorush_deliver_order: wrong driver is rejected ---';
  -- ------------------------------------------------------------------
  update public.orders set driver_id = v_driver1 where id = v_order;
  v_result := public.gorush_deliver_order(v_order, v_driver2, 'test', null, null);
  if (v_result->>'ok')::boolean is not false or v_result->>'code' <> 'WRONG_DRIVER' then
    raise exception 'FAIL: expected WRONG_DRIVER, got %', v_result;
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 6. gorush_deliver_order: correct driver + COD succeeds ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_deliver_order(v_order, v_driver1, 'test', 420.00, 'cash');
  if (v_result->>'ok')::boolean is not true or v_result->>'code' <> 'DELIVERED' then
    raise exception 'FAIL: expected DELIVERED, got %', v_result;
  end if;
  select status into v_status from public.orders where id = v_order;
  if v_status <> 'delivered' then raise exception 'FAIL: order status is % not delivered', v_status; end if;
  if not exists (
    select 1 from public.orders
     where id = v_order and amount_collected = 420.00 and payment_status = 'collected' and payment_method = 'cash'
  ) then
    raise exception 'FAIL: COD amount/method/status not recorded on delivery';
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 7. gorush_deliver_order: idempotent (double tap is safe) ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_deliver_order(v_order, v_driver1, 'test', null, null);
  if (v_result->>'ok')::boolean is not true or v_result->>'code' <> 'ALREADY_DELIVERED' then
    raise exception 'FAIL: expected ALREADY_DELIVERED on retry, got %', v_result;
  end if;
  select count(*) into v_history_count from public.order_status_history where order_id = v_order and notes = 'delivery_confirmed';
  if v_history_count <> 1 then
    raise exception 'FAIL: expected exactly 1 delivery_confirmed history row after a duplicate tap, got %', v_history_count;
  end if;
  -- The retry must not have clobbered the real amount already recorded.
  if not exists (select 1 from public.orders where id = v_order and amount_collected = 420.00) then
    raise exception 'FAIL: a no-op retry with null amount overwrote the real collected amount';
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 8. gorush_mark_delivery_failed: a second order, admin-initiated ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_create_order(jsonb_build_object(
    'supplier_id', v_supplier, 'supplier_document_number', 'FT-P1-002',
    'customer_id', v_customer, 'customer_location_id', v_location,
    'delivery_city', 'Vicenza', 'status', 'loaded', 'vehicle_id', v_van2, 'created_by', 'test',
    'items', jsonb_build_array(jsonb_build_object('item_type', 'tyre', 'description', 'Test', 'quantity', 2))
  ));
  v_order := (v_result->>'order_id')::uuid;

  -- Reason is mandatory.
  v_result := public.gorush_mark_delivery_failed(v_order, null, 'admin:test', '');
  if (v_result->>'ok')::boolean is not false or v_result->>'code' <> 'REASON_REQUIRED' then
    raise exception 'FAIL: expected REASON_REQUIRED, got %', v_result;
  end if;

  v_result := public.gorush_mark_delivery_failed(v_order, null, 'admin:test', 'client închis');
  if (v_result->>'ok')::boolean is not true or v_result->>'code' <> 'DELIVERY_FAILED' then
    raise exception 'FAIL: expected DELIVERY_FAILED, got %', v_result;
  end if;
  if not exists (
    select 1 from public.orders
     where id = v_order and status = 'on_hold' and status_before_hold = 'loaded'
       and delivery_failure_reason = 'client închis' and delivery_failed_at is not null
  ) then
    raise exception 'FAIL: delivery-failed exception state not recorded correctly';
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 9. gorush_schema_health reports everything present ---';
  -- ------------------------------------------------------------------
  v_health := public.gorush_schema_health();
  if (v_health->>'ok')::boolean is not true then
    raise exception 'FAIL: gorush_schema_health() reports drift: %', v_health;
  end if;

  raise notice '--- ALL PHASE 1 STABILISATION CHECKS PASSED ---';
end;
$$;
