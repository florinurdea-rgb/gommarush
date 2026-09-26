import { CommerceLocationIcon } from "@/components/customer/CommerceIcons";
import { getCurrentCustomerAccount } from "@/lib/server/customer-account";
import { getTr } from "@/lib/i18n/tr-server";

export const dynamic = "force-dynamic";

/**
 * The customer's own company details and delivery addresses.
 *
 * ONLY WHAT THE RECORD ACTUALLY HOLDS. Company name, VAT and fiscal number,
 * email, phone, and the delivery locations — every one of them read from the
 * customer row. There is no credit limit, no account tier, no payment terms
 * and no order allowance here, because GommaRush's data model holds none of
 * those and a figure invented to fill a panel is a commercial claim.
 *
 * Nothing on this screen is editable. Changing a company's legal details or
 * adding a delivery address is an operator action today, and offering a form
 * that silently discards what was typed would be worse than not offering one.
 */
export default async function AccountPage() {
  const tr = getTr();
  const { customer, locations } = await getCurrentCustomerAccount();

  const rows: Array<[string, string | null]> = [
    [tr("P. IVA"), customer.vat_number],
    [tr("Codice fiscale"), customer.fiscal_code],
    [tr("Email"), customer.email],
    [tr("Telefono"), customer.phone],
  ];

  return (
    <div>
      <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">{tr("Account")}</h1>

      <section className="mt-5 rounded-2xl border border-ink/10 bg-white p-4">
        <h2 className="text-lg font-extrabold text-ink">{customer.legal_name || customer.name}</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) =>
            value ? (
              <div key={label} className="flex justify-between gap-3 sm:block">
                <dt className="text-ink-soft sm:text-xs sm:font-bold sm:uppercase sm:tracking-wide">
                  {label}
                </dt>
                <dd className="font-semibold text-ink sm:mt-0.5">{value}</dd>
              </div>
            ) : null
          )}
        </dl>
      </section>

      <section className="mt-4">
        <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
          <CommerceLocationIcon className="h-4 w-4" />
          {tr("Sedi di consegna")} · {locations.length}
        </h2>

        {locations.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-ink/20 bg-white p-6 text-center text-sm text-ink-soft">
            {tr("Nessun indirizzo di consegna valido configurato. Contatta GommaRush per aggiungerne uno.")}
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {locations.map((location) => (
              <li key={location.id} className="rounded-2xl border border-ink/10 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-ink">{location.location_name || location.city}</strong>
                  {location.is_primary && (
                    <span className="inline-flex items-center rounded-md bg-accent-light px-2 py-0.5 text-[11px] font-bold text-accent">
                      {tr("Principale")}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink-soft">
                  {[
                    location.address_line1,
                    location.address_line2,
                    location.postal_code,
                    location.city,
                    location.province,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {location.delivery_notes && (
                  <p className="mt-2 text-xs text-ink-soft">{location.delivery_notes}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
