import { redirect } from "next/navigation";
import { getDriverSession } from "@/lib/auth/driver-session";
import { listVehicles } from "@/lib/server/reference";
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
 * Identity comes from a real Supabase Auth session (§17) — an
 * unauthenticated visitor is sent to /driver/login, never shown a picker
 * of other people's names. Everything a driver sees is scoped to their
 * own session — the orders query filters by driver_id in SQL, so another
 * driver's deliveries never reach this device.
 */
export default async function DriverPage() {
  const session = await getDriverSession();
  if (!session) redirect("/driver/login");

  if (!session.vehicleId) {
    const vehicles = await listVehicles();
    return (
      <DriverSessionPicker
        driverName={session.driverName}
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
