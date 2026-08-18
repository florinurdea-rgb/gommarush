import { listActiveOrders } from "@/lib/server/orders";
import { listDrivers, listVehicles } from "@/lib/server/reference";
import { listStandOverview } from "@/lib/server/stands";
import { PageHeading } from "@/components/logistics/AdminShell";
import { VehicleBoard } from "@/components/logistics/VehicleBoard";
import type { VehicleColumnData } from "@/components/logistics/VehicleBoard";
import { NewOrderLauncher } from "@/components/logistics/NewOrderLauncher";
import { freeStands } from "@/lib/logistics/stand-allocation";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comenzi în curs" };

/**
 * The Admin dashboard. Server-rendered on every request (`force-dynamic`) so
 * scans performed on the warehouse floor show up on a refresh without any
 * client-side polling — the simple invalidation strategy the brief asks for
 * rather than an over-engineered subscription.
 *
 * Shows only the vehicle board, per the "vreau sa vad doar coloanele fara
 * restul si vreau sa fie clare vizual" brief — the stand board, print-job
 * queue and the flat orders table all still exist (stands via each order's
 * detail page, print jobs at /admin/print-jobs), just not competing for
 * attention here.
 */
export default async function AdminDashboardPage() {
  const [orders, stands, vehicles, drivers] = await Promise.all([
    listActiveOrders(),
    listStandOverview(),
    listVehicles(),
    listDrivers(),
  ]);

  const available = freeStands(
    stands
      .filter((stand) => stand.orderId && stand.status)
      .map((stand) => ({ id: stand.orderId!, stand_code: stand.standCode, status: stand.status! }))
  );

  // "Așteaptă asignare" first so it's the obvious place to drag FROM;
  // vehicles after, in the same name order listVehicles() already returns,
  // numbered for the van icon's badge.
  const vehicleColumns: VehicleColumnData[] = [
    {
      key: "unassigned",
      vehicleId: null,
      name: "Așteaptă asignare",
      number: null,
      capacityUnits: null,
      orders: orders.filter((order) => !order.vehicle_id),
    },
    ...vehicles.map((vehicle, index) => ({
      key: vehicle.id,
      vehicleId: vehicle.id,
      name: vehicle.name,
      number: index + 1,
      capacityUnits: vehicle.capacity_units,
      orders: orders.filter((order) => order.vehicle_id === vehicle.id),
    })),
  ];

  return (
    <>
      <PageHeading
        title={t("ordersInProgress")}
        description={`${orders.length} comenzi active`}
        action={
          <NewOrderLauncher
            drivers={drivers.map((driver) => ({ id: driver.id, name: driver.name }))}
            vehicles={vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name }))}
            availableStands={available}
          />
        }
      />

      <VehicleBoard columns={vehicleColumns} />
    </>
  );
}
