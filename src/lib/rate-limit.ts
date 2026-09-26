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

/**
 * Dedicated limiter for the admin login endpoint.
 *
 * Deliberately separate from isRateLimited() above: that one counts every
 * request (right for a public submission form). Login must only count
 * *failed* attempts — counting successful logins or page loads means a
 * legitimate admin can get locked out just by using the product, which is
 * the opposite of what a brute-force guard is for.
 */
const LOGIN_WINDOW_MS = readPositiveIntEnv("LOGIN_RATE_LIMIT_WINDOW_MINUTES", 15) * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = readPositiveIntEnv("LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 10);

const loginFailures = new Map<string, number[]>();

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface LoginRateLimitStatus {
  limited: boolean;
  /** Seconds until the oldest counted failure ages out of the window. */
  retryAfterSeconds: number;
}

export function checkLoginRateLimit(key: string): LoginRateLimitStatus {
  const now = Date.now();
  const timestamps = (loginFailures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);

  if (timestamps.length < LOGIN_MAX_ATTEMPTS) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - timestamps[0])) / 1000));
  return { limited: true, retryAfterSeconds };
}

/** Call after a failed sign-in. Never call this for a successful login. */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const timestamps = (loginFailures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  timestamps.push(now);
  loginFailures.set(key, timestamps);
}

/** Call after a successful login so a past run of typos doesn't linger. */
export function resetLoginFailures(key: string): void {
  loginFailures.delete(key);
}

/**
 * The public tyre-finder limiter.
 *
 * A limiter like this existed before, went away with the old AI-backed
 * "Caută cauciuc" feature (7957484), and is back because the finder is
 * again a public, unauthenticated endpoint that reaches the database.
 *
 * Deliberately far more generous than isRateLimited(): that one guards a
 * form somebody submits once, while a tyre shop checking a delivery will
 * legitimately scan a few dozen barcodes in a row. Too tight a limit here
 * does not stop a scraper — it stops a customer mid-job.
 */
const LOOKUP_WINDOW_MS = readPositiveIntEnv("TYRE_LOOKUP_RATE_LIMIT_WINDOW_MINUTES", 5) * 60 * 1000;
const LOOKUP_MAX_REQUESTS = readPositiveIntEnv("TYRE_LOOKUP_RATE_LIMIT_MAX_REQUESTS", 60);

const lookupHits = new Map<string, number[]>();

export function isTyreLookupRateLimited(key: string): boolean {
  const now = Date.now();

  if (lookupHits.size >= 500) {
    for (const [existing, timestamps] of lookupHits) {
      const recent = timestamps.filter((t) => now - t < LOOKUP_WINDOW_MS);
      if (recent.length === 0) lookupHits.delete(existing);
      else lookupHits.set(existing, recent);
    }
  }

  const timestamps = (lookupHits.get(key) ?? []).filter((t) => now - t < LOOKUP_WINDOW_MS);
  timestamps.push(now);
  lookupHits.set(key, timestamps);

  return timestamps.length > LOOKUP_MAX_REQUESTS;
}
