import "server-only";
import type { TyreLookupResult } from "@/lib/tyre-lookup/types";

/**
 * In-memory result cache, keyed by normalised barcode.
 *
 * Same trade-off as src/lib/rate-limit.ts: this lives in the memory of a
 * single serverless instance, so it isn't shared across instances or
 * guaranteed to survive a cold start — but it turns a repeat scan of the
 * same tyre within a warm instance's lifetime from a several-second web
 * search into an instant lookup, which is the actual UX goal ("operatorul
 * scanează eticheta → în 1–3 secunde știe exact ce cauciuc are în față").
 * A durable cross-instance cache would mean a new database table, which
 * this feature deliberately avoids depending on.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // tyre catalog data doesn't change minute to minute
const MAX_ENTRIES = 2000;

interface CacheEntry {
  result: TyreLookupResult;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedLookup(barcode: string): TyreLookupResult | null {
  const entry = cache.get(barcode);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(barcode);
    return null;
  }

  return { ...entry.result, cached: true };
}

export function setCachedLookup(barcode: string, result: TyreLookupResult): void {
  // A technical failure should be retried on the next scan, not stuck
  // returning the same failure for 24 hours.
  if (result.status === "failed" || result.status === "unconfigured") return;

  if (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }

  cache.set(barcode, { result, cachedAt: Date.now() });
}
