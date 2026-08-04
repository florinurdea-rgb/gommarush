import "server-only";

/**
 * Best-effort, in-memory sliding-window rate limiter, keyed by caller IP.
 *
 * Limitation: this state lives in the memory of a single serverless
 * function instance. On Vercel that means it resets on cold start and
 * isn't shared across concurrently-running instances/regions, so it
 * won't perfectly enforce the limit under real distributed load. It's
 * still a meaningful first line of defense against naive bots hitting
 * this endpoint from one instance, and costs no extra infrastructure.
 * For strict enforcement, swap this for Upstash Redis or Vercel KV.
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 8;

const hits = new Map<string, number[]>();

function pruneOldEntries(now: number) {
  // Cheap periodic cleanup so the map doesn't grow unbounded across a
  // long-lived instance lifetime.
  if (hits.size < 500) return;
  for (const [key, timestamps] of hits) {
    const recent = timestamps.filter((t) => now - t < WINDOW_MS);
    if (recent.length === 0) {
      hits.delete(key);
    } else {
      hits.set(key, recent);
    }
  }
}

export function isRateLimited(key: string): boolean {
  const now = Date.now();
  pruneOldEntries(now);

  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  hits.set(key, timestamps);

  return timestamps.length > MAX_REQUESTS_PER_WINDOW;
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }
  return headers.get("x-real-ip") ?? "unknown";
}
