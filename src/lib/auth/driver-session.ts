import "server-only";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

/**
 * Phase 1 driver/operator session.
 *
 * ⚠️ SIMPLIFIED BY DESIGN. The driver picks who they are and which van they're
 * using; there is no password. That is the specified Phase 1 behaviour.
 *
 * It is still a signed server-side cookie rather than a value posted with each
 * request, for two reasons that matter operationally:
 *   * every scan endpoint reads the driver identity from ONE trusted place, so
 *     a request cannot claim a different driver than the session it's using
 *   * the wrong-driver protection is therefore enforced server-side, not by the
 *     phone being honest
 *
 * REPLACING THIS LATER: implement `getDriverSession()` against real
 * authentication (Supabase Auth + a `drivers.user_id` link) and return the same
 * shape. The scan routes and the /driver UI need no changes.
 */

const COOKIE_NAME = "gorush_driver_session";
const SESSION_TTL_SECONDS = 60 * 60 * 16; // one long shift

export interface DriverSession {
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  vehicleName: string | null;
  issuedAt: number;
  expiresAt: number;
  /** How this identity was established. Recorded on manual-override audits. */
  provider: "self-selected" | "supabase";
}

let ephemeralSecret: string | null = null;

function signingSecret(): string {
  const configured = process.env.DRIVER_SESSION_SECRET ?? process.env.ADMIN_SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (!ephemeralSecret) ephemeralSecret = randomBytes(32).toString("hex");
  return ephemeralSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

function signaturesMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function encodeDriverSession(session: DriverSession): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeDriverSession(token: string | undefined | null): DriverSession | null {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  if (!signaturesMatch(token.slice(separator + 1), sign(payload))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DriverSession;
    if (typeof parsed.driverId !== "string" || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createDriverSession(input: {
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  vehicleName: string | null;
}): DriverSession {
  const now = Date.now();
  return {
    ...input,
    issuedAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    provider: "self-selected",
  };
}

export function driverSessionCookie(session: DriverSession) {
  return {
    name: COOKIE_NAME,
    value: encodeDriverSession(session),
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function clearedDriverSessionCookie() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

export async function getDriverSession(): Promise<DriverSession | null> {
  const store = await cookies();
  return decodeDriverSession(store.get(COOKIE_NAME)?.value);
}

export const DRIVER_SESSION_COOKIE_NAME = COOKIE_NAME;
