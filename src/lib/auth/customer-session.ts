import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";

export interface CustomerSession {
  subject: string;
  accountId: string;
  customerId: string;
  email: string | null;
}

export async function getCustomerSession(): Promise<CustomerSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const admin = createSupabaseAdminClient();
  const { data: account, error: accountError } = await admin
    .from("customer_accounts")
    .select("id, customer_id, active")
    .eq("auth_user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (accountError || !account) return null;

  return {
    subject: data.user.id,
    accountId: account.id,
    customerId: account.customer_id,
    email: data.user.email ?? null,
  };
}

export async function requireCustomerSession(): Promise<CustomerSession> {
  const session = await getCustomerSession();
  if (!session) throw new Error("UNAUTHORIZED_CUSTOMER");
  return session;
}
