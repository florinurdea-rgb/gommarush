import {NextRequest,NextResponse} from "next/server";
import {requireCustomerSession} from "@/lib/auth/customer-session";
import {readJsonBody} from "@/lib/server/route-helpers";
import {validateBasketLines} from "@/lib/server/customer-basket";
import {createPortalSalesOrder,FULFILMENT_CLASSES,PAYMENT_METHODS} from "@/lib/server/sales-orders";
export const runtime="nodejs";
export async function POST(request:NextRequest){
 let session;try{session=await requireCustomerSession();}catch{return NextResponse.json({ok:false,code:"UNAUTHORIZED"},{status:401});}
 const body=await readJsonBody(request);if(!body||typeof body!=="object")return NextResponse.json({ok:false,code:"VALIDATION_FAILED"},{status:400});
 const v=body as Record<string,unknown>,lines=validateBasketLines(v.lines);
 if(!lines||typeof v.locationId!=="string"||typeof v.idempotencyKey!=="string"||v.idempotencyKey.length<12||!PAYMENT_METHODS.includes(v.paymentMethod as never)||!FULFILMENT_CLASSES.includes(v.fulfilmentClass as never)||!(v.note===null||v.note===undefined||typeof v.note==="string"))return NextResponse.json({ok:false,code:"VALIDATION_FAILED"},{status:400});
 try{const order=await createPortalSalesOrder({session,lines,locationId:v.locationId,paymentMethod:v.paymentMethod as typeof PAYMENT_METHODS[number],fulfilmentClass:v.fulfilmentClass as typeof FULFILMENT_CLASSES[number],note:typeof v.note==="string"?v.note.trim().slice(0,2000)||null:null,idempotencyKey:v.idempotencyKey});return NextResponse.json({ok:true,order},{status:201});}
 catch(e){const code=e instanceof Error?e.message:"UNKNOWN";const status=code==="PRICING_NOT_FINAL"||code==="BASKET_ITEM_UNAVAILABLE"?409:code==="DELIVERY_ADDRESS_INVALID"?400:500;return NextResponse.json({ok:false,code},{status});}
}
