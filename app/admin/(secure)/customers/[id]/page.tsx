import { notFound } from "next/navigation";
import { getCustomerWithLocations } from "@/lib/server/customers";
import { PageHeading } from "@/components/logistics/AdminShell";
import { CustomerEditor } from "@/components/logistics/CustomerEditor";
import { CustomerAccountsPanel } from "@/components/logistics/CustomerAccountsPanel";
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
      {/*
        Portal access sits ABOVE the locations editor deliberately.
        The editor is a long, multi-branch form, and anything below it is
        reached only by scrolling past every delivery address the company has
        — which is how an operator concludes a feature is missing. This is the
        section they come here for today.
      */}
      <div className="mb-5">
        <CustomerAccountsPanel customerId={result.customer.id} />
      </div>
      <CustomerEditor customer={result.customer} locations={result.locations} />
    </>
  );
}
