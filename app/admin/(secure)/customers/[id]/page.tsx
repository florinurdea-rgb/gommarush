import { notFound } from "next/navigation";
import { getCustomerWithLocations } from "@/lib/server/customers";
import { PageHeading } from "@/components/logistics/AdminShell";
import { CustomerEditor } from "@/components/logistics/CustomerEditor";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tr = getTr();
  const { id } = await params;
  const result = await getCustomerWithLocations(id);
  if (!result) notFound();

  return (
    <>
      <PageHeading
        title={result.customer.name}
        description={tr("Azienda cliente e i suoi luoghi di consegna.")}
        back
      />
      <CustomerEditor customer={result.customer} locations={result.locations} />
    </>
  );
}
