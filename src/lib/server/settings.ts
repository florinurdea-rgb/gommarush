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
