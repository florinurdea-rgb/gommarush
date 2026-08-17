import { listOrdersOnHold } from "@/lib/server/orders";
import { PageHeading } from "@/components/logistics/AdminShell";
import { OrdersTable } from "@/components/logistics/OrdersTable";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "În așteptare" };

/**
 * Orders parked out of the active distribution list. From here an Admin can
 * inspect, edit, or reactivate — and reactivation returns the order to the
 * status it held before, re-checking its stand rather than assuming it is free.
 */
export default async function HoldPage() {
  const orders = await listOrdersOnHold();

  return (
    <>
      <PageHeading
        title={t("ordersOnHold")}
        description="Comenzi scoase temporar din lista activă de distribuție."
      />
      <OrdersTable orders={orders} variant="hold" />
    </>
  );
}
