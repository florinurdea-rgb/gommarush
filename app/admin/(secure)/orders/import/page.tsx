import { PageHeading } from "@/components/logistics/AdminShell";
import { DdtImportFlow } from "@/components/logistics/DdtImportFlow";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import DDT" };

/**
 * Multi-DDT import: upload a PDF that may contain several distinct
 * logistics documents, review the AI's proposal per document (already
 * validated deterministically — see src/lib/server/ddt-import.ts), and
 * confirm the ones that are safe to become orders.
 *
 * Deliberately a separate flow from /admin/orders/new (single-document
 * manual/AI entry) rather than a replacement — that flow's assumptions
 * (one upload = one order) don't hold here.
 */
export default function DdtImportPage() {
  const tr = getTr();
  return (
    <>
      <PageHeading
        title={tr("Import DDT")}
        description={tr("Carica un documento che può contenere uno o più DDT.")}
        back
      />
      <DdtImportFlow />
    </>
  );
}
