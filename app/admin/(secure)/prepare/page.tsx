import { listOrdersToPrepare } from "@/lib/server/orders";
import { PageHeading } from "@/components/logistics/AdminShell";
import { PrepareOrdersList } from "@/components/logistics/PrepareOrdersList";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Da preparare" };

/**
 * "Da preparare" — orders whose tyres are physically in the warehouse
 * (sorted/stored/partially loaded) and need labeling + moving toward
 * loading. Repurposed from the old "hold" tab per the brief — orders
 * actually on_hold now surface through Consegne's "In attesa merce" filter
 * instead of a dedicated page.
 */
export default async function PrepareOrdersPage() {
  const tr = getTr();
  const orders = await listOrdersToPrepare();

  return (
    <>
      <PageHeading
        title={tr("Da preparare")}
        description={`${orders.length} ${orders.length === 1 ? "ordine da preparare" : tr("ordini da preparare")} per il carico.`}
      />
      <PrepareOrdersList orders={orders} />
    </>
  );
}
