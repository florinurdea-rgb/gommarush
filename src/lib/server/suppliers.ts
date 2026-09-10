import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logEvent } from "@/lib/logger";
import type { SupplierRow } from "@/lib/types/logistics";

/**
 * Supplier profile CRUD for the admin "Furnizori" screen.
 *
 * Distinct from listSuppliers()/findOrCreateSupplier() in reference.ts —
 * those stay as the lightweight active-only lookup used by DDT import and
 * dropdowns; this file is the human-facing master-data editor (search,
 * order counts, full profile update), mirroring customers.ts.
 */

const SUPPLIER_COLUMNS =
  "id, name, legal_name, vat_number, fiscal_code, phone, email, website, notes, active, created_at, updated_at";

export interface SupplierWithOrderCount extends SupplierRow {
  order_count: number;
}

export async function listSuppliersWithCounts(search?: string): Promise<SupplierWithOrderCount[]> {
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("suppliers")
    .select(`${SUPPLIER_COLUMNS}, orders ( id )`)
    .order("name", { ascending: true });

  if (search && search.trim()) {
    const term = search.trim().replace(/[%,]/g, "");
    query = query.or(`name.ilike.%${term}%,vat_number.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as unknown as (SupplierRow & { orders: { id: string }[] | null })[]).map((row) => {
    const { orders, ...supplier } = row;
    return { ...supplier, order_count: orders?.length ?? 0 };
  });
}

export async function getSupplier(supplierId: string): Promise<SupplierRow | null> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select(SUPPLIER_COLUMNS)
    .eq("id", supplierId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as SupplierRow | null;
}

export interface SupplierInput {
  name: string;
  legal_name?: string | null;
  vat_number?: string | null;
  fiscal_code?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export async function createSupplier(input: SupplierInput): Promise<SupplierRow> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({ ...input, active: true })
    .select(SUPPLIER_COLUMNS)
    .single();

  if (error) throw error;
  const supplier = data as unknown as SupplierRow;
  logEvent("supplier_created", { supplierId: supplier.id });
  return supplier;
}

export async function updateSupplier(supplierId: string, input: Partial<SupplierInput>): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("suppliers").update(input).eq("id", supplierId);
  if (error) throw error;
  logEvent("supplier_updated", { supplierId });
}
