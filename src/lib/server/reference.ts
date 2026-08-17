import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logEvent } from "@/lib/logger";
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

export async function listVehicles(activeOnly = true): Promise<VehicleRow[]> {
  const supabase = createSupabaseAdminClient();
  let query = supabase
    .from("vehicles")
    .select("id, name, slug, registration, active")
    .order("name");
  if (activeOnly) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as VehicleRow[];
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
  const { data, error } = await supabase
    .from("vehicles")
    .select("id, name, slug, registration, active")
    .eq("id", vehicleId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as VehicleRow | null;
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
