import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
export async function listCustomerAccounts(customerId:string){
 const admin=createSupabaseAdminClient();
 const {data,error}=await admin.from("customer_accounts").select("id,auth_user_id,active,created_at").eq("customer_id",customerId).order("created_at",{ascending:true});
 if(error)throw error;
 return data??[];
}
