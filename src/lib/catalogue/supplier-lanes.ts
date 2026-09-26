// Supplier lanes: who we can buy from, and how a listing is attributed to one.
//
// A "lane" is a commercial relationship, not a database row. It outlives any
// particular supplier record — which matters here, because the Inter-Sprint
// supplier row is still literally named 'asdas' pending the approved rename,
// and because duplicate supplier records exist for several merchants (D2).
//
// THE PROBLEM THIS SOLVES: M9's selling policy was called with a hard-coded
// `laneCode: "intersprint"`, which was true when Inter-Sprint was the only
// supplier with data and becomes silently wrong the moment a second lane has
// any. A listing's lane must come from the listing.
//
// Pure: no database, no I/O.

export type LaneCode = "intersprint" | "deldo" | "carlini";

export interface SupplierLane {
  readonly code: LaneCode;
  /** What an operator sees. Independent of the supplier row's current name. */
  readonly label: string;
  /**
   * Indicative delivery time, shown on the tab.
   *
   * A PLANNING LABEL, not a promise: it describes the lane's usual lead time
   * so an operator can weigh speed against price. Real delivery depends on
   * consolidation and cut-off, which the sourcing layer owns.
   */
  readonly leadTimeLabel: string;
  /**
   * Import adapters whose runs attribute a listing to this lane.
   *
   * Attribution is by PROVENANCE — which importer wrote the listing — rather
   * than by supplier name or id. Names change and ids duplicate; the adapter
   * that produced a row does not.
   */
  readonly adapters: readonly string[];
}

/**
 * Every lane the catalogue knows about.
 *
 * Deldo and Carlini are listed deliberately even though neither has a single
 * listing today. A lane with no data renders an honest empty state; omitting
 * it would hide from an operator that the lane exists but is not yet
 * delivering. Nothing here fabricates a listing.
 */
export const SUPPLIER_LANES: readonly SupplierLane[] = [
  {
    code: "intersprint",
    label: "Inter-Sprint",
    leadTimeLabel: "7d",
    // 'isb' is the legacy pre-normalised workbook; 'intersprint-feed' is the
    // live FTP feed. Both are the same commercial lane.
    adapters: ["intersprint-feed", "isb"],
  },
  { code: "deldo", label: "Deldo", leadTimeLabel: "7d", adapters: ["deldo-feed"] },
  { code: "carlini", label: "Carlini", leadTimeLabel: "48h", adapters: ["carlini-manual"] },
];

const LANE_BY_ADAPTER = new Map<string, LaneCode>(
  SUPPLIER_LANES.flatMap((lane) => lane.adapters.map((adapter) => [adapter, lane.code] as const))
);

export function laneByCode(code: string | null | undefined): SupplierLane | null {
  return SUPPLIER_LANES.find((lane) => lane.code === code) ?? null;
}

export function isLaneCode(value: unknown): value is LaneCode {
  return typeof value === "string" && SUPPLIER_LANES.some((lane) => lane.code === value);
}

/**
 * The lane a listing belongs to, from the adapter that last wrote it.
 *
 * Returns null for an adapter we do not recognise rather than guessing at the
 * nearest lane. An unattributed listing still displays; it simply does not
 * claim a commercial relationship we cannot evidence.
 */
export function laneForAdapter(adapter: string | null | undefined): LaneCode | null {
  if (!adapter) return null;
  return LANE_BY_ADAPTER.get(adapter) ?? null;
}
