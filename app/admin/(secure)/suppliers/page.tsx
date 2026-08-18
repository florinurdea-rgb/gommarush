import Link from "next/link";
import { listSuppliersWithCounts } from "@/lib/server/suppliers";
import { PageHeading } from "@/components/logistics/AdminShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Furnizori" };

/**
 * The supplier list — the profile behind every DDT/invoice import
 * (findOrCreateSupplier in reference.ts auto-creates a bare-bones supplier
 * from a scanned document; this is where the Admin fills in the rest:
 * legal name, VAT, contacts, notes).
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const suppliers = await listSuppliersWithCounts(q);

  return (
    <>
      <PageHeading title="Furnizori" description="Profilul fiecărui furnizor de anvelope." />

      <form className="mb-5 flex max-w-md gap-2" action="/admin/suppliers">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Caută după denumire sau cod fiscal…"
          className="h-11 flex-1 rounded-lg border border-ink/15 px-3 text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white">
          Caută
        </button>
      </form>

      {suppliers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-12 text-center text-ink-soft">
          Niciun furnizor găsit.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
                <th scope="col" className="px-4 py-3 font-semibold">Denumire</th>
                <th scope="col" className="px-4 py-3 font-semibold">CIF / P.IVA</th>
                <th scope="col" className="px-4 py-3 font-semibold">Comenzi</th>
                <th scope="col" className="px-4 py-3 font-semibold">Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-surface-soft/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/suppliers/${supplier.id}`}
                      className="font-semibold text-accent hover:underline"
                    >
                      {supplier.name}
                    </Link>
                    {supplier.legal_name && supplier.legal_name !== supplier.name && (
                      <div className="text-xs text-ink-soft">{supplier.legal_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-ink">{supplier.vat_number ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-ink">{supplier.order_count}</td>
                  <td className="px-4 py-3 text-sm text-ink-soft">
                    {supplier.email ?? supplier.phone ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
