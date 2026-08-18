import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import type { DriverRow, SupplierRow, VehicleRow } from "@/lib/types/logistics";

/** Lookups for drivers, vehicles and suppliers used across the admin screens. */

export async function listDrivers(activeOnly = true): Promise<DriverRow[]> {
  const supabase = createSupabaseAdminClient();
  let query = supabase.from("drivers").select("id, name, slug, phone, active").order("name");
  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as DriverRow[];
}

const VEHICLE_SELECT = "id, name, slug, registration, capacity_units, active, display_order, color_key";
const VEHICLE_SELECT_NO_FLEET_COLS = "id, name, slug, registration, capacity_units, active";
const VEHICLE_SELECT_MINIMAL = "id, name, slug, registration, active";

export async function listVehicles(activeOnly = true): Promise<VehicleRow[]> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("vehicles")
    .select(VEHICLE_SELECT)
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("name");
  if (activeOnly) query = query.eq("active", true);

  const primary = await query;

  if (isMissingSchemaError(primary.error)) {
    // display_order/color_key don't exist yet — the fleet-management
    // migration (supabase/migrations/20260823000000_fleet_management.sql)
    // hasn't been run. Degrade instead of crashing every page that lists
    // vehicles: the board just can't reorder lanes or show an accent color
    // until it's run.
    logError("vehicles_fleet_columns_missing", primary.error);
    let fallbackQuery = supabase.from("vehicles").select(VEHICLE_SELECT_NO_FLEET_COLS).order("name");
    if (activeOnly) fallbackQuery = fallbackQuery.eq("active", true);
    const fallback = await fallbackQuery;

    if (isMissingSchemaError(fallback.error)) {
      // capacity_units doesn't exist either — an even older DB state
      // (supabase/migrations/20260818000000_vehicle_board.sql not run).
      logError("vehicles_capacity_units_column_missing", fallback.error);
      let minimalQuery = supabase.from("vehicles").select(VEHICLE_SELECT_MINIMAL).order("name");
      if (activeOnly) minimalQuery = minimalQuery.eq("active", true);
      const minimal = await minimalQuery;
      if (minimal.error) throw minimal.error;
      return ((minimal.data ?? []) as unknown as Omit<VehicleRow, "capacity_units" | "display_order" | "color_key">[]).map(
        (vehicle) => ({ ...vehicle, capacity_units: null, display_order: null, color_key: null })
      );
    }

    if (fallback.error) throw fallback.error;
    return ((fallback.data ?? []) as unknown as Omit<VehicleRow, "display_order" | "color_key">[]).map(
      (vehicle) => ({ ...vehicle, display_order: null, color_key: null })
    );
  }

  if (primary.error) throw primary.error;
  return (primary.data ?? []) as unknown as VehicleRow[];
}

export async function listSuppliers(): Promise<SupplierRow[]> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, legal_name, vat_number, fiscal_code, website, email, phone, notes, active")
    .eq("active", true)
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as SupplierRow[];
}

export async function getDriver(driverId: string): Promise<DriverRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("drivers")
    .select("id, name, slug, phone, active")
    .eq("id", driverId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as DriverRow | null;
}

export async function getVehicle(vehicleId: string): Promise<VehicleRow | null> {
  const supabase = createSupabaseAdminClient();
  const primary = await supabase
    .from("vehicles")
    .select("id, name, slug, registration, capacity_units, active")
    .eq("id", vehicleId)
    .maybeSingle();

  if (isMissingSchemaError(primary.error)) {
    logError("vehicles_capacity_units_column_missing", primary.error);
    const fallback = await supabase
      .from("vehicles")
      .select("id, name, slug, registration, active")
      .eq("id", vehicleId)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    return fallback.data ? ({ ...fallback.data, capacity_units: null } as unknown as VehicleRow) : null;
  }

  if (primary.error) throw primary.error;
  return (primary.data ?? null) as unknown as VehicleRow | null;
}

/**
 * Finds a supplier by name or fiscal identifier during document import, or
 * creates one. Suppliers are operational reference data rather than customer
 * master data, so auto-creating one from a document is safe — unlike customers,
 * where a wrong guess corrupts delivery addresses.
 */
export async function findOrCreateSupplier(input: {
  name: string;
  vatNumber?: string | null;
}): Promise<SupplierRow> {
  const supabase = createSupabaseAdminClient();
  const name = input.name.trim();
  const vat = input.vatNumber?.replace(/[^A-Za-z0-9]/g, "").toUpperCase() ?? null;

  if (vat && vat.length >= 8) {
    const { data } = await supabase
      .from("suppliers")
      .select("id, name, legal_name, vat_number, fiscal_code, website, email, phone, notes, active")
      .ilike("vat_number", `%${vat.replace(/^[A-Z]{2}/, "")}%`)
      .limit(1)
      .maybeSingle();
    if (data) return data as unknown as SupplierRow;
  }

  const { data: byName } = await supabase
    .from("suppliers")
    .select("id, name, legal_name, vat_number, fiscal_code, website, email, phone, notes, active")
    .ilike("name", name)
    .limit(1)
    .maybeSingle();
  if (byName) return byName as unknown as SupplierRow;

  const { data: created, error } = await supabase
    .from("suppliers")
    .insert({ name, vat_number: input.vatNumber ?? null, active: true })
    .select("id, name, legal_name, vat_number, fiscal_code, website, email, phone, notes, active")
    .single();

  if (error) throw error;
  const supplier = created as unknown as SupplierRow;
  logEvent("supplier_created", { supplierId: supplier.id });
  return supplier;
}
