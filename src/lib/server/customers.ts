import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logEvent } from "@/lib/logger";
import { matchCustomer } from "@/lib/logistics/customer-matching";
import type {
  CustomerMatchResult,
  ExtractedCustomer,
  ExtractedLocation,
  LocationResolution,
} from "@/lib/logistics/customer-matching";
import type { CustomerLocationRow, CustomerRow } from "@/lib/types/logistics";

/**
 * Customer + delivery-location operations.
 *
 * The rule this file exists to protect: a scanned document NEVER silently
 * overwrites customer master data. Every write here is either an explicit
 * create, or an update the Admin asked for by choosing a resolution.
 */

const CUSTOMER_COLUMNS =
  "id, name, legal_name, vat_number, fiscal_code, email, phone, notes, active, created_at, updated_at";

const LOCATION_COLUMNS =
  "id, customer_id, location_name, recipient_name, address_line1, address_line2, city, province, region, postal_code, country_code, phone, email, contact_name, delivery_notes, is_primary, active";

export interface CustomerWithLocationCount extends CustomerRow {
  location_count: number;
  order_count: number;
}

export async function listCustomers(search?: string): Promise<CustomerWithLocationCount[]> {
  const supabase = createSupabaseAdminClient();

  let query = supabase
    .from("customers")
    .select(`${CUSTOMER_COLUMNS}, customer_locations ( id ), orders ( id )`)
    .order("name", { ascending: true });

  if (search && search.trim()) {
    const term = search.trim().replace(/[%,]/g, "");
    // Match on either the company name or the fiscal identifier, which is how
    // office staff actually search.
    query = query.or(`name.ilike.%${term}%,vat_number.ilike.%${term}%`);
  }

  const { data, error } = await query;
  if (error) throw error;

  return ((data ?? []) as unknown as (CustomerRow & {
    customer_locations: { id: string }[] | null;
    orders: { id: string }[] | null;
  })[]).map((row) => {
    const { customer_locations, orders, ...customer } = row;
    return {
      ...customer,
      location_count: customer_locations?.length ?? 0,
      order_count: orders?.length ?? 0,
    };
  });
}

export async function getCustomerWithLocations(
  customerId: string
): Promise<{ customer: CustomerRow; locations: CustomerLocationRow[] } | null> {
  const supabase = createSupabaseAdminClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select(CUSTOMER_COLUMNS)
    .eq("id", customerId)
    .maybeSingle();

  if (error) throw error;
  if (!customer) return null;

  const { data: locations, error: locationError } = await supabase
    .from("customer_locations")
    .select(LOCATION_COLUMNS)
    .eq("customer_id", customerId)
    .order("is_primary", { ascending: false })
    .order("location_name", { ascending: true });

  if (locationError) throw locationError;

  return {
    customer: customer as unknown as CustomerRow,
    locations: (locations ?? []) as unknown as CustomerLocationRow[],
  };
}

export interface CustomerInput {
  name: string;
  legal_name?: string | null;
  vat_number?: string | null;
  fiscal_code?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export async function createCustomer(input: CustomerInput): Promise<CustomerRow> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("customers")
    .insert({ ...input, active: true })
    .select(CUSTOMER_COLUMNS)
    .single();

  if (error) throw error;
  const customer = data as unknown as CustomerRow;
  logEvent("customer_created", { customerId: customer.id });
  return customer;
}

export async function updateCustomer(customerId: string, input: Partial<CustomerInput>): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("customers").update(input).eq("id", customerId);
  if (error) throw error;
  logEvent("customer_updated", { customerId });
}

/**
 * address_line1 and city are NOT NULL in `customer_locations`, so a location can
 * only be created with both. A partial address extracted from a document
 * therefore lives on the order snapshot instead — which is also exactly what
 * "use this address for this order only" needs.
 */
export interface CustomerLocationInput {
  location_name?: string | null;
  recipient_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  province?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_name?: string | null;
  delivery_notes?: string | null;
  is_primary?: boolean;
}

export async function createCustomerLocation(
  customerId: string,
  input: CustomerLocationInput
): Promise<CustomerLocationRow> {
  const supabase = createSupabaseAdminClient();

  // A company's first location becomes its primary one automatically.
  const { count, error: countError } = await supabase
    .from("customer_locations")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId);
  if (countError) throw countError;

  const isPrimary = input.is_primary ?? (count ?? 0) === 0;

  if (isPrimary) await clearPrimaryFlag(customerId);

  const { data, error } = await supabase
    .from("customer_locations")
    .insert({
      ...input,
      customer_id: customerId,
      // Satisfies the NOT NULL columns without inventing a real address: a
      // visible placeholder is obviously wrong in the UI, a fabricated street
      // name is not.
      address_line1: input.address_line1?.trim() || "—",
      city: input.city?.trim() || "—",
      country_code: input.country_code?.trim() || "IT",
      is_primary: isPrimary,
      active: true,
    })
    .select(LOCATION_COLUMNS)
    .single();

  if (error) throw error;
  const location = data as unknown as CustomerLocationRow;
  logEvent("customer_location_created", { customerId, locationId: location.id });
  return location;
}

async function clearPrimaryFlag(customerId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("customer_locations")
    .update({ is_primary: false })
    .eq("customer_id", customerId);
  if (error) throw error;
}

export async function updateCustomerLocation(
  locationId: string,
  input: Partial<CustomerLocationInput>
): Promise<void> {
  const supabase = createSupabaseAdminClient();

  if (input.is_primary) {
    const { data: location, error } = await supabase
      .from("customer_locations")
      .select("customer_id")
      .eq("id", locationId)
      .maybeSingle();
    if (error) throw error;
    if (location) await clearPrimaryFlag((location as { customer_id: string }).customer_id);
  }

  const { error } = await supabase.from("customer_locations").update(input).eq("id", locationId);
  if (error) throw error;
  logEvent("customer_location_updated", { locationId });
}

// ---------------------------------------------------------------------------
// Matching for document import
// ---------------------------------------------------------------------------

/**
 * Compares extracted document data against the customer database.
 *
 * The candidate set is narrowed in SQL before the pure matcher runs, because
 * loading every customer to score them would not survive a real customer list.
 * Narrowing is deliberately generous (name prefix OR identifier OR known
 * supplier code) so a genuine match is not missed by an over-tight filter.
 */
export async function matchCustomerFromDocument(input: {
  extractedCustomer: ExtractedCustomer;
  extractedLocation: ExtractedLocation;
  supplierId?: string | null;
}): Promise<CustomerMatchResult> {
  const supabase = createSupabaseAdminClient();
  const { extractedCustomer, extractedLocation, supplierId } = input;

  // 1. Has this supplier's customer code been seen before?
  let supplierRefCustomerId: string | null = null;
  if (supplierId && extractedCustomer.supplierCustomerCode) {
    const { data } = await supabase
      .from("supplier_customer_refs")
      .select("customer_id")
      .eq("supplier_id", supplierId)
      .ilike("supplier_customer_code", extractedCustomer.supplierCustomerCode.trim())
      .maybeSingle();
    supplierRefCustomerId = (data as { customer_id: string } | null)?.customer_id ?? null;
  }

  // 2. Build a candidate pool.
  const filters: string[] = [];
  const name = extractedCustomer.companyName?.trim().replace(/[%,()]/g, "");
  if (name) {
    // First significant word of the company name — wide enough to catch
    // "Rossi Gomme SRL" from "ROSSI GOMME S.R.L.", narrow enough to be indexed.
    const firstWord = name.split(/\s+/)[0];
    if (firstWord && firstWord.length >= 3) filters.push(`name.ilike.%${firstWord}%`);
  }
  const vat = extractedCustomer.vatNumber?.replace(/[^A-Za-z0-9]/g, "");
  if (vat && vat.length >= 8) {
    // Match with or without the country prefix.
    filters.push(`vat_number.ilike.%${vat.replace(/^[A-Za-z]{2}/, "")}%`);
  }
  if (supplierRefCustomerId) filters.push(`id.eq.${supplierRefCustomerId}`);

  let customers: CustomerRow[] = [];
  if (filters.length > 0) {
    const { data, error } = await supabase
      .from("customers")
      .select(CUSTOMER_COLUMNS)
      .or(filters.join(","))
      .limit(50);
    if (error) throw error;
    customers = (data ?? []) as unknown as CustomerRow[];
  }

  // 3. Locations for those candidates only.
  let locations: CustomerLocationRow[] = [];
  if (customers.length > 0) {
    const { data, error } = await supabase
      .from("customer_locations")
      .select(LOCATION_COLUMNS)
      .in(
        "customer_id",
        customers.map((customer) => customer.id)
      );
    if (error) throw error;
    locations = (data ?? []) as unknown as CustomerLocationRow[];
  }

  return matchCustomer({
    extractedCustomer,
    extractedLocation,
    customers,
    locations,
    supplierRefCustomerId,
  });
}

// ---------------------------------------------------------------------------
// Applying the Admin's decision at save time
// ---------------------------------------------------------------------------

export interface ResolveCustomerInput {
  /** Existing customer chosen/confirmed by the Admin. */
  customerId?: string | null;
  /** Set when the Admin chose to create a new company. */
  newCustomer?: CustomerInput | null;
  /** Existing location chosen by the Admin. */
  customerLocationId?: string | null;
  resolution: LocationResolution;
  /** The address as it will be used, whatever its origin. */
  address: CustomerLocationInput;
  supplierId?: string | null;
  supplierCustomerCode?: string | null;
}

export interface ResolvedCustomer {
  customerId: string | null;
  customerLocationId: string | null;
  /** Address snapshot to store on the order itself. */
  addressSnapshot: CustomerLocationInput;
}

/**
 * Turns the Admin's explicit choice into writes.
 *
 * `use_for_this_order_only` is the important branch: it stores the address on
 * the order and touches nothing in `customer_locations`. That is what stops one
 * unusual delivery from rewriting a customer's known address.
 */
export async function resolveCustomerForOrder(
  input: ResolveCustomerInput
): Promise<ResolvedCustomer> {
  let customerId = input.customerId ?? null;

  if (!customerId && input.newCustomer) {
    const created = await createCustomer(input.newCustomer);
    customerId = created.id;
  }

  let customerLocationId = input.customerLocationId ?? null;

  if (customerId) {
    switch (input.resolution) {
      case "add_as_new_location": {
        const created = await createCustomerLocation(customerId, input.address);
        customerLocationId = created.id;
        break;
      }
      case "update_existing_location": {
        if (customerLocationId) {
          await updateCustomerLocation(customerLocationId, input.address);
        } else {
          const created = await createCustomerLocation(customerId, input.address);
          customerLocationId = created.id;
        }
        break;
      }
      case "use_for_this_order_only":
        // Intentionally no customer_locations write. The address lives on the
        // order snapshot only.
        break;
      case "use_existing":
      default:
        break;
    }

    // Learn the supplier's code for this customer so the next document from
    // them matches instantly.
    if (input.supplierId && input.supplierCustomerCode?.trim()) {
      await rememberSupplierCustomerCode(
        input.supplierId,
        customerId,
        input.supplierCustomerCode.trim()
      );
    }
  }

  return { customerId, customerLocationId, addressSnapshot: input.address };
}

async function rememberSupplierCustomerCode(
  supplierId: string,
  customerId: string,
  code: string
): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase
    .from("supplier_customer_refs")
    .upsert(
      { supplier_id: supplierId, customer_id: customerId, supplier_customer_code: code },
      { onConflict: "supplier_id,supplier_customer_code", ignoreDuplicates: true }
    );
  // A failure here costs us a future matching shortcut, nothing operational —
  // so it must not fail the order save.
  if (error) logEvent("supplier_customer_ref_upsert_skipped", { supplierId, customerId });
}
