-- ---------------------------------------------------------------------------
-- Vehicle board: per-vehicle capacity + admin-controlled delivery ordering
-- ---------------------------------------------------------------------------
-- Additive only, same posture as every prior migration in this project.
--
-- vehicles.capacity_units: optional max number of physical units (tyres,
-- etc.) the van can carry in one run. Nullable — a vehicle with no capacity
-- set still works everywhere, it just can't show an occupancy percentage or
-- a "returns to depot" estimate (both need a limit to be measured against).
--
-- orders.delivery_sequence: the Admin's manual delivery ordering within a
-- vehicle's column. NULL for every order until the first drag-reorder on
-- that vehicle's column, at which point the whole column is renumbered
-- 1..N — see reorderVehicleColumn() in src/lib/server/orders.ts. Until then,
-- the default sort (planned_delivery_date, then created_at) is what "ordinea
-- livrării" means.

alter table public.vehicles add column if not exists capacity_units integer;
alter table public.vehicles drop constraint if exists vehicles_capacity_units_chk;
alter table public.vehicles
  add constraint vehicles_capacity_units_chk check (capacity_units is null or capacity_units > 0);

alter table public.orders add column if not exists delivery_sequence integer;

create index if not exists orders_vehicle_sequence_idx
  on public.orders(vehicle_id, delivery_sequence);
