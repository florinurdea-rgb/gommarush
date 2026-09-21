/** Adapter registry. Lanes are looked up by code, never by guessing. */

import type { SupplierAdapter } from "../types";
import { isbAdapter } from "./isb";
import { deldoAdapter } from "./deldo";

export const ADAPTERS: readonly SupplierAdapter[] = [isbAdapter, deldoAdapter];

export function getAdapter(laneCode: string): SupplierAdapter | undefined {
  return ADAPTERS.find((adapter) => adapter.laneCode === laneCode);
}

export { isbAdapter } from "./isb";
export { deldoAdapter, DELDO_LANE_CODE, DELDO_KEY_PREFIX } from "./deldo";
export { ISB_LANE_CODE, ISB_KEY_PREFIX } from "./isb";
