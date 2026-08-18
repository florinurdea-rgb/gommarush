import { listActiveOrders } from "@/lib/server/orders";
import { listVehicles } from "@/lib/server/reference";
import { listStandOverview } from "@/lib/server/stands";
import { getDepotLocation } from "@/lib/server/settings";
import { PageHeading } from "@/components/logistics/AdminShell";
import { VehicleBoard } from "@/components/logistics/VehicleBoard";
import type { VehicleColumnData } from "@/components/logistics/VehicleBoard";
import { NewOrderLauncher } from "@/components/logistics/NewOrderLauncher";
import { freeStands } from "@/lib/logistics/stand-allocation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Livrări" };

/**
 * "Livrări" — the default operational screen. Server-rendered on every
 * request (`force-dynamic`) so scans performed on the warehouse floor show
 * up on a refresh without any client-side polling.
 *
 * Fetches every active order once, unfiltered by date — VehicleBoard owns
 * the day-scoped view (date control, summary line, filters) entirely
 * client-side, so switching days never re-fetches or reloads the board.
 * Shows only the board itself: the stand board, print-job queue and the
 * flat orders table all still exist elsewhere (stands via each order's
 * detail page, print jobs at /admin/print-jobs), just not competing for
 * attention here.
 */
export default async function AdminDashboardPage() {
  const [orders, stands, vehicles, depotLocation] = await Promise.all([
    listActiveOrders(),
    listStandOverview(),
    listVehicles(),
    getDepotLocation(),
  ]);

  const available = freeStands(
    stands
      .filter((stand) => stand.orderId && stand.status)
      .map((stand) => ({ id: stand.orderId!, stand_code: stand.standCode, status: stand.status! }))
  );

  // "Neasignate" first so it's the obvious place to drag FROM; vehicles
  // after, in the same name order listVehicles() already returns, numbered
  // for the van icon's badge.
  const vehicleColumns: VehicleColumnData[] = [
    {
      key: "unassigned",
      vehicleId: null,
      name: "Neasignate",
      number: null,
      capacityUnits: null,
      colorKey: null,
      orders: orders.filter((order) => !order.vehicle_id),
    },
    ...vehicles.map((vehicle, index) => ({
      key: vehicle.id,
      vehicleId: vehicle.id,
      name: vehicle.name,
      number: index + 1,
      capacityUnits: vehicle.capacity_units,
      colorKey: vehicle.color_key,
      orders: orders.filter((order) => order.vehicle_id === vehicle.id),
    })),
  ];

  return (
    <>
      <PageHeading
        title="Livrări"
        action={
          <NewOrderLauncher availableStands={available} />
        }
      />

      <VehicleBoard columns={vehicleColumns} vehicles={vehicles} depotLocation={depotLocation} />
    </>
  );
}
