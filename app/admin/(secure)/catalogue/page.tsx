import Link from "next/link";
import { PageHeading } from "@/components/logistics/AdminShell";
import { CatalogueWorkspace } from "@/components/catalogue/CatalogueWorkspace";
import { getCatalogueFacets } from "@/lib/server/catalogue-browse";
import { getIntersprintFeedStatus, type FeedCategoryStatus } from "@/lib/server/feed-status";
import { getTr } from "@/lib/i18n/tr-server";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Catalogo" };

/**
 * "Catalogo" — the primary operational workspace.
 *
 * Until M11B this route was the import screen, which put a once-a-month action
 * where the every-day one belongs. Browsing and comparing supplier offers is
 * now the page; importing moved to /admin/catalogue/importa, and the old
 * /admin/catalogue/ricerca search redirects here so there is one Catalogue
 * experience rather than two competing ones.
 *
 * Facets are fetched server-side for the first paint so the filters are usable
 * before any client request completes.
 */
export default async function CataloguePage() {
  const tr = getTr();

  const [facets, feed] = await Promise.all([
    getCatalogueFacets().catch((error) => {
      logError("catalogue_workspace_facets_failed", error);
      return { widths: [], aspectRatios: [], rims: [], seasons: [], brands: [], schemaAvailable: false };
    }),
    // A broken status strip must not take down the catalogue.
    getIntersprintFeedStatus().catch((error) => {
      logError("catalogue_feed_status_failed", error);
      return null;
    }),
  ]);

  return (
    <>
      <PageHeading
        title={tr("Catalogo")}
        description={tr("Cerca pneumatici e confronta le offerte dei fornitori.")}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {feed ? <FeedStrip feed={feed} /> : <span />}
        <Link
          href="/admin/catalogue/importa"
          className="rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:border-accent"
        >
          {tr("Importa listino")}
        </Link>
      </div>

      {!facets.schemaAvailable && (
        <div className="mb-5 rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">
            {tr("Le tabelle del catalogo non sono ancora installate.")}
          </p>
        </div>
      )}

      <CatalogueWorkspace
        initialFacets={{
          widths: [...facets.widths],
          aspectRatios: [...facets.aspectRatios],
          rims: [...facets.rims],
          seasons: [...facets.seasons],
          brands: [...facets.brands],
        }}
      />
    </>
  );
}

/**
 * Feed health, compact.
 *
 * It used to be a full block because this page was about importing. Browsing
 * is now the job, so the question shrinks to "is supplier data still
 * arriving?" — one line per feed, and it goes red when it is not.
 */
function FeedStrip({
  feed,
}: {
  feed: NonNullable<Awaited<ReturnType<typeof getIntersprintFeedStatus>>>;
}) {
  const tr = getTr();
  if (!feed.schemaAvailable) return <span />;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-semibold text-ink-soft">{tr("Flusso Inter-Sprint")}:</span>
      {feed.byCategory.map((status: FeedCategoryStatus) => (
        <span
          key={status.category}
          className={`rounded-md px-2 py-0.5 font-semibold ${
            status.stale
              ? "bg-state-danger-soft text-state-danger"
              : "bg-state-success-soft text-state-success"
          }`}
        >
          {status.category === "pcr" ? tr("Vetture") : tr("Autocarro")}{" "}
          {status.stale ? tr("non aggiornato") : tr("ok")}
        </span>
      ))}
    </div>
  );
}
