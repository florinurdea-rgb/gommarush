import { PageHeading } from "@/components/logistics/AdminShell";
import { CatalogueSearch } from "@/components/catalogue/CatalogueSearch";
import { getCatalogueFacets } from "@/lib/server/catalogue-search";
import { getTr } from "@/lib/i18n/tr-server";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Ricerca e prezzi" };

/**
 * "Ricerca e prezzi" — the internal commercial preview.
 *
 * Sits inside /admin/(secure), so the layout's server-side session gate runs
 * before any of this renders. The API route it calls re-checks independently.
 *
 * It shows supplier cost and gross profit on purpose: an operator cannot judge
 * whether GommaRush is competitive without seeing both ends of the
 * calculation. That is exactly why there is no public counterpart to this page
 * in this mission.
 */
export default async function CatalogueSearchPage() {
  const tr = getTr();

  const facets = await getCatalogueFacets().catch((error) => {
    logError("catalogue_search_facets_failed", error);
    return { widths: [], aspectRatios: [], rims: [], schemaAvailable: false };
  });

  return (
    <>
      <PageHeading
        title={tr("Ricerca e prezzi")}
        description={tr(
          "Anteprima commerciale interna: cerca una misura e verifica a quanto GommaRush potrebbe venderla."
        )}
      />

      {!facets.schemaAvailable && (
        <div className="mb-5 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">
            {tr("Le tabelle del catalogo non sono ancora installate.")}
          </p>
        </div>
      )}

      {facets.schemaAvailable && facets.widths.length === 0 && (
        <div className="mb-5 rounded-xl border border-ink/15 bg-surface-soft p-4">
          <p className="text-sm font-bold text-ink">{tr("Il catalogo è vuoto.")}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {tr("Importa prima un listino fornitore dalla sezione Catalogo.")}
          </p>
        </div>
      )}

      <CatalogueSearch
        facets={{
          widths: facets.widths,
          aspectRatios: facets.aspectRatios,
          rims: facets.rims,
        }}
      />
    </>
  );
}
