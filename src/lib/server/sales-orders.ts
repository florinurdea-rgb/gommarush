import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import type { CustomerSession } from "@/lib/auth/customer-session";
import { customerBasketPayload,resolveBasket,type BasketLineInput } from "@/lib/server/customer-basket";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";

export const PAYMENT_METHODS=["bank_transfer","pos_on_delivery","cash"] as const;
export type PaymentMethod=typeof PAYMENT_METHODS[number];
export const FULFILMENT_CLASSES=["standard","express"] as const;
export type FulfilmentClass=typeof FULFILMENT_CLASSES[number];

function validAddress(v:string|null|undefined){const x=(v??"").trim();return x!==""&&x!=="—"&&x!=="-";}

export async function createPortalSalesOrder(input:{session:CustomerSession;lines:BasketLineInput[];locationId:string;paymentMethod:PaymentMethod;fulfilmentClass:FulfilmentClass;note:string|null;idempotencyKey:string}){
 const admin=createSupabaseAdminClient();
 const [{data:customer,error:ce},{data:location,error:le}]=await Promise.all([
  admin.from("customers").select("id,name,legal_name,vat_number,fiscal_code,email,phone,active").eq("id",input.session.customerId).maybeSingle(),
  admin.from("customer_locations").select("*").eq("id",input.locationId).eq("customer_id",input.session.customerId).eq("active",true).maybeSingle()
 ]);
 if(ce)throw ce;if(le)throw le;if(!customer||!customer.active)throw new Error("CUSTOMER_NOT_FOUND");
 if(!location||!validAddress(location.address_line1)||!validAddress(location.city))throw new Error("DELIVERY_ADDRESS_INVALID");
 const resolved=await resolveBasket(input.lines);const basket=customerBasketPayload(resolved);
 // Commercial safety gate: never label or persist an incomplete amount as a final order total.
 if(basket.monetaryStatus!=="complete")throw new Error("PRICING_NOT_FINAL");
 const existing=await admin.from("sales_orders").select("id,order_number,status").eq("customer_id",input.session.customerId).eq("idempotency_key",input.idempotencyKey).maybeSingle();
 if(existing.error)throw existing.error;if(existing.data)return existing.data;
 const now=new Date().toISOString();
 const {data:order,error:oe}=await admin.from("sales_orders").insert({
  customer_id:input.session.customerId,customer_location_id:location.id,idempotency_key:input.idempotencyKey,
  customer_snapshot:customer,source:"portal",status:"requested",fulfilment_class:input.fulfilmentClass,payment_method:input.paymentMethod,currency:"EUR",monetary_status:"complete",
  tyre_net_total_cents:basket.tyreNetTotalCents,pfu_total_cents:basket.pfuTotalCents,vat_total_cents:basket.vatTotalCents,grand_total_cents:basket.grandTotalCents,
  delivery_snapshot:{location_name:location.location_name,recipient_name:location.recipient_name,address_line1:location.address_line1,address_line2:location.address_line2,postal_code:location.postal_code,city:location.city,province:location.province,region:location.region,country_code:location.country_code,phone:location.phone,email:location.email,delivery_notes:location.delivery_notes},
  pricing_snapshot:{markup_percent:DEFAULT_PRICING_SETTINGS.markupPercent,vat_rate_percent:DEFAULT_PRICING_SETTINGS.vatRatePercent,pfu_vat_base:DEFAULT_PRICING_SETTINGS.pfuVatBase,snapshotted_at:now},
  customer_note:input.note,requested_at:now
 }).select("id,order_number,status").single();
 if(oe)throw oe;
 const items=resolved.map((line,index)=>({sales_order_id:order.id,line_number:index+1,catalogue_product_id:line.input.productId,source_listing_id:line.internal.supplierListingId,quantity:line.input.quantity,tyre_snapshot:line.customer.tyre,condition_snapshot:line.input.oldDot?"older_dot":"normal",unit_tyre_net_cents:line.customer.tyreSaleNetCents,unit_pfu_cents:line.customer.pfuAmountCents,unit_vat_cents:line.customer.vatAmountCents,unit_total_cents:line.customer.customerTotalCents,pricing_status:"complete",price_observed_at:line.internal.costObservedAt}));
 const {error:ie}=await admin.from("sales_order_items").insert(items);
 if(ie){await admin.from("sales_orders").delete().eq("id",order.id);throw ie;}
 return order;
}

export async function listCustomerSalesOrders(customerId:string){
 const admin=createSupabaseAdminClient();const {data,error}=await admin.from("sales_orders").select("id,order_number,status,fulfilment_class,payment_method,currency,grand_total_cents,requested_at").eq("customer_id",customerId).order("requested_at",{ascending:false}).limit(100);if(error)throw error;return data??[];
}
export async function listRequestedSalesOrders(){
 const admin=createSupabaseAdminClient();const {data,error}=await admin.from("sales_orders").select("id,order_number,status,customer_id,customer_snapshot,grand_total_cents,currency,fulfilment_class,payment_method,requested_at").eq("status","requested").order("requested_at",{ascending:true}).limit(200);if(error)throw error;return data??[];
}

export async function getSalesOrderDetail(orderId:string){
 const admin=createSupabaseAdminClient();
 const [{data:order,error:oe},{data:items,error:ie}]=await Promise.all([
  admin.from("sales_orders").select("*").eq("id",orderId).maybeSingle(),
  admin.from("sales_order_items").select("id,line_number,catalogue_product_id,quantity,tyre_snapshot,condition_snapshot,unit_tyre_net_cents,unit_pfu_cents,unit_vat_cents,unit_total_cents,pricing_status").eq("sales_order_id",orderId).order("line_number",{ascending:true})
 ]);
 if(oe)throw oe;if(ie)throw ie;if(!order)return null;return {order,items:items??[]};
}
