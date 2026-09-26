import { timingSafeEqual } from "node:crypto";

// Authentication for the Inter-Sprint feed worker.
//
// A SEPARATE IDENTITY FROM AN ADMIN SESSION, on purpose. The worker is a
// script on a small FTP VM that is, by the nature of its job, reachable from
// the internet on port 21. Giving it an operator's session — or worse, the
// Supabase service-role key, which bypasses RLS on customers, orders and the
// whole logistics system — would make that box a full-database credential
// holder. It holds one token that can do exactly one thing: submit a supplier
// feed for ingestion.
//
// The token is compared in constant time. A naive `===` on a secret leaks its
// prefix through timing, and this endpoint is unauthenticated until the
// comparison succeeds, so it is the one place an attacker can iterate against.

export type FeedAuthFailure =
  /** No token is configured on the server: the endpoint is disabled. */
  | "not_configured"
  /** No Authorization header, or not a Bearer token. */
  | "missing"
  /** A token was presented and did not match. */
  | "invalid";

export type FeedAuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: FeedAuthFailure };

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Lengths are compared first because timingSafeEqual throws on a mismatch —
 * that one bit of leakage is unavoidable and harmless next to the alternative.
 */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Authenticates a feed-worker request.
 *
 * Fails closed in every direction. An unset `FEED_WORKER_TOKEN` disables the
 * endpoint outright rather than leaving it open — an ingestion endpoint that
 * accepts anything because nobody configured a secret is worse than one that
 * refuses everything, because the first looks like it is working.
 *
 * A token shorter than 32 characters is refused as unconfigured too: the
 * endpoint writes to the catalogue, and a guessable token is not a token.
 */
export function authenticateFeedWorker(
  authorizationHeader: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): FeedAuthResult {
  const expected = env.FEED_WORKER_TOKEN?.trim();
  if (!expected || expected.length < 32) {
    return { ok: false, reason: "not_configured" };
  }

  const header = authorizationHeader?.trim();
  if (!header) return { ok: false, reason: "missing" };

  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return { ok: false, reason: "missing" };

  return secretsMatch(match[1].trim(), expected)
    ? { ok: true }
    : { ok: false, reason: "invalid" };
}

/** The HTTP status a failure should produce. Never leaks which token was wrong. */
export function statusForFeedAuthFailure(reason: FeedAuthFailure): number {
  // 503, not 401: the endpoint is not refusing this caller, it is switched off.
  return reason === "not_configured" ? 503 : 401;
}
