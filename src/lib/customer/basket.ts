export interface StoredBasketLine{productId:string;oldDot:boolean;quantity:number}
const KEY="gommarush_customer_basket_v1";
export function readBasket():StoredBasketLine[]{if(typeof window==="undefined")return[];try{const v=JSON.parse(localStorage.getItem(KEY)??"[]");return Array.isArray(v)?v.filter(x=>x&&typeof x.productId==="string"&&typeof x.oldDot==="boolean"&&Number.isInteger(x.quantity)&&x.quantity>0):[];}catch{return[]}}
export function writeBasket(lines:StoredBasketLine[]){localStorage.setItem(KEY,JSON.stringify(lines));window.dispatchEvent(new Event("gommarush:basket"));}
export function addBasketLine(productId:string,oldDot:boolean,quantity=1){const lines=readBasket();const found=lines.find(x=>x.productId===productId&&x.oldDot===oldDot);if(found)found.quantity=Math.min(100,found.quantity+quantity);else lines.push({productId,oldDot,quantity});writeBasket(lines);}
