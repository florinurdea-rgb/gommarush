import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { requireCustomerSession } from "@/lib/auth/customer-session";

export async function getCurrentCustomerAccount() {
  const session = await requireCustomerSession();
  const supabase = createSupabaseAdminClient();

  const [{ data: customer, error: customerError }, { data: locations, error: locationsError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name, legal_name, vat_number, fiscal_code, email, phone")
        .eq("id", session.customerId)
        .eq("active", true)
        .maybeSingle(),
      supabase
        .from("customer_locations")
        .select("id, location_name, recipient_name, address_line1, address_line2, postal_code, city, province, region, country_code, contact_name, phone, email, delivery_notes, is_primary")
        .eq("customer_id", session.customerId)
        .eq("active", true)
        .order("is_primary", { ascending: false })
        .order("location_name", { ascending: true }),
    ]);

  if (customerError) throw customerError;
  if (locationsError) throw locationsError;
  if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

  return { session, customer, locations: locations ?? [] };
}
