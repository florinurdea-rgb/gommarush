import { notFound } from "next/navigation";
import { getSupplier } from "@/lib/server/suppliers";
import { PageHeading } from "@/components/logistics/AdminShell";
import { SupplierEditor } from "@/components/logistics/SupplierEditor";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const tr = getTr();
  const { id } = await params;
  const supplier = await getSupplier(id);
  if (!supplier) notFound();

  return (
    <>
      <PageHeading title={supplier.name} description={tr("La scheda del fornitore.")} back />
      <SupplierEditor supplier={supplier} />
    </>
  );
}
