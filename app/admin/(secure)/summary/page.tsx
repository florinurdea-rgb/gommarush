import { PageHeading } from "@/components/logistics/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sumar" };

export default function SummaryPage() {
  return (
    <>
      <PageHeading title="Sumar" description="În lucru." />
      <p className="rounded-xl border border-ink/10 bg-white p-6 text-sm text-ink-soft">
        Tabloul de bord operațional (KPI-uri, ridicări furnizori, livrări, profit) urmează.
      </p>
    </>
  );
}
