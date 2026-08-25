import { listActiveOrders } from "@/lib/server/orders";
import { listVehicles } from "@/lib/server/reference";
import { getDepotLocation } from "@/lib/server/settings";
import { PageHeading } from "@/components/logistics/AdminShell";
import { VehicleBoard } from "@/components/logistics/VehicleBoard";
import type { VehicleColumnData } from "@/components/logistics/VehicleBoard";
import { NewOrderLauncher } from "@/components/logistics/NewOrderLauncher";
import { DashboardLiveRefresh } from "@/components/logistics/DashboardLiveRefresh";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Consegne" };

/**
 * "Consegne" — the default operational screen. Server-rendered from the live
 * database on every request. DashboardLiveRefresh keeps already-open copies
 * on other devices converged as warehouse/admin activity changes the data.
 */
export default async function AdminDashboardPage() {
  const [orders, vehicles, depotLocation] = await Promise.all([
    listActiveOrders(),
    listVehicles(),
    getDepotLocation(),
  ]);

  const vehicleColumns: VehicleColumnData[] = [
    {
      key: "unassigned",
      vehicleId: null,
      name: "Non assegnati",
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
      <DashboardLiveRefresh />
      <PageHeading title="Consegne" action={<NewOrderLauncher />} />

      <VehicleBoard columns={vehicleColumns} vehicles={vehicles} depotLocation={depotLocation} />
    </>
  );
}
