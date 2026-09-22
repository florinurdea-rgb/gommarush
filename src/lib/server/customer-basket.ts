import "server-only";
import { searchCatalogue } from "@/lib/server/catalogue-search";
import type { CustomerTyreOffer, InternalTyreOffer } from "@/lib/pricing/projection";

export interface BasketLineInput { productId:string; oldDot:boolean; quantity:number; }
export interface BasketResolvedLine { input:BasketLineInput; customer:CustomerTyreOffer; internal:InternalTyreOffer; }

export function validateBasketLines(value:unknown):BasketLineInput[]|null{
 if(!Array.isArray(value)||value.length===0||value.length>50)return null;
 const out:BasketLineInput[]=[];
 for(const x of value){
  if(!x||typeof x!=="object")return null;
  const v=x as Record<string,unknown>;
  if(typeof v.productId!=="string"||v.productId.length<8||typeof v.oldDot!=="boolean"||!Number.isInteger(v.quantity)||Number(v.quantity)<1||Number(v.quantity)>100)return null;
  out.push({productId:v.productId,oldDot:v.oldDot,quantity:Number(v.quantity)});
 }
 return out;
}
export async function resolveBasket(lines:BasketLineInput[]):Promise<BasketResolvedLine[]>{
 const out:BasketResolvedLine[]=[];
 for(const input of lines){
  const result=await searchCatalogue({productId:input.productId,oldDot:input.oldDot,limit:100});
  const candidates=result.internal.filter(x=>x.sellable&&x.tyreSaleNetCents!==null);
  candidates.sort((a,b)=>(a.tyreSaleNetCents??Number.MAX_SAFE_INTEGER)-(b.tyreSaleNetCents??Number.MAX_SAFE_INTEGER)||(a.supplierListingId.localeCompare(b.supplierListingId)));
  const chosen=candidates[0];
  if(!chosen)throw new Error("BASKET_ITEM_UNAVAILABLE");
  const customer=result.customer.find(x=>x.tyre.productId===chosen.tyre.productId&&x.tyre.oldDot===chosen.tyre.oldDot&&x.tyreSaleNetCents===chosen.tyreSaleNetCents);
  if(!customer)throw new Error("BASKET_ITEM_UNAVAILABLE");
  out.push({input,customer,internal:chosen});
 }
 return out;
}
export function customerBasketPayload(lines:BasketResolvedLine[]){
 const tyreNetTotalCents=lines.reduce((sum,l)=>sum+(l.customer.tyreSaleNetCents??0)*l.input.quantity,0);
 const allFinal=lines.every(l=>l.customer.customerTotalCents!==null);
 return {
  lines:lines.map(l=>({productId:l.input.productId,oldDot:l.input.oldDot,quantity:l.input.quantity,tyre:l.customer.tyre,availability:l.customer.availability,unitTyreNetCents:l.customer.tyreSaleNetCents,pfuStatus:l.customer.pfuStatus,unitPfuCents:l.customer.pfuAmountCents,unitVatCents:l.customer.vatAmountCents,unitTotalCents:l.customer.customerTotalCents})),
  currency:"EUR",tyreNetTotalCents,pfuTotalCents:allFinal?lines.reduce((s,l)=>s+(l.customer.pfuAmountCents??0)*l.input.quantity,0):null,
  vatTotalCents:allFinal?lines.reduce((s,l)=>s+(l.customer.vatAmountCents??0)*l.input.quantity,0):null,
  grandTotalCents:allFinal?lines.reduce((s,l)=>s+(l.customer.customerTotalCents??0)*l.input.quantity,0):null,
  monetaryStatus:allFinal?"complete":"pending_pfu"
 };
}
