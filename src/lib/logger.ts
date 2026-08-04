import "server-only";

/**
 * Thin logging wrapper for server-side routes. Deliberately takes a
 * plain string message plus a small metadata object rather than
 * arbitrary objects, so call sites can't accidentally dump a full
 * request payload (contact details, tyre list, headers) into the logs.
 */
export function logEvent(event: string, meta: Record<string, string | number | boolean | null> = {}) {
  console.log(JSON.stringify({ event, ...meta, ts: new Date().toISOString() }));
}

export function logError(event: string, error: unknown, meta: Record<string, string | number | boolean | null> = {}) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(JSON.stringify({ event, message, ...meta, ts: new Date().toISOString() }));
}
