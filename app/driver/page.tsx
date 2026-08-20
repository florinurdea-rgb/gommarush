import { getDriverSession } from "@/lib/auth/driver-session";
import { listDrivers, listVehicles } from "@/lib/server/reference";
import { listDriverOrders, summariseDriverDay } from "@/lib/server/loading";
import { getDepotLocation } from "@/lib/server/settings";
import { geocodeAddresses } from "@/lib/server/geocoding";
import { DriverSessionPicker } from "@/components/logistics/DriverSessionPicker";
import { DriverHome } from "@/components/logistics/DriverHome";
import type { DriverRouteStop } from "@/components/logistics/DriverRouteMapModal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Șofer" };

/**
 * /driver — the driver's home screen.
 *
 * Phase 1 stabilisation (§19): order-level actions only, no tyre scanning.
 * Everything a driver sees is scoped to their own session — the orders
 * query filters by driver_id in SQL, so another driver's deliveries never
 * reach this device.
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

  const [orders, depotLocation] = await Promise.all([
    listDriverOrders(session.driverId),
    getDepotLocation(),
  ]);

  const addresses = orders
    .map((order) => [order.customer_address, order.customer_city].filter(Boolean).join(", "))
    .filter((address) => address.length > 0);
  const geocoded = addresses.length > 0 ? await geocodeAddresses(addresses) : new Map();

  const stops: DriverRouteStop[] = orders
    .map((order) => {
      const address = [order.customer_address, order.customer_city].filter(Boolean).join(", ");
      if (!address) return null;
      return {
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        address,
        point: geocoded.get(address) ?? null,
      };
    })
    .filter((stop): stop is DriverRouteStop => stop !== null);

  return (
    <DriverHome
      driverName={session.driverName}
      vehicleName={session.vehicleName}
      orders={orders}
      summary={summariseDriverDay(orders)}
      stops={stops}
      depotLocation={depotLocation}
    />
  );
}
