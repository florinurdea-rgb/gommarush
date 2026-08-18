import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError, logEvent } from "@/lib/logger";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { VEHICLE_COLOR_KEYS } from "@/lib/types/logistics";
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

// ---------------------------------------------------------------------------
// Fleet management — add/rename/reorder/remove vans (redesign brief §12-24).
// ---------------------------------------------------------------------------

/** Adds a van at the end of the display order, assigning a color deterministically from how many vehicles ever existed. */
export async function createVehicle(input: { name: string; registration?: string | null }): Promise<VehicleRow> {
  const supabase = createSupabaseAdminClient();
  const name = input.name.trim();

  const { count } = await supabase.from("vehicles").select("id", { count: "exact", head: true });
  const colorKey = VEHICLE_COLOR_KEYS[(count ?? 0) % VEHICLE_COLOR_KEYS.length];

  // display_order defaults to "after everything" even before this query runs
  // (nulls sort last in listVehicles' ordering) — this is just for a nicer
  // initial position, so a failure here degrades to null rather than
  // blocking the insert.
  let nextOrder: number | null = null;
  const maxOrderResult = await supabase
    .from("vehicles")
    .select("display_order")
    .order("display_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!isMissingSchemaError(maxOrderResult.error) && !maxOrderResult.error) {
    nextOrder = ((maxOrderResult.data as { display_order: number | null } | null)?.display_order ?? 0) + 1;
  }

  const primary = await supabase
    .from("vehicles")
    .insert({
      name,
      registration: input.registration?.trim() || null,
      active: true,
      display_order: nextOrder,
      color_key: colorKey,
    })
    .select(VEHICLE_SELECT)
    .single();

  if (isMissingSchemaError(primary.error)) {
    // The fleet-management migration (display_order/color_key columns)
    // hasn't reached this database yet — still let the van get created,
    // just without a lane order or accent color until it has.
    logError("vehicles_fleet_columns_missing_on_insert", primary.error);
    const fallback = await supabase
      .from("vehicles")
      .insert({ name, registration: input.registration?.trim() || null, active: true })
      .select(VEHICLE_SELECT_NO_FLEET_COLS)
      .single();

    if (isMissingSchemaError(fallback.error)) {
      // capacity_units doesn't exist either — an even older DB state
      // (20260818000000_vehicle_board.sql hasn't run either). Same
      // insert, degrade the select further.
      logError("vehicles_capacity_units_column_missing_on_insert", fallback.error);
      const minimal = await supabase
        .from("vehicles")
        .insert({ name, registration: input.registration?.trim() || null, active: true })
        .select(VEHICLE_SELECT_MINIMAL)
        .single();
      if (minimal.error) throw minimal.error;
      const vehicle = {
        ...(minimal.data as object),
        capacity_units: null,
        display_order: null,
        color_key: null,
      } as unknown as VehicleRow;
      logEvent("vehicle_created", { vehicleId: vehicle.id, name });
      return vehicle;
    }

    if (fallback.error) throw fallback.error;
    const vehicle = { ...(fallback.data as object), display_order: null, color_key: null } as unknown as VehicleRow;
    logEvent("vehicle_created", { vehicleId: vehicle.id, name });
    return vehicle;
  }

  if (primary.error) throw primary.error;
  const vehicle = primary.data as unknown as VehicleRow;
  logEvent("vehicle_created", { vehicleId: vehicle.id, name });
  return vehicle;
}

export async function renameVehicle(vehicleId: string, name: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("vehicles").update({ name: name.trim() }).eq("id", vehicleId);
  if (error) throw error;
  logEvent("vehicle_renamed", { vehicleId });
}

/** Bulk-persists the Kanban lane order after a drag-reorder in the fleet management sheet. */
export async function reorderVehicles(orderedVehicleIds: string[]): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const results = await Promise.all(
    orderedVehicleIds.map((id, index) => supabase.from("vehicles").update({ display_order: index + 1 }).eq("id", id))
  );
  const failed = results.find((result) => result.error);
  if (isMissingSchemaError(failed?.error)) {
    // The fleet-management migration hasn't reached this database yet —
    // reordering just can't persist until it has, but that's no reason to
    // fail the request with a scary error for an otherwise-optional action.
    logError("vehicles_display_order_column_missing_on_write", failed?.error);
    return;
  }
  if (failed?.error) throw failed.error;
  logEvent("vehicles_reordered", { count: orderedVehicleIds.length });
}

/**
 * Safe van removal (redesign brief §17-22): reassigns every active order
 * still pointing at this vehicle to "Neasignate" (vehicle_id/delivery_sequence
 * cleared, operational status untouched) and soft-deactivates the vehicle —
 * see gorush_remove_vehicle in 20260823000000_fleet_management.sql for why
 * this is one atomic RPC rather than two separate application-side updates,
 * and why removal is active=false rather than a hard delete (historical
 * Sumar reporting must keep showing a removed van's past deliveries).
 */
/**
 * Returns a result object rather than throwing on a business-rule failure
 * (vehicle not found / already removed) — this project's route handlers
 * have already hit real bugs from `instanceof Error` failing across module
 * boundaries in this bundling setup (see describeError() in
 * route-helpers.ts), so callers that need to branch on the outcome get a
 * plain, duck-type-free result instead of having to inspect a thrown value.
 */
export async function removeVehicle(
  vehicleId: string,
  operator?: string | null
): Promise<{ ok: boolean; code: string; reassignedOrders: number }> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("gorush_remove_vehicle", {
    p_vehicle_id: vehicleId,
    p_operator: operator ?? null,
  });
  if (error) throw error;

  const result = data as { ok: boolean; code: string; reassigned_orders?: number };
  if (result.ok) {
    logEvent("vehicle_removed", { vehicleId, reassignedOrders: result.reassigned_orders ?? 0 });
  }
  return { ok: result.ok, code: result.code, reassignedOrders: result.reassigned_orders ?? 0 };
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
