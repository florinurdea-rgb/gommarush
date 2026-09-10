-- Fleet management: vehicles are no longer assumed to always be exactly
-- "Van 1, Van 2, Van 3" — the Livrări board now needs to add/rename/remove
-- vans, keep the configuration persistent, and reorder the Kanban lanes.
--
-- display_order: nullable int controlling Kanban lane order (and the fleet
-- management list order). NULL sorts after everything with a real value —
-- existing vehicles are backfilled below by their current name order so
-- nothing visibly reshuffles on deploy.
--
-- color_key: a small fixed palette used only for a subtle header accent (per
-- the redesign brief — never a saturated column background). Checked against
-- a short enum rather than a free-text hex so the UI palette stays curated.
alter table public.vehicles add column if not exists display_order integer;
alter table public.vehicles add column if not exists color_key text;

alter table public.vehicles drop constraint if exists vehicles_color_key_chk;
alter table public.vehicles
  add constraint vehicles_color_key_chk
  check (color_key is null or color_key in ('blue', 'purple', 'teal', 'indigo', 'slate', 'cyan', 'rose', 'amber'));

with ordered as (
  select id, row_number() over (order by name) as rn
  from public.vehicles
  where display_order is null
)
update public.vehicles v
   set display_order = ordered.rn
  from ordered
 where v.id = ordered.id;

create index if not exists vehicles_display_order_idx on public.vehicles(display_order);

-- Safe vehicle removal (redesign brief §17-22): a van with active orders
-- assigned to it must not be silently deleted, must not orphan those orders,
-- and must not touch orders that have already finished (delivered/cancelled/
-- returned) — those keep their vehicle_id forever so historical Sumar
-- reporting ("Van 2 delivered 142 tyres last month") still works after the
-- van is removed from active planning. Removal is a soft deactivate
-- (active = false), never a hard delete, for the same historical-reporting
-- reason — and because orders.vehicle_id / inventory_units.last_vehicle_id
-- both reference vehicles(id) with no cascading delete configured.
--
-- SECURITY INVOKER, same posture as every RPC in this project — RLS still
-- applies to the caller, and execute is revoked from anon/authenticated
-- below so this is only reachable through the server's service-role client.
create or replace function public.gorush_remove_vehicle(
  p_vehicle_id uuid, p_operator text default null
) returns jsonb language plpgsql as $$
declare
  v_vehicle public.vehicles;
  v_reassigned integer;
begin
  select * into v_vehicle from public.vehicles where id = p_vehicle_id for update;
  if v_vehicle.id is null then
    return jsonb_build_object('ok', false, 'code', 'VEHICLE_NOT_FOUND');
  end if;
  if v_vehicle.active is false then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_REMOVED');
  end if;

  update public.orders
     set vehicle_id = null,
         delivery_sequence = null
   where vehicle_id = p_vehicle_id
     and status in (
       'confirmed', 'expected', 'partially_received', 'received', 'sorting',
       'stored', 'ready_for_loading', 'partially_loaded', 'loaded',
       'out_for_delivery', 'partially_delivered', 'on_hold'
     );
  get diagnostics v_reassigned = row_count;

  update public.vehicles set active = false where id = p_vehicle_id;

  return jsonb_build_object('ok', true, 'code', 'REMOVED', 'reassigned_orders', v_reassigned);
end;
$$;

do $$
begin
  begin
    execute 'revoke all on function public.gorush_remove_vehicle(uuid, text) from anon, authenticated';
  exception when undefined_object then null;
  end;
end;
$$;
