import { getDriverSession } from "@/lib/auth/driver-session";
import { listDrivers, listVehicles } from "@/lib/server/reference";
import { listDriverOrders, listLoadableUnits, summariseDriverProgress } from "@/lib/server/loading";
import { DriverSessionPicker } from "@/components/logistics/DriverSessionPicker";
import { DriverConsole } from "@/components/logistics/DriverConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "Șofer" };

/**
 * /driver — the operational receiving and loading interface.
 *
 * Mobile-first: large buttons, large text, minimal typing. Everything a driver
 * sees is scoped to their own session — the orders query filters by driver_id in
 * SQL, so another driver's deliveries never reach this device.
 */
export default async function DriverPage() {
  const session = await getDriverSession();

  if (!session) {
    const [drivers, vehicles] = await Promise.all([listDrivers(), listVehicles()]);
    return (
      <DriverSessionPicker
        drivers={drivers.map((d) => ({ id: d.id, name: d.name }))}
        vehicles={vehicles.map((v) => ({ id: v.id, name: v.name }))}
      />
    );
  }

  const [orders, loadableUnits] = await Promise.all([
    listDriverOrders(session.driverId),
    listLoadableUnits(session.driverId),
  ]);

  return (
    <DriverConsole
      driverName={session.driverName}
      vehicleName={session.vehicleName}
      orders={orders}
      progress={summariseDriverProgress(orders)}
      loadableUnits={loadableUnits}
    />
  );
}
