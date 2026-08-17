-- ============================================================================
-- GoRush Logistics Phase 1 — end-to-end database flow test
-- ============================================================================
-- Exercises the whole physical chain through the real RPCs:
--   create order -> inventory units generated -> supplier label match ->
--   print job queued -> print job claimed -> GoRush barcode stored ->
--   wrong-driver load rejected -> correct load -> progress
-- plus the negative paths: stand collision, duplicate scans, hold/reactivate.
--
-- Every check raises an exception on failure, so the script either runs to
-- completion or stops at the first broken invariant.
--
-- HOW TO RUN
--   Against a scratch database (recommended — it writes test rows):
--     createdb gorush_test
--     # the pre-existing logistics schema must already be present
--     psql -d gorush_test -f supabase/migrations/20260817000000_logistics_phase1_schema.sql
--     psql -d gorush_test -f supabase/migrations/20260817000100_logistics_phase1_functions.sql
--     psql -d gorush_test -v ON_ERROR_STOP=1 -f supabase/tests/logistics_phase1_flow.sql
--
--   Do NOT run this against production: it inserts orders and consumes stands.
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
  v_order1 uuid;
  v_order2 uuid;
  v_tyre_item uuid;
  v_unit_count integer;
  v_token text;
  v_claim jsonb;
  v_stored integer;
  v_scan_count integer;
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

  insert into public.drivers (name, slug) values ('Test Driver 1', 'test-driver-1-' || substr(md5(random()::text), 1, 6)) returning id into v_driver1;
  insert into public.drivers (name, slug) values ('Test Driver 2', 'test-driver-2-' || substr(md5(random()::text), 1, 6)) returning id into v_driver2;
  insert into public.vehicles (name, slug) values ('Test Van 1', 'test-van-1-' || substr(md5(random()::text), 1, 6)) returning id into v_van1;
  insert into public.vehicles (name, slug) values ('Test Van 2', 'test-van-2-' || substr(md5(random()::text), 1, 6)) returning id into v_van2;

  -- ------------------------------------------------------------------
  raise notice '--- 1. create order: 4 tyres + 2 tubes + 1 fee line ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_create_order(jsonb_build_object(
    'supplier_id', v_supplier,
    'supplier_document_number', 'FT-9911',
    'customer_id', v_customer,
    'customer_location_id', v_location,
    'delivery_city', 'Vicenza',
    'planned_delivery_date', current_date::text,
    'auto_allocate_stand', true,
    'driver_id', v_driver1,
    'vehicle_id', v_van1,
    'created_by', 'test',
    'items', jsonb_build_array(
      jsonb_build_object(
        'item_type', 'tyre', 'brand', 'Michelin', 'description', 'Primacy 4',
        'width', 225, 'aspect_ratio', 55, 'rim_diameter', 18,
        'load_index', '98', 'speed_rating', 'V', 'quantity', 4, 'unit_price', 112.50
      ),
      jsonb_build_object('item_type', 'tube', 'description', 'Camera aer 15"', 'quantity', 2),
      jsonb_build_object('item_type', 'fee', 'description', 'PFU', 'quantity', 1, 'unit_price', 2.61)
    )
  ));

  v_order1 := (v_result->>'order_id')::uuid;
  if v_order1 is null then raise exception 'FAIL: order not created (%)', v_result; end if;

  -- Stand A is the first free stand on a clean database.
  if (v_result->>'stand_code') is null then
    raise exception 'FAIL: no stand allocated (%)', v_result;
  end if;
  raise notice 'order GR-% on stand %', lpad(v_result->>'order_number', 3, '0'), v_result->>'stand_code';

  -- 4 tyres + 2 tubes = 6 physical units. The fee line must NOT produce one.
  select count(*) into v_unit_count from public.inventory_units where order_id = v_order1;
  if v_unit_count <> 6 then
    raise exception 'FAIL: expected 6 inventory units, got %', v_unit_count;
  end if;
  if (v_result->>'inventory_unit_count')::integer <> 6 then
    raise exception 'FAIL: rpc reported % units', v_result->>'inventory_unit_count';
  end if;

  if exists (
    select 1 from public.inventory_units u
      join public.order_items i on i.id = u.order_item_id
     where u.order_id = v_order1 and i.item_type = 'fee'
  ) then
    raise exception 'FAIL: a fee line generated inventory units';
  end if;

  -- Every unit must have a distinct, non-sequential token.
  if (select count(distinct qr_token) from public.inventory_units where order_id = v_order1) <> 6 then
    raise exception 'FAIL: unit tokens are not unique';
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 2. stand collision: a second order cannot take the same stand ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_create_order(jsonb_build_object(
    'supplier_id', v_supplier,
    'customer_id', v_customer,
    'stand_code', (select stand_code from public.orders where id = v_order1),
    'driver_id', v_driver2,
    'vehicle_id', v_van2,
    'items', jsonb_build_array(
      jsonb_build_object('item_type', 'tyre', 'brand', 'Pirelli', 'description', 'P Zero',
                         'width', 245, 'aspect_ratio', 40, 'rim_diameter', 19, 'quantity', 2)
    )
  ));
  v_order2 := (v_result->>'order_id')::uuid;

  if (v_result->>'stand_warning') is distinct from 'STAND_OCCUPIED' then
    raise exception 'FAIL: expected STAND_OCCUPIED warning, got %', v_result;
  end if;
  if (v_result->>'stand_code') is not null then
    raise exception 'FAIL: occupied stand was silently reused';
  end if;
  raise notice 'second order created unassigned, warning=%', v_result->>'stand_warning';

  -- Manual resolution onto a genuinely free stand works.
  v_result := public.gorush_assign_stand(v_order2, 'D', 'test');
  if not (v_result->>'ok')::boolean then raise exception 'FAIL: manual stand assign: %', v_result; end if;

  -- ...but onto the occupied one it does not.
  v_result := public.gorush_assign_stand(v_order2, (select stand_code from public.orders where id = v_order1), 'test');
  if (v_result->>'code') is distinct from 'STAND_OCCUPIED' then
    raise exception 'FAIL: manual assign onto occupied stand should fail: %', v_result;
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 3. supplier label match -> received + print job ---';
  -- ------------------------------------------------------------------
  select id into v_tyre_item from public.order_items
   where order_id = v_order1 and item_type = 'tyre' limit 1;

  v_result := public.gorush_receive_unit(
    v_tyre_item, 'MICHELIN 225/55 R18 98V', 'test-operator', false, null, 'idem-recv-1'
  );
  if not (v_result->>'ok')::boolean then raise exception 'FAIL: receive: %', v_result; end if;
  if (v_result->>'code') <> 'RECEIVED' then raise exception 'FAIL: receive code %', v_result; end if;
  if (v_result->>'print_job_id') is null then raise exception 'FAIL: no print job queued'; end if;
  if (v_result->'label_data'->>'stand_code') is null then raise exception 'FAIL: label has no stand'; end if;
  if (v_result->'label_data'->>'size') <> '225/55 R18' then
    raise exception 'FAIL: label size formatted as "%"', v_result->'label_data'->>'size';
  end if;
  v_token := v_result->>'unit_token';
  raise notice 'received unit % (stand %), label size %',
    v_token, v_result->>'stand_code', v_result->'label_data'->>'size';

  -- Unit is 'received', NOT 'stored' — storage is confirmed by barcode later.
  if (select status from public.inventory_units where qr_token = v_token) <> 'received' then
    raise exception 'FAIL: unit should be received, not stored';
  end if;

  -- Order rolled expected -> partially_received on the first physical unit
  -- ('partially_received' is the existing vocabulary's precise value).
  if (select status from public.orders where id = v_order1) <> 'partially_received' then
    raise exception 'FAIL: order status did not follow first received unit (got %)',
      (select status from public.orders where id = v_order1);
  end if;

  -- Idempotency: replaying the same key must not consume a second unit.
  v_result := public.gorush_receive_unit(
    v_tyre_item, 'MICHELIN 225/55 R18 98V', 'test-operator', false, null, 'idem-recv-1'
  );
  if (v_result->>'code') <> 'ALREADY_PROCESSED' then
    raise exception 'FAIL: replayed receive was not idempotent: %', v_result;
  end if;
  if (select count(*) from public.inventory_units where order_id = v_order1 and status = 'received') <> 1 then
    raise exception 'FAIL: replay consumed an extra physical unit';
  end if;

  -- Exhausting the line: 3 more tyres expected, then no more.
  perform public.gorush_receive_unit(v_tyre_item, null, 'test-operator', false, null, 'idem-recv-2');
  perform public.gorush_receive_unit(v_tyre_item, null, 'test-operator', false, null, 'idem-recv-3');
  perform public.gorush_receive_unit(v_tyre_item, null, 'test-operator', false, null, 'idem-recv-4');
  v_result := public.gorush_receive_unit(v_tyre_item, null, 'test-operator', false, null, 'idem-recv-5');
  if (v_result->>'code') <> 'NO_UNIT_EXPECTED' then
    raise exception 'FAIL: over-receiving should report NO_UNIT_EXPECTED, got %', v_result;
  end if;
  raise notice 'over-receive correctly refused';

  -- One print job per physical unit, none duplicated.
  if (select count(*) from public.print_jobs where order_id = v_order1) <> 4 then
    raise exception 'FAIL: expected 4 print jobs, got %',
      (select count(*) from public.print_jobs where order_id = v_order1);
  end if;

  -- ------------------------------------------------------------------
  raise notice '--- 4. print job claim is atomic and single-consumer ---';
  -- ------------------------------------------------------------------
  v_claim := public.gorush_claim_print_job('agent-a', 'Toshiba-Test');
  if (v_claim->>'code') <> 'CLAIMED' then raise exception 'FAIL: claim: %', v_claim; end if;
  if (v_claim->'job'->'label_data'->>'unit_token') is null then
    raise exception 'FAIL: claimed job carries no unit token';
  end if;
  -- label_data must not leak payment/secret material.
  if v_claim->'job'->'label_data' ? 'amount_to_collect'
     or v_claim->'job'->'label_data' ? 'service_role_key' then
    raise exception 'FAIL: label_data contains sensitive fields';
  end if;

  -- A second claim gets a DIFFERENT job, never the same one.
  if (public.gorush_claim_print_job('agent-b')->'job'->>'id') = (v_claim->'job'->>'id') then
    raise exception 'FAIL: two agents claimed the same print job';
  end if;

  perform public.gorush_complete_print_job((v_claim->'job'->>'id')::uuid, true);
  if (select status from public.print_jobs where id = (v_claim->'job'->>'id')::uuid) <> 'printed' then
    raise exception 'FAIL: completed job not marked printed';
  end if;

  -- Failure keeps the label recoverable, and retry re-queues it.
  v_claim := public.gorush_claim_print_job('agent-a');
  perform public.gorush_complete_print_job((v_claim->'job'->>'id')::uuid, false, 'printer offline');
  if (select status from public.print_jobs where id = (v_claim->'job'->>'id')::uuid) <> 'failed' then
    raise exception 'FAIL: failed job not marked failed';
  end if;
  perform public.gorush_retry_print_job((v_claim->'job'->>'id')::uuid);
  if (select status from public.print_jobs where id = (v_claim->'job'->>'id')::uuid) <> 'pending' then
    raise exception 'FAIL: retry did not requeue the job';
  end if;
  raise notice 'print job claim / complete / fail / retry all behave';

  -- ------------------------------------------------------------------
  raise notice '--- 5. GoRush barcode scan -> stored (and duplicate safety) ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_store_unit(v_token, 'warehouse-1', null, 'idem-store-1');
  if (v_result->>'code') <> 'STORED' then raise exception 'FAIL: store: %', v_result; end if;
  if (select status from public.inventory_units where qr_token = v_token) <> 'stored' then
    raise exception 'FAIL: unit not stored';
  end if;

  -- Re-scanning an already stored item must not corrupt state.
  v_result := public.gorush_store_unit(v_token, 'warehouse-1');
  if (v_result->>'code') <> 'ALREADY_STORED' then
    raise exception 'FAIL: duplicate store should report ALREADY_STORED, got %', v_result;
  end if;
  if (v_result->>'ok')::boolean then raise exception 'FAIL: duplicate store reported success'; end if;

  -- ...but it does leave a harmless audit scan.
  select count(*) into v_scan_count from public.inventory_scans
   where inventory_unit_id = (select id from public.inventory_units where qr_token = v_token)
     and result = 'duplicate';
  if v_scan_count < 1 then raise exception 'FAIL: duplicate store left no audit scan'; end if;

  -- Unknown token is refused rather than inventing a unit.
  if (public.gorush_store_unit('GRUdoesnotexist')->>'code') <> 'UNIT_NOT_FOUND' then
    raise exception 'FAIL: unknown token was not refused';
  end if;
  raise notice 'storage scan + duplicate + unknown-token paths all behave';

  -- ------------------------------------------------------------------
  raise notice '--- 6. loading: wrong driver rejected, right driver accepted ---';
  -- ------------------------------------------------------------------
  -- Driver 2 tries to load an item belonging to Driver 1's order.
  v_result := public.gorush_load_unit(v_token, v_driver2, v_van2, 'driver2-session');
  if (v_result->>'code') <> 'WRONG_DRIVER' then
    raise exception 'FAIL: wrong-driver load not rejected: %', v_result;
  end if;
  if (v_result->>'ok')::boolean then raise exception 'FAIL: wrong-driver load reported success'; end if;
  if (select status from public.inventory_units where qr_token = v_token) <> 'stored' then
    raise exception 'FAIL: rejected load changed the unit status';
  end if;
  if not exists (
    select 1 from public.inventory_scans
     where inventory_unit_id = (select id from public.inventory_units where qr_token = v_token)
       and result = 'rejected' and reason = 'WRONG_DRIVER'
  ) then
    raise exception 'FAIL: wrong-driver attempt left no audit trail';
  end if;

  -- The correct driver can load it.
  v_result := public.gorush_load_unit(v_token, v_driver1, v_van1, 'driver1-session', 'idem-load-1');
  if (v_result->>'code') <> 'LOADED' then raise exception 'FAIL: load: %', v_result; end if;
  if (select status from public.inventory_units where qr_token = v_token) <> 'loaded' then
    raise exception 'FAIL: unit not loaded';
  end if;

  -- Double-scanning during loading is harmless.
  if (public.gorush_load_unit(v_token, v_driver1, v_van1)->>'code') <> 'ALREADY_LOADED' then
    raise exception 'FAIL: duplicate load not detected';
  end if;

  -- An item that was never stored cannot be loaded.
  select qr_token into v_token from public.inventory_units
   where order_id = v_order1 and status = 'received' limit 1;
  if v_token is not null then
    if (public.gorush_load_unit(v_token, v_driver1, v_van1)->>'code') <> 'NOT_STORED' then
      raise exception 'FAIL: loading a never-stored unit was allowed';
    end if;
  end if;
  raise notice 'loading protections all behave';

  -- ------------------------------------------------------------------
  raise notice '--- 7. manual loading override is auditable ---';
  -- ------------------------------------------------------------------
  v_result := public.gorush_manual_load_unit(
    (select id from public.inventory_units where order_id = v_order1 and status = 'received' limit 1),
    v_driver1, v_van1, null, 'driver1-session'
  );
  if (v_result->>'code') <> 'REASON_REQUIRED' then
    raise exception 'FAIL: manual override without a reason was allowed: %', v_result;
  end if;

  v_result := public.gorush_manual_load_unit(
    (select id from public.inventory_units where order_id = v_order1 and status = 'received' limit 1),
    v_driver1, v_van1, 'Etichetă deteriorată', 'driver1-session'
  );
  if (v_result->>'code') <> 'LOADED' then raise exception 'FAIL: manual override: %', v_result; end if;
  if not exists (
    select 1 from public.inventory_scans
     where scan_type = 'manual_loading' and manual = true and reason is not null
  ) then
    raise exception 'FAIL: manual override is indistinguishable from a real scan';
  end if;
  raise notice 'manual override recorded as manual with a reason';

  -- ------------------------------------------------------------------
  raise notice '--- 8. progress + hold/reactivate + cancel ---';
  -- ------------------------------------------------------------------
  select count(*) into v_stored from public.inventory_units
   where order_id = v_order1 and status in ('stored', 'loaded');
  raise notice 'order progress: %/6 stored-or-loaded', v_stored;

  -- Hold remembers where the order came from...
  v_result := public.gorush_set_order_status(v_order2, 'on_hold', 'client indisponibil', 'test');
  if not (v_result->>'ok')::boolean then raise exception 'FAIL: hold: %', v_result; end if;
  if (select status from public.orders where id = v_order2) <> 'on_hold' then
    raise exception 'FAIL: order not on hold';
  end if;
  if (select status_before_hold from public.orders where id = v_order2) <> 'expected' then
    raise exception 'FAIL: pre-hold status not remembered';
  end if;

  -- ...and holding frees the stand for someone else.
  if public.gorush_stand_is_occupied('D') then
    raise exception 'FAIL: stand D still occupied by a held order';
  end if;

  -- Reactivation restores it, with a new planned date.
  v_result := public.gorush_set_order_status(
    v_order2, 'expected', 'reactivat', 'test', (current_date + 1)
  );
  if not (v_result->>'ok')::boolean then raise exception 'FAIL: reactivate: %', v_result; end if;
  if (select status from public.orders where id = v_order2) <> 'expected' then
    raise exception 'FAIL: order not reactivated';
  end if;
  if (select planned_delivery_date from public.orders where id = v_order2) <> current_date + 1 then
    raise exception 'FAIL: reactivation did not apply the new delivery date';
  end if;
  if (select stand_code from public.orders where id = v_order2) <> 'D' then
    raise exception 'FAIL: reactivation did not restore stand D';
  end if;

  -- Cancel ("Delete" in the Admin UI) preserves everything underneath.
  v_result := public.gorush_set_order_status(v_order2, 'cancelled', 'test cancel', 'test');
  if (select status from public.orders where id = v_order2) <> 'cancelled' then
    raise exception 'FAIL: order not cancelled';
  end if;
  if (select count(*) from public.order_items where order_id = v_order2) = 0 then
    raise exception 'FAIL: cancellation destroyed order items';
  end if;
  if (select count(*) from public.inventory_units where order_id = v_order2) = 0 then
    raise exception 'FAIL: cancellation destroyed inventory units';
  end if;
  if (select count(*) from public.order_status_history where order_id = v_order2) < 3 then
    raise exception 'FAIL: status history incomplete';
  end if;
  raise notice 'hold / reactivate / cancel all preserve history';

  raise notice '';
  raise notice '===============================';
  raise notice ' ALL PHASE 1 FLOW CHECKS PASSED';
  raise notice '===============================';
end;
$$;
