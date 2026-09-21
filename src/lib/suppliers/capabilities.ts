/**
 * Capability resolution. Absence means UNAVAILABLE.
 *
 * A capability is never inferred from the fact that a lane has an integration,
 * from a lane's name, or from the presence of adapter code. It is an explicit
 * enabled row and nothing else.
 */

import { CAPABILITIES, type Capability } from "./types";

export interface CapabilityRow {
  capability: string;
  enabled: boolean;
}

/**
 * Capabilities that are never enabled in V1 under any configuration.
 *
 * Enabling supplier ordering is an OWNER_DECISION (CLAUDE.md section 4).
 * `hasCapability` returns false for these even if a row somehow says enabled,
 * so a stray database edit cannot switch ordering on. Inter-Sprint Protocol 104
 * and Deldo production ordering are covered by `production_ordering`.
 */
export const ORDERING_CAPABILITIES: ReadonlySet<Capability> = new Set([
  "production_ordering",
  "test_ordering",
]);

export function isKnownCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

/** Build the effective capability set for a lane from its stored rows. */
export function resolveCapabilities(
  rows: readonly CapabilityRow[] | null | undefined,
): ReadonlySet<Capability> {
  const set = new Set<Capability>();
  if (!rows) return set;
  for (const row of rows) {
    if (!row.enabled) continue;
    if (!isKnownCapability(row.capability)) continue;
    if (ORDERING_CAPABILITIES.has(row.capability)) continue; // hard V1 block
    set.add(row.capability);
  }
  return set;
}

/** The only sanctioned way to ask whether a lane can do something. */
export function hasCapability(
  capabilities: ReadonlySet<Capability>,
  capability: Capability,
): boolean {
  if (ORDERING_CAPABILITIES.has(capability)) return false;
  return capabilities.has(capability);
}

/**
 * Invariant guard, asserted by tests and callable at startup: no lane may ever
 * present an ordering capability in V1.
 */
export function assertNoOrderingEnabled(
  capabilities: ReadonlySet<Capability>,
): void {
  for (const ordering of ORDERING_CAPABILITIES) {
    if (capabilities.has(ordering)) {
      throw new Error(
        `Supplier ordering capability "${ordering}" is enabled. ` +
          "Automated supplier ordering is out of scope and requires OWNER_DECISION.",
      );
    }
  }
}
