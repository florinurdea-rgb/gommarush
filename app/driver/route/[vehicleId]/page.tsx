import { notFound } from "next/navigation";
import { listActiveOrders } from "@/lib/server/orders";
import { getVehicle } from "@/lib/server/reference";
import { getDepotLocation } from "@/lib/server/settings";
import { geocodeAddresses } from "@/lib/server/geocoding";
import { DriverRouteView } from "@/components/logistics/DriverRouteView";
import type { DriverRouteStop } from "@/components/logistics/DriverRouteMapModal";

export const dynamic = "force-dynamic";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface RouteContext {
  params: Promise<{ vehicleId: string }>;
}

export default async function DriverRoutePage({ params }: RouteContext) {
  const { vehicleId } = await params;

  const [vehicle, allOrders, depotLocation] = await Promise.all([
    getVehicle(vehicleId),
    listActiveOrders(),
    getDepotLocation(),
  ]);

  if (!vehicle) notFound();

  const today = todayIso();
  const orders = allOrders.filter(
    (order) => order.vehicle_id === vehicleId && order.planned_delivery_date === today
  );

  // Geocoded server-side (same geocodeAddresses() the admin "Hartă" API
  // route uses) rather than via a client fetch — this page has no admin
  // session to call /api/admin/route-map with, so the map's stops arrive
  // already resolved as plain props instead.
  const addresses = orders
    .map((order) => [order.customer_address, order.customer_city].filter(Boolean).join(", "))
    .filter((address) => address.length > 0);
  const geocoded = addresses.length > 0 ? await geocodeAddresses(addresses) : new Map();

  const stops: DriverRouteStop[] = orders
    .map((order) => {
      const address = [order.customer_address, order.customer_city].filter(Boolean).join(", ");
      if (!address) return null;
      const point = geocoded.get(address) ?? null;
      return {
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name,
        address,
        point,
      };
    })
    .filter((stop): stop is DriverRouteStop => stop !== null);

  return (
    <DriverRouteView vehicleName={vehicle.name} orders={orders} stops={stops} depotLocation={depotLocation} />
  );
}
