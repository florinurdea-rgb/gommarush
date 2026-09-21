/**
 * Deldo lane registration.
 *
 * BLOCKED — no parser is implemented.
 *
 * Building a Deldo ingestion path requires the supplier's actual feed
 * documentation: file/FTP mechanism, delivery path, file format and column
 * contract. None of that exists in this repository, and no Deldo credentials
 * are available to this session. Inventing a column layout would produce a
 * parser that silently mis-maps real commercial data, so none is written.
 *
 * The lane is registered here so that supplier identity, capability rows and
 * the observation model are already in place and no redesign is needed once the
 * documentation arrives. Its declared implemented-capability set is empty:
 * absence means unavailable.
 *
 * When Deldo documentation is supplied:
 *   1. every offer derived from the sample/test files described by the supplier
 *      as fictional/non-current MUST carry isTestData = true;
 *   2. Deldo normalizes into the SAME SupplierOffer shape as Inter-Sprint —
 *      no separate Deldo product architecture;
 *   3. order XML generation stays a local fixture exercise. Sending a real
 *      order or enabling production ordering is an OWNER_DECISION.
 */

import type { Capability, SupplierAdapter } from "../../types";

export const DELDO_LANE_CODE = "deldo";
export const DELDO_KEY_PREFIX = "DELDO";

/** Empty: nothing is implemented yet, so nothing may be declared available. */
const DELDO_IMPLEMENTED: ReadonlySet<Capability> = new Set<Capability>();

export const deldoAdapter: SupplierAdapter = {
  laneCode: DELDO_LANE_CODE,
  capabilities: () => DELDO_IMPLEMENTED,
  // No parseCatalogueRows: the feed contract is unknown.
  // No lookupLive. No placeOrder — absent by design.
};
