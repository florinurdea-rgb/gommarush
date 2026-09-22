import { NextRequest, NextResponse } from "next/server";
import { requireCustomerSession } from "@/lib/auth/customer-session";
import { getCatalogueFacets, isSearchableSeason, searchCatalogue } from "@/lib/server/catalogue-search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function n(v:string|null){if(!v)return null;const x=Number(v);return Number.isFinite(x)?x:null;}

export async function GET(request:NextRequest){
  try { await requireCustomerSession(); } catch { return NextResponse.json({ok:false,code:"UNAUTHORIZED"},{status:401}); }
  const p=request.nextUrl.searchParams;
  const season=p.get("season");
  const query={
    widthMm:n(p.get("width")),
    aspectRatio:n(p.get("aspect")),
    rimInch:n(p.get("rim")),
    season:isSearchableSeason(season)?season:null,
    brand:p.get("brand")?.trim()||null,
    limit:Math.min(Math.max(n(p.get("limit"))??50,1),100),
    offset:Math.max(n(p.get("offset"))??0,0),
  };
  const [result,facets]=await Promise.all([searchCatalogue(query),getCatalogueFacets()]);
  // SECURITY BOUNDARY: only the customer projection leaves this route.
  return NextResponse.json({ok:true,offers:result.customer,facets,schemaAvailable:result.schemaAvailable});
}
