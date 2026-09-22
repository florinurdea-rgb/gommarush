"use client";
import { useEffect,useMemo,useState } from "react";

type Offer={tyre:{productId:string;brand:string|null;modelPattern:string|null;sizeDisplay:string|null;loadIndex:string|null;speedRating:string|null;season:string|null;xl:boolean|null;runFlat:boolean|null;oldDot:boolean};availability:"unknown"|"in_stock"|"on_request";tyreSaleNetCents:number|null;pfuStatus:string;pfuAmountCents:number|null;vatAmountCents:number|null;customerTotalCents:number|null;priceAvailable:boolean};
type Facets={widths:number[];aspectRatios:number[];rims:number[]};
const money=(c:number|null)=>c===null?"—":new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(c/100);
export function CustomerCatalogue(){
 const [offers,setOffers]=useState<Offer[]>([]),[facets,setFacets]=useState<Facets>({widths:[],aspectRatios:[],rims:[]});
 const [width,setWidth]=useState(""),[aspect,setAspect]=useState(""),[rim,setRim]=useState(""),[season,setSeason]=useState(""),[brand,setBrand]=useState("");
 const [loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
 const qs=useMemo(()=>{const p=new URLSearchParams();if(width)p.set("width",width);if(aspect)p.set("aspect",aspect);if(rim)p.set("rim",rim);if(season)p.set("season",season);if(brand.trim())p.set("brand",brand.trim());return p.toString()},[width,aspect,rim,season,brand]);
 useEffect(()=>{const controller=new AbortController();const timer=setTimeout(async()=>{setLoading(true);setError(null);try{const r=await fetch("/api/account/catalogue?"+qs,{signal:controller.signal});const j=await r.json();if(!r.ok)throw new Error();setOffers(j.offers??[]);setFacets(j.facets??{widths:[],aspectRatios:[],rims:[]});}catch(e){if((e as Error).name!=="AbortError")setError("Catalogo non disponibile. Riprova.");}finally{setLoading(false)}},200);return()=>{clearTimeout(timer);controller.abort()}},[qs]);
 return <div>
  <div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-extrabold text-ink">Catalogo pneumatici</h1><p className="mt-1 text-sm text-ink-soft">Cerca per misura e stagione. I fornitori GommaRush non vengono mostrati.</p></div></div>
  <div className="mt-6 grid gap-3 rounded-2xl bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-5">
   <Select label="Larghezza" value={width} set={setWidth} values={facets.widths}/>
   <Select label="Spalla" value={aspect} set={setAspect} values={facets.aspectRatios}/>
   <Select label="Cerchio" value={rim} set={setRim} values={facets.rims}/>
   <label className="text-sm font-semibold text-ink">Stagione<select value={season} onChange={e=>setSeason(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"><option value="">Tutte</option><option value="summer">Estive</option><option value="winter">Invernali</option><option value="all_season">4 stagioni</option></select></label>
   <label className="text-sm font-semibold text-ink">Marca<input value={brand} onChange={e=>setBrand(e.target.value)} placeholder="Es. Michelin" className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"/></label>
  </div>
  {error?<p className="mt-6 rounded-xl bg-state-danger-soft p-4 text-state-danger">{error}</p>:loading?<p className="mt-6 text-sm text-ink-soft">Ricerca…</p>:
  <div className="mt-6 space-y-3">{offers.length===0?<div className="rounded-2xl bg-white p-8 text-center text-ink-soft">Nessun pneumatico disponibile con questi filtri.</div>:offers.map((o,i)=><article key={o.tyre.productId+"-"+i} className="rounded-2xl bg-white p-5 shadow-card"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="font-extrabold text-ink">{o.tyre.brand??"Marca non indicata"} {o.tyre.modelPattern??""}</div><div className="mt-1 text-sm text-ink-soft">{o.tyre.sizeDisplay??"Misura non indicata"} {o.tyre.loadIndex??""}{o.tyre.speedRating??""}{o.tyre.xl?" XL":""}</div>{o.tyre.oldDot&&<div className="mt-2 text-xs font-semibold">DOT precedente</div>}</div><div className="text-right"><div className="text-lg font-extrabold text-ink">{money(o.tyreSaleNetCents)} <span className="text-xs font-medium text-ink-soft">netto</span></div><div className="mt-1 text-xs text-ink-soft">{o.pfuStatus==="TO_CONFIRM"?"PFU da confermare":o.priceAvailable?"Disponibile":"Prezzo da confermare"}</div></div></div></article>)}</div>}
 </div>;
}
function Select({label,value,set,values}:{label:string;value:string;set:(v:string)=>void;values:number[]}){return <label className="text-sm font-semibold text-ink">{label}<select value={value} onChange={e=>set(e.target.value)} className="mt-1 h-11 w-full rounded-xl border border-ink/15 px-3 font-normal"><option value="">Tutte</option>{values.map(v=><option key={v} value={v}>{v}</option>)}</select></label>}
