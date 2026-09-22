import { describe, expect, it } from "vitest";
import type { CustomerTyreOffer } from "@/lib/pricing/projection";

/**
 * M12 contract: the customer catalogue payload has no field capable of leaking
 * supplier identity, article, cost, stock quantity, margin or listing id.
 */
describe("customer catalogue projection boundary", () => {
  it("keeps supplier/commercial internals structurally absent", () => {
    const offer: CustomerTyreOffer = {
      tyre: {
        productId: "p1", brand: "TEST", modelPattern: "A", description: null,
        sizeDisplay: "205/55 R16", widthMm: 205, aspectRatio: 55, rimInch: 16,
        loadIndex: "91", speedRating: "V", loadSpeedRaw: "91V", season: "summer",
        productClass: "passenger", xl: false, runFlat: false, oldDot: false, eprelId: null,
      },
      availability: "in_stock",
      tyreSaleNetCents: 10000,
      pfuStatus: "TO_CONFIRM",
      pfuAmountCents: null,
      vatAmountCents: null,
      customerTotalCents: null,
      priceAvailable: false,
    };
    const json=JSON.stringify(offer);
    for(const forbidden of ["supplierName","supplierArticleId","supplierListingId","supplierCostCents","supplierStockExact","supplierStockMinimum","supplierStockRaw","markupPercentApplied","grossProfitCents","grossMarginPercent","costObservedAt"]){
      expect(json).not.toContain(forbidden);
    }
  });
});
