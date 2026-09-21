/**
 * Deterministic freshness. No AI, no heuristics at call time.
 *
 * "Never show an old supplier price as though it were live." Freshness is
 * computed from stored timestamps and per-lane TTL configuration, so the same
 * inputs always produce the same answer and the result is explainable to an
 * operator.
 */

export type Freshness = "FRESH" | "AGEING" | "STALE" | "UNKNOWN";

export interface FreshnessPolicy {
  /** Within this many hours of observation the value is FRESH. */
  ttlHours: number | null;
  /**
   * Multiple of ttlHours beyond which the value is STALE rather than AGEING.
   * Between ttl and ttl*staleMultiplier the value is AGEING.
   */
  staleMultiplier?: number;
}

export const DEFAULT_STALE_MULTIPLIER = 2;

/**
 * Classify an observation.
 *
 * UNKNOWN is returned when there is no timestamp or no configured TTL — an
 * absence of information is reported as such, never optimistically treated as
 * fresh. A future timestamp (clock skew) is also UNKNOWN rather than FRESH.
 */
export function classifyFreshness(
  observedAt: Date | string | null | undefined,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): Freshness {
  if (observedAt === null || observedAt === undefined) return "UNKNOWN";
  if (policy.ttlHours === null || policy.ttlHours === undefined) return "UNKNOWN";
  if (!Number.isFinite(policy.ttlHours) || policy.ttlHours <= 0) return "UNKNOWN";

  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(observed.getTime())) return "UNKNOWN";

  const ageMs = now.getTime() - observed.getTime();
  if (ageMs < 0) return "UNKNOWN";

  const ttlMs = policy.ttlHours * 3_600_000;
  const staleMs = ttlMs * (policy.staleMultiplier ?? DEFAULT_STALE_MULTIPLIER);

  if (ageMs <= ttlMs) return "FRESH";
  if (ageMs <= staleMs) return "AGEING";
  return "STALE";
}

/** Whole hours since observation, for "checked Nh ago". null when unusable. */
export function ageHours(
  observedAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (observedAt === null || observedAt === undefined) return null;
  const observed = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(observed.getTime())) return null;
  const ageMs = now.getTime() - observed.getTime();
  if (ageMs < 0) return null;
  return Math.floor(ageMs / 3_600_000);
}
