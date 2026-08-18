import Link from "next/link";
import { listActiveOrders } from "@/lib/server/orders";
import { countPendingPrintJobs } from "@/lib/server/print-jobs";
import { listStandOverview } from "@/lib/server/stands";
import { listVehicles } from "@/lib/server/reference";
import { PageHeading } from "@/components/logistics/AdminShell";
import { OrdersTable } from "@/components/logistics/OrdersTable";
import { StandBoard } from "@/components/logistics/StandBoard";
import { VehicleBoard } from "@/components/logistics/VehicleBoard";
import type { VehicleColumnData } from "@/components/logistics/VehicleBoard";
import { LinkButton } from "@/components/LinkButton";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comenzi în curs" };

/**
 * The Admin dashboard. Server-rendered on every request (`force-dynamic`) so
 * scans performed on the warehouse floor show up on a refresh without any
 * client-side polling — the simple invalidation strategy the brief asks for
 * rather than an over-engineered subscription.
 */
export default async function AdminDashboardPage() {
  const [orders, stands, pendingPrintJobs, vehicles] = await Promise.all([
    listActiveOrders(),
    listStandOverview(),
    countPendingPrintJobs(),
    listVehicles(),
  ]);

  const unassigned = orders.filter((order) => !order.stand_code).length;

  // "Neasignat" first so it's the obvious place to drag FROM; vehicles after,
  // in the same name order listVehicles() already returns, numbered for the
  // van icon's badge.
  const vehicleColumns: VehicleColumnData[] = [
    {
      key: "unassigned",
      vehicleId: null,
      name: "Neasignat",
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
          <LinkButton href="/admin/orders/new" size="lg">
            + {t("addOrder")}
          </LinkButton>
        }
      />

      <VehicleBoard columns={vehicleColumns} />

      <StandBoard stands={stands} />

      {unassigned > 0 && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-state-warning/30 bg-state-warning-soft px-4 py-3 text-sm font-semibold text-state-warning"
        >
          {unassigned === 1
            ? "O comandă activă nu are stativ alocat."
            : `${unassigned} comenzi active nu au stativ alocat.`}{" "}
          Alocă manual din pagina comenzii.
        </div>
      )}

      {pendingPrintJobs > 0 && (
        <div className="mb-5 rounded-xl border border-ink/10 bg-white px-4 py-3 text-sm text-ink-soft">
          {pendingPrintJobs} etichete în coada de printare.{" "}
          <Link href="/admin/print-jobs" className="font-semibold text-accent hover:underline">
            Vezi coada
          </Link>
        </div>
      )}

      <OrdersTable orders={orders} variant="active" />
    </>
  );
}
