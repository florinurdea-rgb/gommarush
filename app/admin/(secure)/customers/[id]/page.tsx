import { notFound } from "next/navigation";
import { getCustomerWithLocations } from "@/lib/server/customers";
import { PageHeading } from "@/components/logistics/AdminShell";
import { CustomerEditor } from "@/components/logistics/CustomerEditor";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getCustomerWithLocations(id);
  if (!result) notFound();

  return (
    <>
      <PageHeading
        title={result.customer.name}
        description="Firmă client și locațiile sale de livrare."
      />
      <CustomerEditor customer={result.customer} locations={result.locations} />
    </>
  );
}
