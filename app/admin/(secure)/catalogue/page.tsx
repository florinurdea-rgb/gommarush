import { PageHeading } from "@/components/logistics/AdminShell";
import { CatalogueImporter } from "@/components/catalogue/CatalogueImporter";
import { listSuppliersWithCounts } from "@/lib/server/suppliers";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { getTr } from "@/lib/i18n/tr-server";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Catalogo pneumatici" };

/**
 * "Catalogo" — importing a supplier's tyre catalogue.
 *
 * The counts at the top exist to answer the first question anyone asks on
 * arriving here: is there anything in the catalogue at all? An empty one is
 * a normal state before the first import, not an error, and the page says so
 * plainly rather than showing four zeros with no explanation.
 */
async function getCatalogueCounts() {
  const supabase = createSupabaseAdminClient();
  const count = async (table: string) => {
    const { count: value, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return value ?? 0;
  };

  try {
    const [products, listings, identifiers, conflicts] = await Promise.all([
      count("catalogue_products"),
      count("supplier_product_listings"),
      count("product_identifiers"),
      count("catalogue_conflicts"),
    ]);
    return { products, listings, identifiers, conflicts, available: true };
  } catch (error) {
    // The tables may not exist yet in an environment where the migration has
    // not run. That is a deployment state worth naming, not a crash.
    logError("catalogue_counts_failed", error);
    return { products: 0, listings: 0, identifiers: 0, conflicts: 0, available: false };
  }
}

export default async function CataloguePage() {
  const tr = getTr();
  const [suppliers, counts] = await Promise.all([
    listSuppliersWithCounts().catch((error) => {
      logError("catalogue_suppliers_failed", error);
      return [];
    }),
    getCatalogueCounts(),
  ]);

  return (
    <>
      <PageHeading
        title={tr("Catalogo pneumatici")}
        description={tr("Importa il listino di un fornitore e aggiorna il catalogo.")}
      />

      {!counts.available && (
        <div className="mb-5 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">
            {tr("Le tabelle del catalogo non sono ancora installate.")}
          </p>
          <p className="mt-1 text-sm text-ink">
            {tr("Esegui la migrazione del database prima di importare un listino.")}
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={tr("Prodotti a catalogo")} value={counts.products} />
        <Metric label={tr("Articoli fornitore")} value={counts.listings} />
        <Metric label={tr("Codici identificativi")} value={counts.identifiers} />
        <Metric label={tr("Conflitti aperti")} value={counts.conflicts} />
      </div>

      {counts.available && counts.products === 0 && (
        <div className="mb-5 rounded-xl border border-ink/15 bg-surface-soft p-4">
          <p className="text-sm font-bold text-ink">{tr("Il catalogo è vuoto.")}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {tr(
              "Carica qui il file del fornitore per popolarlo. Finché il catalogo è vuoto, la ricerca per codice sul sito pubblico non troverà nulla."
            )}
          </p>
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink/20 bg-white px-6 py-16 text-center">
          <p className="text-base font-semibold text-ink">{tr("Nessun fornitore")}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {tr("Crea prima un fornitore nella sezione Fornitori.")}
          </p>
        </div>
      ) : (
        <CatalogueImporter
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name }))}
        />
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3 shadow-card">
      <div className="text-2xl font-black tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</div>
    </div>
  );
}
