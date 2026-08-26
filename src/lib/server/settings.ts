import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

/**
 * Small key/value settings store (app_settings). Currently just one key,
 * transport_rate_per_tyre — kept out of code so a rate change doesn't need
 * a redeploy. Every order freezes the rate it used at creation time
 * (orders.transport_rate_snapshot), so changing this never rewrites
 * historical revenue.
 */

const DEFAULT_TRANSPORT_RATE_PER_TYRE = 2.0;

export async function getTransportRatePerTyre(): Promise<number> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "transport_rate_per_tyre")
    .maybeSingle();

  if (error || !data) return DEFAULT_TRANSPORT_RATE_PER_TYRE;

  const value = (data as { value: unknown }).value;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_TRANSPORT_RATE_PER_TYRE;
}

export async function setTransportRatePerTyre(rate: number): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "transport_rate_per_tyre", value: rate, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export interface DepotLocation {
  lat: number;
  lng: number;
}

/**
 * The warehouse's own coordinates — every vehicle's route starts here, so
 * the "Mappa" view marks it as the departure point rather than starting
 * the map cold at the first delivery stop. Defaulted in code (not just in
 * the DB) so the map still shows a departure point before the seeding
 * migration has run.
 */
const DEFAULT_DEPOT_LOCATION: DepotLocation = { lat: 45.508255, lng: 11.511971 };

export async function getDepotLocation(): Promise<DepotLocation> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "depot_location")
    .maybeSingle();

  if (error || !data) return DEFAULT_DEPOT_LOCATION;

  const value = (data as { value: unknown }).value as { lat?: unknown; lng?: unknown } | null;
  const lat = Number(value?.lat);
  const lng = Number(value?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : DEFAULT_DEPOT_LOCATION;
}

export async function setDepotLocation(location: DepotLocation): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: "depot_location", value: location, updated_at: new Date().toISOString() });
  if (error) throw error;
}
