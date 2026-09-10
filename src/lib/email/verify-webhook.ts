import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Svix webhook signature verification, as used by Resend.
 *
 * Implemented directly against node:crypto rather than pulling in the `svix`
 * package: the scheme is one HMAC and the dependency would be a supply-chain
 * surface added for ~20 lines of code.
 *
 * The scheme:
 *   signed content = `${svix-id}.${svix-timestamp}.${rawBody}`
 *   signature      = base64( HMAC-SHA256( base64decode(secret after "whsec_"),
 *                                         signed content ) )
 *   the `svix-signature` header carries one or more space-separated
 *   `v1,<signature>` entries — more than one during a secret rotation, so
 *   ANY matching entry is a pass.
 *
 * The raw body must be the exact bytes received. Re-serialising parsed JSON
 * changes key order and whitespace and every signature then fails.
 */

/** Reject anything older than this, so a captured request cannot be replayed. */
const TOLERANCE_SECONDS = 5 * 60;

export type VerifyResult =
  | { valid: true; eventId: string }
  | { valid: false; reason: string };

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on a length mismatch; compare lengths first, and
  // accept that the length itself is not secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function verifyResendWebhook(input: {
  rawBody: string;
  secret: string | undefined;
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  /** Injectable for tests; defaults to now. */
  nowSeconds?: number;
}): VerifyResult {
  const { rawBody, secret, headers } = input;

  if (!secret) return { valid: false, reason: "WEBHOOK_SECRET_NOT_CONFIGURED" };
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { valid: false, reason: "MISSING_SIGNATURE_HEADERS" };
  }

  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return { valid: false, reason: "INVALID_TIMESTAMP" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > TOLERANCE_SECONDS) {
    return { valid: false, reason: "TIMESTAMP_OUT_OF_TOLERANCE" };
  }

  // Secrets are given as "whsec_<base64>"; the raw key is the decoded part.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawSecret, "base64");
  } catch {
    return { valid: false, reason: "MALFORMED_SECRET" };
  }
  if (key.length === 0) return { valid: false, reason: "MALFORMED_SECRET" };

  const expected = createHmac("sha256", key)
    .update(`${headers.id}.${headers.timestamp}.${rawBody}`)
    .digest("base64");

  // Several versioned signatures may be present during a rotation.
  const provided = headers.signature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [version, value] = part.split(",");
      return { version, value };
    })
    .filter((entry) => entry.version === "v1" && entry.value);

  if (provided.length === 0) return { valid: false, reason: "NO_V1_SIGNATURE" };

  const matched = provided.some((entry) => safeEqual(entry.value, expected));
  if (!matched) return { valid: false, reason: "SIGNATURE_MISMATCH" };

  return { valid: true, eventId: headers.id };
}

/**
 * Maps a Resend event type onto our notification state.
 *
 * `email.sent` deliberately does NOT map to 'delivered'. The provider
 * accepting a message is not the mailbox receiving it, and treating them as
 * the same is how a system reports healthy mail while everything bounces.
 */
export function mapResendEventType(
  eventType: string
): { status: "sent" | "delivered" | "failed"; error?: string } | null {
  switch (eventType) {
    case "email.sent":
      return { status: "sent" };
    case "email.delivered":
      return { status: "delivered" };
    case "email.bounced":
      return { status: "failed", error: "bounced" };
    case "email.complained":
      return { status: "failed", error: "marked as spam" };
    case "email.delivery_delayed":
      // Still in flight — nothing to change yet.
      return null;
    default:
      return null;
  }
}
