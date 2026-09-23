import {describe,expect,it} from "vitest";
import {validateBasketLines,customerBasketPayload,type BasketResolvedLine} from "@/lib/server/customer-basket";
import type { TyreSpecView } from "@/lib/pricing/projection";

/**
 * A HYPOTHETICAL resolved line.
 *
 * Read the "complete" variant carefully: it describes a state the live pricing
 * engine CANNOT currently produce, because DEFAULT_PRICING_SETTINGS.pfuVatBase
 * is "unresolved" and resolvePfu refuses to state an amount. It is built by
 * hand on purpose, so the pure aggregation in customerBasketPayload can be
 * tested for the day a tariff and a VAT treatment are approved.
 *
 * That makes it a test of arithmetic, not of policy, and it must not be read
 * as evidence that a final total is reachable today. The property that the
 * real engine still fails closed is asserted separately, against real
 * settings, in tests/customer-portal-boundary.test.ts — if that ever stops
 * holding, the fixture here has quietly become the live behaviour and both
 * files need revisiting together.
 *
 * The 12444 below therefore also encodes an UNAPPROVED assumption — that PFU
 * sits inside the VAT base. It is deliberate and local to this fixture.
 */
function line(resolution:BasketResolvedLine["internal"]["resolution"]):BasketResolvedLine{
 const complete=resolution==="complete";
 const tyre:TyreSpecView={productId:"11111111-1111-1111-1111-111111111111",brand:"TEST",modelPattern:"A",description:null,sizeDisplay:"205/55 R16",widthMm:205,aspectRatio:55,rimInch:16,loadIndex:"91",speedRating:"V",loadSpeedRaw:"91V",season:"summer",productClass:"passenger",xl:false,runFlat:false,oldDot:false,eprelId:null};
 return {input:{productId:"11111111-1111-1111-1111-111111111111",oldDot:false,quantity:4},customer:{tyre,availability:"in_stock",tyreSaleNetCents:10000,pfuStatus:complete?"MANUAL_CONFIRMED":"TO_CONFIRM",pfuAmountCents:complete?200:null,vatAmountCents:complete?2244:null,customerTotalCents:complete?12444:null,priceAvailable:true},internal:{tyre,availability:"in_stock",supplierStockExact:20,supplierStockMinimum:null,supplierStockRaw:"20",sellable:true,sellabilityReason:"sellable",minimumOfferQuantity:5,supplierListingId:"internal-listing",supplierName:"SECRET",supplierArticleId:"SECRET-SKU",costObservedAt:"2026-09-22T00:00:00Z",resolution,supplierCostCents:8000,markupPercentApplied:20,markupAmountCents:2000,minimumProfitApplied:false,tyreSaleNetCents:10000,pfuStatus:complete?"MANUAL_CONFIRMED":"TO_CONFIRM",pfuAmountCents:complete?200:null,taxableSubtotalCents:complete?10200:null,vatRatePercentApplied:complete?22:null,vatAmountCents:complete?2244:null,customerTotalCents:complete?12444:null,grossProfitCents:2000,grossMarginPercent:20,blockedReasons:[]}};
}
describe("customer basket contract",()=>{
 it("rejects empty, malformed and excessive quantities",()=>{expect(validateBasketLines([])).toBeNull();expect(validateBasketLines([{productId:"x",oldDot:false,quantity:1}])).toBeNull();expect(validateBasketLines([{productId:"11111111",oldDot:false,quantity:101}])).toBeNull();});
 it("keeps unresolved PFU from becoming a final total",()=>{const p=customerBasketPayload([line("pfu_unresolved")]);expect(p.monetaryStatus).toBe("pending_pfu");expect(p.grandTotalCents).toBeNull();expect(p.vatTotalCents).toBeNull();});
 it("distinguishes tax-policy blocker",()=>{expect(customerBasketPayload([line("vat_policy_unresolved")]).monetaryStatus).toBe("pending_tax_policy");});
 it("calculates only from resolved per-unit amounts",()=>{const p=customerBasketPayload([line("complete")]);expect(p.tyreNetTotalCents).toBe(40000);expect(p.pfuTotalCents).toBe(800);expect(p.vatTotalCents).toBe(8976);expect(p.grandTotalCents).toBe(49776);});
 it("never returns supplier internals",()=>{const json=JSON.stringify(customerBasketPayload([line("complete")]));for(const secret of ["supplierListingId","supplierName","supplierArticleId","supplierCostCents","SECRET-SKU"])expect(json).not.toContain(secret);});
});
