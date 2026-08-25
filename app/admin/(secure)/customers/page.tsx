import Link from "next/link";
import { listCustomers } from "@/lib/server/customers";
import { PageHeading } from "@/components/logistics/AdminShell";
import { t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Elenco clienti" };

/**
 * The customer list. A customer here is the legal/company entity; its delivery
 * branches live in `customer_locations` and are edited on the detail page.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const customers = await listCustomers(q);

  return (
    <>
      <PageHeading
        title={t("customerList")}
        description="Aziende clienti. Un'azienda può avere più luoghi di consegna."
      />

      <form className="mb-5 flex max-w-md gap-2" action="/admin/customers">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cerca per ragione sociale o codice fiscale…"
          className="h-11 flex-1 rounded-lg border border-ink/15 px-3 text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-white">
          {t("search")}
        </button>
      </form>

      {customers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-12 text-center text-ink-soft">
          Nessun cliente trovato.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink/10 bg-white shadow-card">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-ink/10 bg-surface-soft text-xs uppercase tracking-wide text-ink-soft">
                <th scope="col" className="px-4 py-3 font-semibold">{t("companyName")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t("vatNumber")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t("locations")}</th>
                <th scope="col" className="px-4 py-3 font-semibold">Comenzi</th>
                <th scope="col" className="px-4 py-3 font-semibold">{t("contacts")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/5">
              {customers.map((customer) => (
                <tr key={customer.id} className="hover:bg-surface-soft/60">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="font-semibold text-accent hover:underline"
                    >
                      {customer.name}
                    </Link>
                    {customer.legal_name && customer.legal_name !== customer.name && (
                      <div className="text-xs text-ink-soft">{customer.legal_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-ink">{customer.vat_number ?? "—"}</td>
                  <td className="px-4 py-3 text-sm text-ink">{customer.location_count}</td>
                  <td className="px-4 py-3 text-sm text-ink">{customer.order_count}</td>
                  <td className="px-4 py-3 text-sm text-ink-soft">
                    {customer.email ?? customer.phone ?? "—"}
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
