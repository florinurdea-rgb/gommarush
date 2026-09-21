// Deldo API error taxonomy.
//
// Deldo signals business failures inside a 200 response body ("success": "0"),
// so an HTTP status is never sufficient on its own. The kinds below separate
// the three questions a caller actually has: did we fail to ask, did the
// network fail, or did the supplier answer something we cannot use.
//
// An "Unknown article" is NOT in this taxonomy. It is a normal commercial
// answer — Deldo does not carry that tyre — and is returned as a typed
// outcome, not thrown. Turning a routine answer into an exception is how
// catch-blocks end up swallowing real transport failures.

export type DeldoApiErrorKind =
  | "configuration"
  | "timeout"
  | "transport"
  | "http"
  | "parse";

export class DeldoApiError extends Error {
  readonly kind: DeldoApiErrorKind;
  readonly retryable: boolean;

  constructor(
    kind: DeldoApiErrorKind,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "DeldoApiError";
    this.kind = kind;
    // Only transport-level faults are worth repeating. A malformed body or a
    // bad configuration will be exactly as malformed on a second attempt.
    this.retryable = options.retryable ?? (kind === "timeout" || kind === "transport");
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * Removes the API token from any string before it reaches a log, an error
 * message or a screen.
 *
 * The token travels as a URL query parameter, which means it lands in the one
 * place people paste freely: a URL in an error. Redaction happens at the
 * boundary — every message in this module passes through here — rather than
 * relying on each call site to remember.
 */
export function redactToken(text: string, token: string): string {
  let output = text;
  if (token) output = output.split(token).join("***REDACTED***");
  // Also catch a token that arrived from elsewhere, or a rotated one still in
  // flight, by matching the parameter itself.
  return output.replace(/([?&]token=)[^&\s]*/gi, "$1***REDACTED***");
}
