/**
 * Inter-Sprint lane adapter.
 *
 * Bulk catalogue ingestion and live Gateway lookup are SEPARATE capabilities
 * (docs/architecture/02_SUPPLIER_RULES.md). Only catalogue ingestion is
 * implemented: no Inter-Sprint Gateway/Protocol 103 documentation is available
 * in this repository, and undocumented protocol behaviour must not be inferred.
 * `lookupLive` is therefore absent rather than stubbed.
 *
 * There is NO placeOrder. Protocol 104 is not implemented in any form.
 */

import type { Capability, SupplierAdapter, SupplierOffer } from "../../types";
import { ISB_LANE_CODE, parseIsbRows, type IsbRawRow } from "./parse";

export { ISB_LANE_CODE, ISB_KEY_PREFIX, parseIsbRow, parseIsbRows } from "./parse";
export type { IsbRawRow } from "./parse";

/**
 * Capabilities this adapter's CODE can actually serve. The authoritative
 * enabled/disabled state lives in `supplier_capabilities`; this set is the
 * ceiling, so a database row can never enable something unimplemented.
 */
const ISB_IMPLEMENTED: ReadonlySet<Capability> = new Set<Capability>([
  "catalogue_feed",
]);

export const isbAdapter: SupplierAdapter = {
  laneCode: ISB_LANE_CODE,
  capabilities: () => ISB_IMPLEMENTED,
  parseCatalogueRows(rows, options): SupplierOffer[] {
    return parseIsbRows(rows as IsbRawRow[], options)
      .filter((outcome): outcome is { ok: true; offer: SupplierOffer } => outcome.ok)
      .map((outcome) => outcome.offer);
  },
};
