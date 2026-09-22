import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { customerBasketPayload,resolveBasket,validateBasketLines } from "@/lib/server/customer-basket";
import { readJsonBody } from "@/lib/server/route-helpers";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 try{await requireCustomerSession();}catch{return NextResponse.json({ok:false,code:"UNAUTHORIZED"},{status:401});}
 const body=await readJsonBody(request); const lines=validateBasketLines((body as Record<string,unknown>|null)?.lines);
 if(!lines)return NextResponse.json({ok:false,code:"VALIDATION_FAILED"},{status:400});
 try{return NextResponse.json({ok:true,basket:customerBasketPayload(await resolveBasket(lines))});}
 catch(e){if(e instanceof Error&&e.message==="BASKET_ITEM_UNAVAILABLE")return NextResponse.json({ok:false,code:"BASKET_ITEM_UNAVAILABLE"},{status:409});throw e;}
}
