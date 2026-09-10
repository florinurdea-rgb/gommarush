// Gateway error taxonomy.
//
// The gateway does not use HTTP status codes to signal business failures. A
// failed call is a 200 whose body is a two-digit code and a description
// (Manual §1.2: "In case of an error situation, only an error code with an
// explanation will be returned (no other output)"). So the body has to be
// inspected on every response, and a 200 means nothing on its own.
//
// Codes are transcribed from Appendix 3.

export type GatewayErrorKind =
  | "configuration"
  | "ordering_disabled"
  | "request_too_long"
  | "timeout"
  | "transport"
  | "http"
  | "gateway"
  | "parse";

export interface GatewayErrorContext {
  correlationId: string;
  partner: string;
  environment: string;
  protocol: string;
  durationMs: number | null;
}

export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly context: Partial<GatewayErrorContext>;
  /** The supplier's own two-digit code, when the gateway returned one. */
  readonly gatewayCode: string | null;
  /** Whether trying the same call again could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    kind: GatewayErrorKind,
    message: string,
    options: {
      context?: Partial<GatewayErrorContext>;
      gatewayCode?: string | null;
      retryable?: boolean;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
    this.context = options.context ?? {};
    this.gatewayCode = options.gatewayCode ?? null;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Appendix 3. Not exhaustive by design — the live list is available through
 * protocol 15, and an unknown code must never be treated as success. These
 * are the ones worth naming in code because behaviour depends on them.
 */
export const GATEWAY_ERROR_TEXT: Record<string, string> = {
  "44": "system in maintenance",
  "45": "too much input",
  "49": "empty input",
  "50": "invalid customer number",
  "51": "customer number does not exist",
  "52": "delivery address does not exist",
  "54": "invalid item code",
  "55": "invalid quantity",
  "56": "price could not be determined",
  "57": "invalid date",
  "58": "invalid delivery method",
  "59": "invalid field",
  "63": "invalid postal code",
  "65": "existing order with same reference",
  "66": "delivery method not possible with this item",
  "68": "empty value",
  "87": "invalid test value",
  "91": "ordering is not allowed",
  "92": "not enough stock",
  "93": "order in use",
  "94": "order error",
  "95": "maximum hits per day reached",
  "96": "maximum hits per period reached",
  "97": "invalid license",
  "98": "url too long (max 1800 chars)",
  "99": "error",
};

/**
 * Codes worth retrying. Deliberately tiny.
 *
 * 44 is scheduled maintenance and 96 is a per-period rate limit — both pass.
 * Everything else is a rejected request that will be rejected identically
 * next time. 95 (per-DAY limit) is excluded on purpose: retrying inside the
 * same day cannot help and only burns quota.
 *
 * Note this is consulted for READ calls only. An order is never retried
 * automatically, whatever the code, because a timeout on an order entry can
 * mean the order landed.
 */
const RETRYABLE_CODES = new Set(["44", "96"]);

export function isRetryableGatewayCode(code: string): boolean {
  return RETRYABLE_CODES.has(code);
}

export function describeGatewayCode(code: string): string {
  return GATEWAY_ERROR_TEXT[code] ?? "unknown gateway error";
}
