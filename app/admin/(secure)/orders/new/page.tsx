import { isAnalysisConfigured } from "@/lib/documents";
import { PageHeading } from "@/components/logistics/AdminShell";
import { NewOrderFlow } from "@/components/logistics/NewOrderFlow";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Aggiungi ordine" };

/**
 * Order import.
 *
 * The delivery day (today / tomorrow) is asked first and stored as the order's
 * `planned_delivery_date`. Note the modelling choice the brief calls for: the
 * delivery day is NOT an entity — it is a date on each order. One supplier
 * invoice remains one order.
 */
export default function NewOrderPage() {
  return (
    <>
      <PageHeading
        title={t("addOrder")}
        description="Carica il documento del fornitore, controlla i dati estratti, poi salva l'ordine."
        back
      />
      <NewOrderFlow analysisConfigured={isAnalysisConfigured()} />
    </>
  );
}
