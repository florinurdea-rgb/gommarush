-- ---------------------------------------------------------------------------
-- gorush_deliver_order — Phase 1 order-level delivery confirmation
-- ---------------------------------------------------------------------------
-- SUPERSEDES an earlier draft of this migration that was never applied to
-- any environment (confirmed via `list_migrations` before this file was
-- rewritten — safe to edit in place rather than leaving dead SQL in the
-- repo). The original version looped over `inventory_units` to decide
-- delivered vs partially_delivered. Phase 1 deliberately removes individual
-- tyre scanning from the active workflow (see the GommaRush Phase 1
-- stabilisation brief, §0/§3): a driver delivers a customer's whole ORDER
-- in one tap, not one tyre at a time, and `orders.status` is now the sole
-- source of truth for the operational flow. `inventory_units` rows still
-- exist (created by gorush_create_order for label-printing/historical
-- purposes) but are neither read nor written by this function, so they can
-- never disagree with the order.
--
-- SECURITY INVOKER by design (same posture as every RPC in this project) —
-- RLS still applies to the caller, and execute is revoked from
-- anon/authenticated below so this is only reachable through the server's
-- service-role client.
create or replace function public.gorush_deliver_order(
  p_order_id uuid,
  p_driver_id uuid,
  p_operator text default null,
  p_amount_collected numeric default null,
  p_payment_method text default null
) returns jsonb language plpgsql as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  end if;
  -- A null p_driver_id means an admin/warehouse-initiated delivery (the
  -- Livrări board's own "Marchează livrată" action), which is exempt from
  -- the wrong-driver check by design. A non-null p_driver_id (the driver
  -- app) must always match the order's assigned driver.
  if p_driver_id is not null and v_order.driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok', false, 'code', 'WRONG_DRIVER');
  end if;

  -- Idempotent: a double tap (or a retried request after a dropped
  -- response) must return the existing successful state, never error and
  -- never record a second delivery event.
  if v_order.status = 'delivered' then
    return jsonb_build_object(
      'ok', true, 'code', 'ALREADY_DELIVERED',
      'status', v_order.status, 'delivered_at', v_order.delivered_at
    );
  end if;

  if v_order.status not in ('loaded', 'out_for_delivery') then
    return jsonb_build_object('ok', false, 'code', 'NOT_LOADED', 'status', v_order.status);
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         amount_collected = coalesce(p_amount_collected, amount_collected),
         payment_method = coalesce(nullif(p_payment_method, ''), payment_method),
         payment_status = case
           when p_amount_collected is not null then 'collected'
           else payment_status
         end,
         payment_collected_at = case
           when p_amount_collected is not null then now()
           else payment_collected_at
         end
   where id = p_order_id;

  insert into public.order_status_history (order_id, old_status, new_status, changed_by, changed_by_label, notes)
  values (p_order_id, v_order.status, 'delivered', p_driver_id, nullif(p_operator, ''), 'delivery_confirmed');

  return jsonb_build_object('ok', true, 'code', 'DELIVERED', 'status', 'delivered', 'delivered_at', now());
end;
$$;

do $$
begin
  begin
    execute 'revoke all on function public.gorush_deliver_order(uuid, uuid, text, numeric, text) from anon, authenticated';
  exception when undefined_object then null;
  end;
end;
$$;
