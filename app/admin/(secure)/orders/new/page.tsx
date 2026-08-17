import { listDrivers, listVehicles } from "@/lib/server/reference";
import { listStandOverview } from "@/lib/server/stands";
import { isAnalysisConfigured } from "@/lib/documents";
import { PageHeading } from "@/components/logistics/AdminShell";
import { NewOrderFlow } from "@/components/logistics/NewOrderFlow";
import { t } from "@/lib/i18n/logistics";
import { freeStands } from "@/lib/logistics/stand-allocation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Adaugă comandă" };

/**
 * Order import.
 *
 * The delivery day (today / tomorrow) is asked first and stored as the order's
 * `planned_delivery_date`. Note the modelling choice the brief calls for: the
 * delivery day is NOT an entity — it is a date on each order. One supplier
 * invoice remains one order.
 */
export default async function NewOrderPage() {
  const [drivers, vehicles, stands] = await Promise.all([
    listDrivers(),
    listVehicles(),
    listStandOverview(),
  ]);

  const available = freeStands(
    stands
      .filter((stand) => stand.orderId && stand.status)
      .map((stand) => ({ id: stand.orderId!, stand_code: stand.standCode, status: stand.status! }))
  );

  return (
    <>
      <PageHeading
        title={t("addOrder")}
        description="Încarcă documentul furnizorului, verifică datele extrase, apoi salvează comanda."
      />
      <NewOrderFlow
        drivers={drivers.map((driver) => ({ id: driver.id, name: driver.name }))}
        vehicles={vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name }))}
        availableStands={available}
        analysisConfigured={isAnalysisConfigured()}
      />
    </>
  );
}
