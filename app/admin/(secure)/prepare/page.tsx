import { listOrdersToPrepare } from "@/lib/server/orders";
import { PageHeading } from "@/components/logistics/AdminShell";
import { PrepareOrdersList } from "@/components/logistics/PrepareOrdersList";

export const dynamic = "force-dynamic";
export const metadata = { title: "De pregătit" };

/**
 * "De pregătit" — orders whose tyres are physically in the warehouse
 * (sorted/stored/partially loaded) and need labeling + moving toward
 * loading. Repurposed from the old "hold" tab per the brief — orders
 * actually on_hold now surface through Livrări's "Așteaptă marfa" filter
 * instead of a dedicated page.
 */
export default async function PrepareOrdersPage() {
  const orders = await listOrdersToPrepare();

  return (
    <>
      <PageHeading
        title="De pregătit"
        description={`${orders.length} ${orders.length === 1 ? "comandă" : "comenzi"} de etichetat și pregătit pentru încărcare.`}
      />
      <PrepareOrdersList orders={orders} />
    </>
  );
}
