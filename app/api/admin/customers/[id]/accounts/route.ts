import { NextRequest } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { fail, ok, readJsonBody, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime="nodejs";

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 return runAdminRoute(async()=>{
  const {id:customerId}=await params;
  const body=await readJsonBody(request);
  if(!body||typeof body!=="object")return fail(400,"VALIDATION_FAILED");
  const {email,password}=body as Record<string,unknown>;
  if(typeof email!=="string"||!email.includes("@")||typeof password!=="string"||password.length<12)return fail(400,"VALIDATION_FAILED",["Email and a temporary password of at least 12 characters are required."]);
  const admin=createSupabaseAdminClient();
  const {data:customer,error:customerError}=await admin.from("customers").select("id,active").eq("id",customerId).maybeSingle();
  if(customerError)throw customerError;
  if(!customer||!customer.active)return fail(404,"CUSTOMER_NOT_FOUND");

  const {data:created,error:createError}=await admin.auth.admin.createUser({email:email.trim().toLowerCase(),password,email_confirm:true});
  if(createError)return fail(409,"CUSTOMER_AUTH_CREATE_FAILED",[createError.message]);
  const user=created.user;
  const {data:account,error:linkError}=await admin.from("customer_accounts").insert({auth_user_id:user.id,customer_id:customerId,active:true}).select("id").single();
  if(linkError){
    // Compensating action: never leave an unbound portal identity after a failed link.
    await admin.auth.admin.deleteUser(user.id);
    return fail(409,"CUSTOMER_ACCOUNT_LINK_FAILED",[linkError.message]);
  }
  return ok({accountId:account.id,authUserId:user.id,email:user.email},201);
 });
}
