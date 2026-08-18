import "server-only";
import { NextResponse } from "next/server";
import { requireAdminSession, UnauthorizedError } from "@/lib/auth/admin-session";
import { getDriverSession } from "@/lib/auth/driver-session";
import { logError } from "@/lib/logger";
import type { AdminSession } from "@/lib/auth/admin-session";
import type { DriverSession } from "@/lib/auth/driver-session";

/**
 * Shared plumbing for the logistics route handlers.
 *
 * Two things this exists to guarantee:
 *   1. every privileged route checks the session SERVER-side, in one place
 *   2. no failure is silently swallowed — everything is logged with a code and
 *      returned as a machine-readable error the UI maps to Romanian
 */

export interface ApiError {
  ok: false;
  code: string;
  /** Field-level detail for validation failures. Never includes user data. */
  details?: string[];
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

export function fail(status: number, code: string, details?: string[]) {
  return NextResponse.json<ApiError>({ ok: false, code, ...(details ? { details } : {}) }, { status });
}

export function ok<T extends Record<string, unknown>>(payload: T, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

const MAX_JSON_BYTES = 300_000;

/** Reads and size-limits a JSON body. Returns null on anything malformed. */
export async function readJsonBody(request: Request): Promise<unknown | null> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;

  try {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Wraps an admin route handler: enforces the session server-side and converts
 * thrown errors into logged, coded JSON responses.
 *
 * The handler's response type is deliberately left as the un-parameterised
 * `NextResponse`: every handler mixes success payloads with `fail()` errors, so
 * pinning a single body type here would only force casts at each call site.
 */
export async function runAdminRoute(
  handler: (session: AdminSession) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const session = await requireAdminSession();
    return await handler(session);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Driver routes. The driver identity comes from the signed cookie only — never
 * from the request body — so a phone cannot claim to be a different driver.
 */
export async function runDriverRoute(
  handler: (session: DriverSession) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const session = await getDriverSession();
    if (!session) return fail(401, "NO_DRIVER_SESSION");
    return await handler(session);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Warehouse routes (storage scanning). Accepts either an admin session or a
 * driver session: the storage station is operated by whoever is on shift, and
 * whichever identity was used is recorded on the scan.
 */
export async function runWarehouseRoute(
  handler: (operator: string) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const driver = await getDriverSession();
    if (driver) return await handler(`driver:${driver.driverName}`);

    const admin = await requireAdminSession();
    return await handler(admin.subject);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Extracts a human-useful detail string from whatever got thrown, WITHOUT
 * relying on `instanceof Error` — Supabase/PostgREST errors do extend
 * Error in the installed version, but that check has still been observed
 * to fail here (a Next.js route handler bundles server code per-route, and
 * a class identity check can fail across that boundary even for a
 * genuinely Error-descended object). Duck-typing the fields PostgrestError
 * actually carries (code/message/details/hint) works regardless of the
 * prototype chain, and `hint` in particular is often the actually-useful
 * field per Supabase's own docs — logging only `.message` misses it.
 */
export function describeError(error: unknown): string[] {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
    const parts = [
      typeof candidate.code === "string" ? `[${candidate.code}]` : null,
      typeof candidate.message === "string" ? candidate.message : null,
      typeof candidate.details === "string" ? candidate.details : null,
      typeof candidate.hint === "string" ? `hint: ${candidate.hint}` : null,
    ].filter((part): part is string => Boolean(part));
    if (parts.length > 0) return [parts.join(" — ")];
  }
  if (typeof error === "string" && error.trim()) return [error];
  return ["eroare necunoscută"];
}

export function handleRouteError(error: unknown): NextResponse<ApiError> {
  if (error instanceof UnauthorizedError) {
    return fail(401, "UNAUTHORIZED");
  }

  // Supabase config missing is the most common deployment mistake; give it a
  // distinct code so the message can say what to fix.
  if (error instanceof Error && error.message === "Missing Supabase server configuration") {
    logError("route_supabase_unconfigured", error);
    return fail(500, "SUPABASE_NOT_CONFIGURED");
  }

  logError("route_unhandled_error", error);
  return fail(500, "UNKNOWN", describeError(error));
}

/** Flattens a Zod error into safe field paths — never the submitted values. */
export function zodDetails(error: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  return error.issues.slice(0, 10).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}
