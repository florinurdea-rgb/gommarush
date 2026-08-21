import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";

/**
 * Driver authentication via Supabase Auth — same mechanism and the same
 * cookie adapter as src/lib/auth/admin-session.ts (see that file's doc
 * comment for why: the cookie pair is managed by Supabase's own client
 * code and middleware.ts transparently refreshes it).
 *
 * REPLACES the Phase 1 "pick who you are, no password" design: that
 * session was a self-signed cookie with no real authentication behind
 * it — any phone could claim to be any driver. Authentication vs.
 * authorization here works the same way admin does: a valid Supabase
 * user is not automatically a driver. Only a user whose id is linked to
 * an active `drivers` row (drivers.auth_user_id) gets a driver session.
 *
 * Linking a driver: an admin creates the Supabase Auth user (dashboard →
 * Authentication → Users, "Auto Confirm User") with the SAME email as the
 * driver's `drivers.email`. On that driver's first successful sign-in,
 * `auth_user_id` is filled in automatically (a one-time "claim" by email)
 * — no separate admin UI needed. Every sign-in after that matches by
 * `auth_user_id` directly.
 *
 * Vehicle selection is a separate, lower-stakes concern (drivers.
 * current_vehicle_id): it is not part of authentication, so it is never
 * used to decide who someone is — only which van they're driving today.
 */

export interface DriverSession {
  driverId: string;
  driverName: string;
  vehicleId: string | null;
  vehicleName: string | null;
  provider: "supabase";
}

interface DriverRow {
  id: string;
  name: string;
  active: boolean;
  auth_user_id: string | null;
  current_vehicle_id: string | null;
  vehicles: { name: string } | null;
}

const DRIVER_SELECT = "id, name, active, auth_user_id, current_vehicle_id, vehicles ( name )";

/**
 * Reads the current Supabase Auth session and resolves it to a driver.
 * Returns null when not signed in, or signed in as a Supabase user with
 * no linked (or linkable) active driver row.
 */
export async function getDriverSession(): Promise<DriverSession | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    const admin = createSupabaseAdminClient();

    const byAuthId = await admin
      .from("drivers")
      .select(DRIVER_SELECT)
      .eq("auth_user_id", data.user.id)
      .eq("active", true)
      .maybeSingle();
    if (byAuthId.error) throw byAuthId.error;

    let driver = byAuthId.data as unknown as DriverRow | null;

    if (!driver && data.user.email) {
      // One-time claim: an unlinked active driver row whose email matches
      // this Supabase user's email adopts this auth_user_id. Scoped to
      // auth_user_id IS NULL so a driver can never be re-parented onto a
      // different Supabase user by someone else signing up with the same
      // email later.
      const claimed = await admin
        .from("drivers")
        .update({ auth_user_id: data.user.id })
        .is("auth_user_id", null)
        .eq("active", true)
        .ilike("email", data.user.email)
        .select(DRIVER_SELECT)
        .maybeSingle();
      if (claimed.error) throw claimed.error;
      driver = claimed.data as unknown as DriverRow | null;
      if (driver) logEvent("driver_account_claimed", { driverId: driver.id, authUserId: data.user.id });
    }

    if (!driver) return null;

    return {
      driverId: driver.id,
      driverName: driver.name,
      vehicleId: driver.current_vehicle_id,
      vehicleName: driver.vehicles?.name ?? null,
      provider: "supabase",
    };
  } catch (error) {
    logError("driver_session_check_failed", error);
    return null;
  }
}

export class DriverUnauthorizedError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "DriverUnauthorizedError";
  }
}

export async function requireDriverSession(): Promise<DriverSession> {
  const session = await getDriverSession();
  if (!session) throw new DriverUnauthorizedError();
  return session;
}

/**
 * Sets the authenticated driver's van for today. Server-side only, and
 * scoped to the driver's own id — never accepts a driver id from the
 * caller, so a request can only ever change the vehicle for the driver
 * making it.
 */
export async function setDriverVehicle(driverId: string, vehicleId: string | null): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("drivers").update({ current_vehicle_id: vehicleId }).eq("id", driverId);
  if (error) throw error;
  logEvent("driver_vehicle_selected", { driverId, vehicleId: vehicleId ?? "none" });
}
