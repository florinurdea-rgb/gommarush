-- Closes a real gap found while building the "Sumar" dashboard: nothing in
-- the app ever marked an order/unit as delivered — the flow stopped at
-- 'loaded'. Delivered-tyre counts and transport profit are meaningless
-- without a real delivery-confirmation step, so this adds one: the driver
-- taps "Marchează comanda ca livrată" once the customer has the goods.
--
-- SECURITY INVOKER by design (same posture as every RPC in
-- 20260817000100_logistics_phase1_functions.sql) — RLS still applies to the
-- caller, and execute is revoked from anon/authenticated below so this is
-- only reachable through the server's service-role client.
create or replace function public.gorush_deliver_order(
  p_order_id uuid, p_driver_id uuid, p_operator text default null
) returns jsonb language plpgsql as $$
declare
  v_order public.orders;
  v_total integer;
  v_loaded integer;
  v_delivered_now integer;
  v_target_status text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  if v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;
  if v_order.status in ('delivered', 'partially_delivered') then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DELIVERED');
  end if;
  if v_order.status not in ('loaded', 'partially_loaded', 'out_for_delivery') then
    return jsonb_build_object('ok', false, 'code', 'NOT_LOADED');
  end if;

  select count(*) into v_total from public.inventory_units where order_id = p_order_id;
  select count(*) into v_loaded from public.inventory_units
   where order_id = p_order_id and status = 'loaded';

  if v_loaded = 0 then
    return jsonb_build_object('ok', false, 'code', 'NOT_LOADED');
  end if;

  update public.inventory_units
     set status = 'delivered', delivered_at = now()
   where order_id = p_order_id and status = 'loaded';
  get diagnostics v_delivered_now = row_count;

  v_target_status := case when v_loaded = v_total then 'delivered' else 'partially_delivered' end;

  update public.orders
     set status = v_target_status,
         delivered_at = case when delivered_at is null then now() else delivered_at end
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by_label, notes)
  values (p_order_id, v_order.status, v_target_status, nullif(p_operator, ''), 'delivery_confirmed');

  return jsonb_build_object(
    'ok', true, 'code', 'DELIVERED', 'status', v_target_status,
    'delivered_units', v_delivered_now, 'total_units', v_total
  );
end;
$$;

do $$
begin
  begin
    execute 'revoke all on function public.gorush_deliver_order(uuid, uuid, text) from anon, authenticated';
  exception when undefined_object then null;
  end;
end;
$$;
