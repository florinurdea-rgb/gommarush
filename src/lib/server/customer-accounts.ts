import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { logError } from "@/lib/logger";

export interface CustomerAccountSummary {
  id: string;
  auth_user_id: string;
  active: boolean;
  created_at: string;
  /** The auth identity's email, for recognition only. Null if unreadable. */
  email: string | null;
}

/**
 * Portal logins bound to one customer company.
 *
 * The email is READ from the auth identity rather than stored on
 * `customer_accounts`. Copying it would create a second, silently stale copy
 * of a fact Supabase Auth already owns — and an operator comparing the two
 * would have no way to tell which was current.
 *
 * Bounded by construction: a company has a handful of logins, and the lookup
 * runs once per row only for the rows that exist. No password or credential
 * material is read here, because none is readable.
 */
export async function listCustomerAccounts(customerId: string): Promise<CustomerAccountSummary[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("customer_accounts")
    .select("id,auth_user_id,active,created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = data ?? [];

  return Promise.all(
    rows.map(async (row) => {
      try {
        const { data: user } = await admin.auth.admin.getUserById(row.auth_user_id);
        return { ...row, email: user?.user?.email ?? null };
      } catch (lookupError) {
        // A missing auth identity is worth knowing about, but it must not make
        // the whole panel unavailable: the binding still exists and the
        // operator still needs to be able to deactivate it.
        logError("customer_account_email_lookup_failed", lookupError);
        return { ...row, email: null };
      }
    })
  );
}
