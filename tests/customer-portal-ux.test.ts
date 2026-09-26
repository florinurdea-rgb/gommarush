describe("the basket in the customer navigation", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const NAV = "src/components/customer/CustomerShellNav.tsx";

  it("carries the approved cart mark before the count", () => {
    const source = read(NAV);
    expect(source).toContain("CommerceCartIcon");
    expect(source.indexOf("<Icon")).toBeLessThan(source.indexOf("<Badge"));
  });

  /**
   * One drawing of each concept, from the approved asset file. A second
   * hand-rolled cart somewhere in the tree is how two carts end up on one
   * screen looking almost but not quite the same.
   */
  it("uses the approved asset set, with no local redraws beside it", () => {
    const icons = read("src/components/customer/CommerceIcons.tsx");
    expect(icons).toContain("export function CommerceCartIcon");
    for (const file of [
      NAV,
      "src/components/customer/CustomerCatalogue.tsx",
      "src/components/customer/LineAvailability.tsx",
      "src/components/customer/QuantityStepper.tsx",
    ]) {
      expect(read(file)).toContain('from "@/components/customer/CommerceIcons"');
    }
    expect(
      require("node:fs").existsSync("src/components/customer/CartIcon.tsx"),
      "the ad-hoc cart drawing is gone"
    ).toBe(false);
  });

  /** Decorative: the count beside it already carries the meaning. */
  it("hides the icons from assistive technology", () => {
    expect(read("src/components/customer/CommerceIcons.tsx")).toContain('"aria-hidden": true');
  });

  /** Growing on a REMOVAL would celebrate the wrong event. */
  it("draws the eye only when the count goes up", () => {
    const source = read(NAV);
    expect(source).toContain("next > previous.current");
    expect(source).toContain("scale-125");
  });

  /**
   * A fixed bar that hides the last row of a list is worse than no bar, and a
   * phone with a home indicator needs clearing too.
   */
  it("keeps the phone bar clear of the home indicator and of content", () => {
    expect(read(NAV)).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(read("app/account/(secure)/layout.tsx")).toContain(
      "h-[calc(56px+env(safe-area-inset-bottom))]"
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  catalogueViewState,
  hasCompleteDimensions,
  sameValues,
  shouldQueryCatalogue,
} from "@/lib/customer/catalogue-view";
import { formatSalesOrderNumber, parseSalesOrderNumber } from "@/lib/commerce/order-number";
import {
  DEFAULT_FULFILMENT_CLASS,
  FULFILMENT_PROMISES,
  fulfilmentPromise,
  isFulfilmentClass,
} from "@/lib/commerce/fulfilment";
import { PAYMENT_METHODS } from "@/lib/server/sales-orders";
import { customerBasketPayload, type BasketResolvedLine } from "@/lib/server/customer-basket";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
import { PFU_ESTIMATE_VERSION } from "@/lib/pricing/pfu-estimate";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { resolvePfu } from "@/lib/pricing/pfu";
import { toCustomerOffer, toInternalOffer, type PricedListing } from "@/lib/pricing/projection";

// ---------------------------------------------------------------------------
// The deliberate search
// ---------------------------------------------------------------------------

describe("the catalogue asks for a size before it asks the database", () => {
  it("needs all three dimensions, not two", () => {
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "55", rimInch: "16" })).toBe(true);
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "55", rimInch: "" })).toBe(false);
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "", rimInch: "16" })).toBe(false);
    expect(hasCompleteDimensions({ widthMm: "", aspectRatio: "55", rimInch: "16" })).toBe(false);
    expect(hasCompleteDimensions({ widthMm: null, aspectRatio: null, rimInch: null })).toBe(false);
  });

  it("does not accept whitespace as a chosen dimension", () => {
    expect(hasCompleteDimensions({ widthMm: "205", aspectRatio: "  ", rimInch: "16" })).toBe(false);
  });

  it("accepts numbers as well as the strings a <select> yields", () => {
    expect(hasCompleteDimensions({ widthMm: 205, aspectRatio: 55, rimInch: 16 })).toBe(true);
    expect(hasCompleteDimensions({ widthMm: 205, aspectRatio: Number.NaN, rimInch: 16 })).toBe(false);
  });

  it("gates the catalogue read on the same rule the view uses", () => {
    expect(shouldQueryCatalogue({ widthMm: "205", aspectRatio: "55", rimInch: "" })).toBe(false);
    expect(shouldQueryCatalogue({ widthMm: "205", aspectRatio: "55", rimInch: "16" })).toBe(true);
  });

  /**
   * THE PREMISE OF THIS TEST CHANGED, AND THE CHANGE IS THE POINT.
   *
   * It used to assert the OPPOSITE: the component must never gate its fetch,
   * because the selectors were filled from the facets that same request
   * returned, so no request meant no widths and the size could never be
   * completed. That deadlock was real and this test was what kept it closed.
   *
   * The deadlock is now structurally impossible — the size lists are props,
   * resolved on the server and rendered with the page — so the gate belongs
   * back in the component, and the guarantee worth pinning is the one that
   * makes it safe: the selectors must not depend on a response.
   */
  it("gates the component fetch, now that the selectors do not depend on it", () => {
    const source = require("node:fs").readFileSync(
      "src/components/customer/CustomerCatalogue.tsx",
      "utf8"
    ) as string;
    expect(source, "the gate is back").toContain("shouldQueryCatalogue");
    expect(source, "and it short-circuits the effect").toContain("if (!canQuery) {");
    // The sizes arrive as props. If they were ever read from a response again,
    // gating the fetch would re-create the deadlock.
    expect(source).toContain("facetValues={widths}");
    expect(source).toContain("facetValues={aspectRatios}");
    expect(source).toContain("facetValues={rims}");
    expect(source).not.toContain("facets.widths");
  });

  it("is handed those lists by the page, not asked for them by the browser", () => {
    const page = require("node:fs").readFileSync(
      "app/account/(secure)/catalogue/page.tsx",
      "utf8"
    ) as string;
    expect(page).toContain("getTyreDimensions");
    expect(page).toContain("widths={[...dimensions.widths]}");
  });
});

// ---------------------------------------------------------------------------
// Loading behaviour
// ---------------------------------------------------------------------------

describe("the catalogue never looks frozen or stale", () => {
  const size = { widthMm: "205", aspectRatio: "55", rimInch: "16" };

  it("asks for a size before it shows a results spinner", () => {
    expect(
      catalogueViewState({
        widthMm: "205",
        aspectRatio: "",
        rimInch: "",
        loading: true,
        error: false,
        refused: false,
      })
    ).toBe("awaiting_dimensions");
  });

  /**
   * REGRESSION. The size selectors are filled from the same request that
   * fetches results, so when that request fails there are no widths to choose.
   * Ranking `awaiting_dimensions` above `error` showed "choose a size" beside
   * three empty dropdowns and reported the failure nowhere — the customer was
   * told to do something the page had made impossible.
   */
  it("reports a failure even when no size has been chosen", () => {
    expect(
      catalogueViewState({
        widthMm: "",
        aspectRatio: "",
        rimInch: "",
        loading: false,
        error: true,
        refused: false,
      })
    ).toBe("error");
  });

  it("shows placeholders while a request is in flight", () => {
    expect(catalogueViewState({ ...size, loading: true, error: false, refused: false })).toBe("loading");
  });

  /**
   * The stale-results bug this rules out: changing a filter puts the view back
   * into `loading`, so the PREVIOUS selection's list cannot remain on screen
   * underneath the new filter, where it would read as an answer.
   *
   * `error` is not varied here because it cannot be true while a request is in
   * flight — the component clears it when the fetch starts — so asserting that
   * combination would be pinning down a state the app cannot reach.
   */
  it("never shows results or a stale refusal while loading", () => {
    for (const refused of [false, true]) {
      expect(catalogueViewState({ ...size, loading: true, error: false, refused })).toBe("loading");
    }
  });

  it("prefers a failure over a refusal, because a failed request measured nothing", () => {
    expect(catalogueViewState({ ...size, loading: false, error: true, refused: true })).toBe("error");
  });

  it("reports a refusal rather than silently showing a truncated list", () => {
    expect(catalogueViewState({ ...size, loading: false, error: false, refused: true })).toBe("refused");
  });

  it("shows results only when nothing is pending or wrong", () => {
    expect(catalogueViewState({ ...size, loading: false, error: false, refused: false })).toBe("results");
  });
});

// ---------------------------------------------------------------------------
// Delivery promise
// ---------------------------------------------------------------------------

describe("delivery is promised by service class, not by supplier", () => {
  it("promises seven days on the standard class", () => {
    expect(DEFAULT_FULFILMENT_CLASS).toBe("standard");
    expect(fulfilmentPromise("standard").maxDays).toBe(7);
  });

  it("keeps express as a narrower, hour-bounded promise", () => {
    expect(fulfilmentPromise("express")).toMatchObject({ minHours: 24, maxHours: 48 });
  });

  /**
   * The inference channel this closes: a per-offer lead time would differ
   * between supplier lanes (Inter-Sprint 7d, Carlini 48h), and a customer
   * comparing two cards would learn which tyres come from the fast supplier.
   * The promise depends only on the class, so it cannot carry that.
   */
  it("depends on nothing but the class", () => {
    expect(Object.keys(FULFILMENT_PROMISES).sort()).toEqual(["express", "standard"]);
    expect(fulfilmentPromise("standard")).toEqual(fulfilmentPromise("standard"));
  });

  it("recognises only the two defined classes", () => {
    expect(isFulfilmentClass("standard")).toBe(true);
    expect(isFulfilmentClass("overnight")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Payment methods
// ---------------------------------------------------------------------------

describe("V1 payment methods", () => {
  it("offers exactly bank transfer and cash on delivery", () => {
    expect([...PAYMENT_METHODS]).toEqual(["bank_transfer", "cash_on_delivery"]);
  });

  /** POS on delivery was in the first draft and is not an approved channel. */
  it("does not offer POS on delivery", () => {
    expect(PAYMENT_METHODS as readonly string[]).not.toContain("pos_on_delivery");
  });

  it("matches the database check constraint, so neither can drift", () => {
    const sql = require("node:fs").readFileSync(
      "supabase/pending-approval/0006_sales_orders.sql",
      "utf8"
    ) as string;
    const match = /payment_method in \(([^)]*)\)/.exec(sql);
    expect(match, "0006 must constrain payment_method").not.toBeNull();

    const allowed = (match?.[1] ?? "")
      .split(",")
      .map((v) => v.trim().replace(/^'|'$/g, ""))
      .sort();
    expect(allowed).toEqual([...PAYMENT_METHODS].sort());
  });
});

// ---------------------------------------------------------------------------
// Order number
// ---------------------------------------------------------------------------

describe("the order number is one mechanism, formatted once", () => {
  it("renders the sequence value as a padded GommaRush reference", () => {
    expect(formatSalesOrderNumber(1000)).toBe("GR-001000");
    expect(formatSalesOrderNumber(1)).toBe("GR-000001");
    expect(formatSalesOrderNumber(1234567)).toBe("GR-1234567");
  });

  it("is stable: the same allocated number always formats identically", () => {
    expect(formatSalesOrderNumber(1042)).toBe(formatSalesOrderNumber(1042));
    expect(formatSalesOrderNumber(1042)).toBe(formatSalesOrderNumber(BigInt(1042)));
  });

  it("round-trips, so a customer can quote it back", () => {
    for (const n of [1, 1000, 987654]) {
      expect(parseSalesOrderNumber(formatSalesOrderNumber(n))).toBe(n);
    }
    expect(parseSalesOrderNumber("gr-001000")).toBe(1000);
    expect(parseSalesOrderNumber("1000")).toBe(1000);
  });

  it("refuses to invent a number for something that is not one of ours", () => {
    expect(parseSalesOrderNumber("DDT-99")).toBeNull();
    expect(parseSalesOrderNumber("")).toBeNull();
    expect(parseSalesOrderNumber(null)).toBeNull();
    expect(formatSalesOrderNumber(null)).toBe("");
    expect(formatSalesOrderNumber(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Money still fails closed
// ---------------------------------------------------------------------------

/** A line priced by the REAL engine from real settings — no hand-built total. */
function realLine(quantity: number): BasketResolvedLine {
  const listing: PricedListing = {
    tyre: {
      productId: "11111111-1111-1111-1111-111111111111",
      brand: "ALPHA",
      modelPattern: "M",
      description: null,
      sizeDisplay: "205/55 R16",
      widthMm: 205,
      aspectRatio: 55,
      rimInch: 16,
      loadIndex: "91",
      speedRating: "V",
      loadSpeedRaw: "91V",
      season: "summer",
      productClass: "passenger_car",
      xl: false,
      runFlat: false,
      oldDot: false,
      eprelId: null,
    },
    availability: "in_stock",
    supplierListingId: "l-1",
    supplierName: "SECRET SUPPLIER",
    supplierArticleId: "SECRET-SKU",
    laneCode: "intersprint",
    ean: "1234567890123",
    weightKg: 8.5,
    costObservedAt: "2026-09-22T14:00:00Z",
    breakdown: calculateTyrePrice(
      { supplierCostCents: 10_000, pfu: resolvePfu({ weightKg: 8.5 }) },
      DEFAULT_PRICING_SETTINGS
    ),
    supplierStockExact: 20,
    supplierStockMinimum: null,
    supplierStockRaw: "20",
    sellability: { sellable: true, reason: "sellable", assessedQuantity: 20, minimumApplied: 5 },
  };

  return {
    input: { productId: listing.tyre.productId, oldDot: false, quantity },
    tyre: listing.tyre,
    customer: toCustomerOffer(listing),
    internal: toInternalOffer(listing),
    availability: { state: "available" },
    provenance: { source: "feed", observedAt: listing.costObservedAt },
  };
}

describe("an estimated PFU produces a total that says it is estimated", () => {
  it("totals the line from the estimate and discloses the estimate", () => {
    const basket = customerBasketPayload([realLine(4)]);

    // 100.00 cost + 20% = 120.00 net, x4 = 480.00.
    expect(basket.tyreNetTotalCents).toBe(48_000);
    // 3.00 estimated PFU x4 = 12.00; VAT 22% of (480 + 12) = 108.24.
    expect(basket.monetaryStatus).toBe("complete");
    expect(basket.pfuTotalCents).toBe(1_200);
    expect(basket.vatTotalCents).toBe(10_824);
    expect(basket.grandTotalCents).toBe(60_024);

    // And it never claims the figure is settled.
    expect(basket.pfuEstimated).toBe(true);
    expect(basket.pfuEstimateVersion).toBe(PFU_ESTIMATE_VERSION);
  });

  it("states the tax position it DOES know, so the gap is explainable", () => {
    const basket = customerBasketPayload([realLine(4)]);

    expect(basket.vatRatePercent).toBe(22);
    // D11 resolved: PFU is inside the VAT base. D3, the tariff, is not.
    expect(basket.pfuInVatBase).toBe(true);
  });

  it("carries the delivery promise on the basket too", () => {
    expect(customerBasketPayload([realLine(1)]).fulfilment).toEqual({
      class: "standard",
      maxDays: 7,
    });
  });

  it("leaks no supplier internals into the basket payload", () => {
    const json = JSON.stringify(customerBasketPayload([realLine(2)]));
    for (const secret of [
      "SECRET SUPPLIER",
      "SECRET-SKU",
      "l-1",
      "supplierCostCents",
      "grossProfitCents",
      "markupPercentApplied",
    ]) {
      expect(json, `${secret} must not reach a customer`).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------
// Catalogue controls — the "filters randomly reset" report
// ---------------------------------------------------------------------------

describe("an applied filter is never blanked out of its own control", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  /**
   * REGRESSION. The facet lists are DEPENDENT — each is computed with the
   * other filters applied — so a chosen width can legitimately drop out of the
   * width list once a season or rim narrows the catalogue past it. A <select>
   * whose value matches no <option> renders BLANK while the filter is still in
   * force: the control said "nothing selected" and the results disagreed.
   */
  it("keeps the selected value as an option when the facet list drops it", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("const missing = value !== \"\" && !options.includes(value);");
    expect(source).toContain("{missing && <option value={value}>{value}</option>}");
  });

  it("compares as strings, because a <select> value is always a string", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("const options = values.map(String);");
  });
});

describe("a dropdown is not yanked out from under the customer", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  /**
   * REGRESSION: "the dropdowns reset as I browse through them."
   *
   * Distinct from the blanking bug above. Picking a width starts a debounced
   * request; its response lands several hundred milliseconds later, by which
   * time the customer has already opened the NEXT dropdown. Rewriting the
   * options of a live popup closes it in every browser, so the list being
   * scrolled simply disappeared.
   */
  it("freezes a facet list for as long as its control has focus", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("const values = frozen ?? facetValues;");
    expect(source).toContain("onFocus={() => setFrozen(facetValues)}");
  });

  it("releases the freeze on change and on blur, so the next open is current", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("onBlur={() => setFrozen(null)}");
    expect(source).toContain("setFrozen(null);");
  });

  /** The freeze is cosmetic. It must never touch what is being searched for. */
  it("freezes only what is displayed, never the applied filter", () => {
    const source = read(CATALOGUE);
    const select = source.slice(source.indexOf("function Select({"));
    expect(select).toContain("set(e.target.value)");
    // `frozen` is read for the option list and nowhere near the value or the
    // query string.
    expect(select).not.toContain("value={frozen");
  });

  it("keeps the previous brand array when the response changed nothing", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("sameValues(current, j.facets?.brands)");
  });
});

describe("list equality", () => {
  const brands = ["MICHELIN", "SUNNY"];

  it("recognises an identical list, so nothing re-renders", () => {
    expect(sameValues(brands, ["MICHELIN", "SUNNY"])).toBe(true);
  });

  it("recognises a genuinely changed list", () => {
    expect(sameValues(brands, ["MICHELIN"])).toBe(false);
    expect(sameValues(brands, ["MICHELIN", "SUNNY", "NOKIAN"])).toBe(false);
  });

  /** The server sorts these, so a different order is a different answer. */
  it("treats a reordered list as different", () => {
    expect(sameValues(brands, ["SUNNY", "MICHELIN"])).toBe(false);
  });

  it("never claims equality with a missing payload", () => {
    expect(sameValues(brands, undefined)).toBe(false);
    expect(sameValues(brands, null)).toBe(false);
  });

  it("holds for an empty list against an empty list", () => {
    expect(sameValues([], [])).toBe(true);
  });
});

describe("the filter bar is one sticky row of labelled selections", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  /**
   * A customer comparing tyres scrolls. A filter bar that scrolls away turns
   * every adjustment into a trip back to the top of the page.
   */
  it("pins the bar below the shell header, not over it", () => {
    // The customer shell header is itself sticky at top-0, so the search bar
    // offsets by its height instead of competing for the same strip.
    expect(read(CATALOGUE)).toContain("sticky top-[57px] z-30");
  });

  it("puts a small label above each field rather than beside it", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("function Field({");
    expect(source).toContain('className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft"');
  });

  /**
   * PRIMARY IS THE SIZE. It is the one thing a tyre shop always knows and the
   * one thing without which this screen cannot answer, so it gets its own row
   * of three equal columns at every width. Season, brand and sort follow in a
   * separate, quieter row. Previously all seven controls shared one grid and
   * the required three were indistinguishable from the optional four.
   */
  it("gives the size its own row, ahead of the secondary filters", () => {
    const source = read(CATALOGUE);
    const bar = source.slice(source.indexOf("THE SEARCH BAR"), source.indexOf("THE RESULTS REGION"));
    const size = bar.indexOf('grid grid-cols-3 gap-2');
    const secondary = bar.indexOf("SECONDARY — season, brand, sort");
    expect(size).toBeGreaterThan(-1);
    expect(size, "the size trio comes first").toBeLessThan(secondary);
    // Width, then aspect, then rim, in that order.
    expect(bar.indexOf("facetValues={widths}")).toBeLessThan(bar.indexOf("facetValues={aspectRatios}"));
    expect(bar.indexOf("facetValues={aspectRatios}")).toBeLessThan(bar.indexOf("facetValues={rims}"));
  });

  /**
   * Brand was a free-text input against a datalist, so a typed name that
   * matched no brand silently emptied the results. It is a selection now,
   * built from the same dependent facet query as the sizes.
   */
  it("makes brand a selection too", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("facetValues={brands}");
    expect(source, "the datalist is gone").not.toContain("<datalist");
  });

  /** "Add a clear/reset button that would reset selections." */
  it("carries a reset that clears the size as well as the filters", () => {
    const source = read(CATALOGUE);
    expect(source).toContain('tr("Azzera")');
    const reset = source.slice(source.indexOf("function reset()"), source.indexOf("function resetExtraFilters"));
    for (const setter of ['setWidth("")', 'setAspect("")', 'setRim("")', 'setSeason("")', 'setBrand("")', 'setTier("")']) {
      expect(reset, `reset must clear ${setter}`).toContain(setter);
    }
  });

  /**
   * The reset now sits on its own full-width row at the end of the bar, so
   * showing it only when there is something to clear cannot reflow the
   * controls above it — which is what the previous always-present-but-disabled
   * treatment existed to prevent.
   */
  it("offers a reset once there is something to clear", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("{hasSelection && (");
    expect(source).toContain('tr("Azzera")');
  });
});

describe("adding to the basket is visible", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;

  /**
   * REGRESSION: "I can't add items to basket." The click worked; nothing on
   * screen moved, so it was indistinguishable from broken.
   */
  it("confirms the click on the button itself", () => {
    const source = read("src/components/customer/CustomerCatalogue.tsx");
    expect(source).toContain("setAdded(key)");
    expect(source).toContain('tr("Aggiunto")');
  });

  it("tells the customer when storage refused the write", () => {
    const source = read("src/components/customer/CustomerCatalogue.tsx");
    expect(source).toContain("setAddError");
    expect(source).toContain("if (addBasketLine(o.tyre.productId, o.tyre.oldDot, quantity))");
  });

  /** One write, not `quantity` of them: the store merges by product+condition. */
  it("adds the chosen quantity in a single operation", () => {
    const source = read("src/components/customer/CustomerCatalogue.tsx");
    expect(source).toContain("onAdd(offer, quantity)");
    expect(source, "no loop of single adds").not.toContain("for (let i = 0; i < quantity");
  });

  it("shows a live count in the account navigation", () => {
    const layout = read("app/account/(secure)/layout.tsx");
    expect(layout).toContain("CustomerHeaderNav");
    expect(layout).toContain("CustomerMobileNav");

    const nav = read("src/components/customer/CustomerShellNav.tsx");
    // The event writeBasket already dispatched, which nothing used to hear.
    expect(nav).toContain("BASKET_CHANGED_EVENT");
    // ...and cross-tab, so two open tabs cannot show two different baskets.
    expect(nav).toContain('addEventListener("storage"');
  });
});

describe("a size with no tyres is answered, not left blank", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  /**
   * The deliberate cost of size lists that never narrow: a combination with
   * nothing behind it IS selectable now. That is a better screen than a
   * dimension the customer cannot pick and cannot explain the absence of —
   * but only if the empty result reads as an answer rather than a failure.
   */
  it("says there is no tyre in this size, above a drawing of one", () => {
    const source = read(CATALOGUE);
    expect(source).toContain('tr("Nessun pneumatico per questa misura")');
    expect(source).toContain("function TyreIcon(");
    const empty = source.slice(source.indexOf("function NoResults("));
    expect(
      empty.indexOf("<TyreIcon"),
      "the icon sits above the sentence"
    ).toBeLessThan(empty.indexOf("Nessun pneumatico per questa misura"));
  });

  it("offers the way out that matches why it is empty", () => {
    const source = read(CATALOGUE);
    // Extra filters applied -> offer to drop them. None applied -> the size
    // itself is the thing to change, and suggesting "remove filters" would be
    // advice the customer cannot act on.
    expect(source).toContain("hasExtraFilters");
    expect(source).toContain('tr("Rimuovi i filtri")');
  });

  it("distinguishes an empty size from a selection that was refused", () => {
    const source = read(CATALOGUE);
    // The refusal is its own branch and keeps its own wording; a too-large
    // selection is not "no tyres".
    expect(source).toContain('view === "refused"');
    expect(source).toContain("offers.length === 0 ? (");
    expect(source.indexOf('view === "refused"')).toBeLessThan(source.indexOf("offers.length === 0 ? ("));
  });
});

describe("loading is shown where the tyres will be", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  it("names what is loading, inside the results region", () => {
    const source = read(CATALOGUE);
    expect(source).toContain('tr("Ricerca pneumatici in corso…")');
    expect(source).toContain('aria-busy={loading}');
  });

  /** Nothing is in flight before a size is chosen, so a spinner would lie. */
  it("shows the instruction rather than a spinner before a size is chosen", () => {
    expect(
      catalogueViewState({
        widthMm: "205",
        aspectRatio: "55",
        rimInch: "",
        loading: true,
        error: false,
        refused: false,
      })
    ).toBe("awaiting_dimensions");
  });

  /** The controls stay usable while tyres load; only the results swap out. */
  it("never puts the skeleton over the filter bar", () => {
    const source = read(CATALOGUE);
    const bar = source.slice(source.indexOf("THE STICKY FILTER BAR"), source.indexOf("THE RESULTS REGION"));
    expect(bar).not.toContain("ResultsSkeleton");
  });
});

describe("the confirmation a customer cannot miss", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  /**
   * The first fix flipped the button to the SECONDARY variant, which on a
   * white card is close enough to its resting state to be missed — which is
   * how "I added it and nothing happened" survived it.
   */
  it("confirms on the card with a changed colour, word and icon", () => {
    const source = read(CATALOGUE);
    expect(source).toContain('"bg-state-success text-white"');
    expect(source).toContain("<CommerceCheckIcon");
    expect(source).toContain('added ? "border-state-success" : "border-ink/10"');
  });

  it("raises a toast naming what was added and where it went", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("function AddedToast(");
    expect(source).toContain('tr("Aggiunto al carrello")');
    expect(source).toContain('href="/account/basket"');
  });

  /** A confirmation, not a problem: announced after the current phrase. */
  it("announces the toast politely rather than interrupting", () => {
    const source = read(CATALOGUE);
    const toast = source.slice(source.indexOf("function AddedToast("));
    expect(toast).toContain('role="status"');
    expect(toast).toContain('aria-live="polite"');
    expect(toast, "an alert would interrupt the screen reader").not.toContain('role="alert"');
  });

  /** Nothing may accumulate in the corner of a long browse. */
  it("removes the toast on a timer, and only its own", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("setToast((current) => (current?.id === id ? null : current))");
  });

  it("motion is decoration: the toast still says its piece without it", () => {
    const css = read("app/globals.css");
    expect(css).toContain(".gr-toast");
    const reduced = css.slice(css.indexOf(".gr-toast"));
    expect(reduced).toContain("prefers-reduced-motion: reduce");
    expect(reduced, "reduced motion must not hide the confirmation").not.toContain("display: none");
  });
});

describe("the basket quantity box follows what was typed", () => {
  /**
   * REGRESSION: the input was bound to the SERVER preview, so it ignored
   * typing until the round trip returned and then snapped back to the old
   * number — a controlled input that appears not to accept input.
   */
  it("is driven by the local basket, not by the server preview", () => {
    const source = require("node:fs").readFileSync(
      "src/components/customer/CustomerBasket.tsx",
      "utf8"
    ) as string;
    expect(source).toContain("value={s.quantity}");
    expect(source).not.toContain("value={line.quantity}");
  });

  it("reports a storage failure instead of silently doing nothing", () => {
    const source = require("node:fs").readFileSync(
      "src/components/customer/CustomerBasket.tsx",
      "utf8"
    ) as string;
    expect(source).toContain("if (!writeBasket(next))");
  });
});

describe("the checkout idempotency key survives a retry", () => {
  /**
   * REGRESSION: the key was minted inside the verify effect, whose callback
   * identity changes with the locale. Switching language re-keyed the order,
   * so a retry after a failed submit would be treated as a NEW order — which
   * is exactly what the key exists to prevent.
   */
  it("is generated once, in an effect with no dependencies", () => {
    const source = require("node:fs").readFileSync(
      "src/components/customer/CustomerCheckout.tsx",
      "utf8"
    ) as string;

    expect(source).toContain("useEffect(() => {\n    setIdempotencyKey(crypto.randomUUID());\n  }, []);");
    // ...and no longer rides along with verify.
    expect(source).not.toContain("setIdempotencyKey(crypto.randomUUID());\n    void verify();");
  });
});

// ---------------------------------------------------------------------------
// Availability: per line, checked live at confirm
// ---------------------------------------------------------------------------

describe("a short line no longer fails the whole basket", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;

  /**
   * REGRESSION. resolveBasket threw BASKET_ITEM_UNAVAILABLE for the entire
   * request the moment one tyre ran short, so the customer got a banner that
   * named no tyre and offered nothing to do. The refusal is intact — the
   * order is still impossible — but it is now reported on the line.
   */
  it("prices and reports the lines it can, alongside the ones it cannot", () => {
    const available = realLine(4);
    const gone: BasketResolvedLine = {
      ...realLine(4),
      input: { productId: "22222222-2222-2222-2222-222222222222", oldDot: false, quantity: 4 },
      customer: null,
      internal: null,
      availability: { state: "unavailable", reason: "out_of_stock" },
    };

    const payload = customerBasketPayload([available, gone]);
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines[0].state).toBe("available");
    expect(payload.lines[1].state).toBe("unavailable");
    expect(payload.lines[1].unavailableReason).toBe("out_of_stock");
  });

  /** A total describing a purchase that cannot happen is not a total. */
  it("withholds the grand total while any line is unorderable", () => {
    const gone: BasketResolvedLine = {
      ...realLine(4),
      customer: null,
      internal: null,
      availability: { state: "unavailable", reason: "out_of_stock" },
    };

    const payload = customerBasketPayload([realLine(4), gone]);
    expect(payload.orderable).toBe(false);
    expect(payload.grandTotalCents).toBeNull();
  });

  it("reports how short a limited line is, so the customer can accept it", () => {
    const short: BasketResolvedLine = {
      ...realLine(20),
      availability: { state: "limited", availableQuantity: 6 },
    };

    const payload = customerBasketPayload([short]);
    expect(payload.lines[0].availableQuantity).toBe(6);
    expect(payload.orderable).toBe(false);
  });

  it("is orderable only when every line is available", () => {
    expect(customerBasketPayload([realLine(4)]).orderable).toBe(true);
    expect(customerBasketPayload([]).orderable).toBe(false);
  });

  /**
   * An unavailable line keeps its tyre so the card can name itself and link to
   * alternatives in its own size. Dropping it would leave the customer looking
   * for a tyre they believed they had added.
   */
  it("keeps the tyre on a line it cannot price", () => {
    const gone: BasketResolvedLine = {
      ...realLine(4),
      customer: null,
      internal: null,
      availability: { state: "unavailable", reason: "out_of_stock" },
    };
    expect(customerBasketPayload([gone]).lines[0].tyre?.sizeDisplay).toBe("205/55 R16");
  });

  it("shows the blocked line and the way out on both screens", () => {
    for (const file of [
      "src/components/customer/CustomerBasket.tsx",
      "src/components/customer/CustomerCheckout.tsx",
    ]) {
      expect(read(file), `${file} must render the verdict`).toContain("<LineAvailability");
    }
    const shared = read("src/components/customer/LineAvailability.tsx");
    expect(shared).toContain('tr("Non disponibile")');
    expect(shared).toContain('tr("Vedi alternative")');
  });

  it("disables checkout while a line is blocked, on both screens", () => {
    expect(read("src/components/customer/CustomerBasket.tsx")).toContain("!orderable");
    expect(read("src/components/customer/CustomerCheckout.tsx")).toContain("orderable &&");
  });
});

describe("what gets checked live, and when", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;

  /**
   * REVERSED AGAIN, 2026-09-26 — OWNER DECISION. Under D26 the preview called
   * the supplier on every basket view and quantity change. The owner has moved
   * the live check to final order confirmation only: browsing, adding,
   * editing quantities, the basket and entering checkout make NO supplier
   * call. The order gate (next test) is where the authoritative, force-fresh
   * check happens, and it still fails closed.
   */
  it("makes no supplier call from the basket preview", () => {
    const route = read("app/api/account/basket/preview/route.ts");
    expect(route).not.toContain("verifyBasketLive");
    expect(route).not.toContain("live-availability");
    expect(route).toContain("await resolveBasket(lines)");
  });

  it("uses the same two stages at order creation, but never from cache", () => {
    const orders = read("src/lib/server/sales-orders.ts");
    expect(orders).toContain("verifyBasketLive(resolved, Date.now, { forceFresh: true })");
  });

  /** One implementation, called from both places. */
  it("has exactly one live verification module", () => {
    const files = require("node:fs").readdirSync("src/lib/server") as string[];
    expect(files.filter((f: string) => /live|availability/i.test(f))).toEqual([
      "live-availability.ts",
    ]);
  });

  /**
   * The preview authorises nothing. A browser can send whatever it likes to
   * the order route, which resolves, verifies and re-checks the accepted
   * total again before writing a row.
   */
  it("still re-checks authoritatively at the order gate", () => {
    const orders = read("src/lib/server/sales-orders.ts");
    expect(orders).toContain("if (!basketIsOrderable(orderLines)) {");
    expect(orders).toContain("basket.grandTotalCents !== input.acceptedTotalCents");
  });

  /** A retry must not make a second round of supplier calls. */
  it("answers a repeated submit from the existing order, before verifying", () => {
    const source = read("src/lib/server/sales-orders.ts");
    expect(source.indexOf("findByIdempotencyKey")).toBeLessThan(
      source.indexOf("verifyBasketLive(resolved,")
    );
  });

  /**
   * The wording lost "con il fornitore" deliberately. The customer buys from
   * GommaRush; naming the source of the check on a customer screen is exactly
   * what the reskin brief forbids. The promise it makes is unchanged.
   */
  it("tells the customer the check happens at confirm, without naming a source", () => {
    const checkout = read("src/components/customer/CustomerCheckout.tsx");
    expect(checkout).toContain('tr("Disponibilità e prezzo vengono verificati alla conferma.")');
  });

  /**
   * The one surviving mention of a supplier is long-standing production copy
   * reassuring the customer that their order is NOT forwarded automatically.
   * That is a business statement about GommaRush's process, not the mechanism
   * behind a figure, and removing the word would invert its meaning.
   */
  it("keeps the standing reassurance that no order is forwarded automatically", () => {
    const checkout = read("src/components/customer/CustomerCheckout.tsx");
    expect(checkout).toContain("Non viene inoltrato automaticamente a un fornitore.");
    const mentions = checkout.match(/fornitore/g) ?? [];
    expect(mentions, "and it is the only one left").toHaveLength(1);
  });
});

describe("the price the customer agreed to is the price they get", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;

  /** A UI convention cannot guarantee this; the browser is not trusted. */
  it("is enforced on the server, not by the screen", () => {
    const orders = read("src/lib/server/sales-orders.ts");
    expect(orders).toContain("basket.grandTotalCents !== input.acceptedTotalCents");
    expect(orders).toContain('throw new OrderRefusal("PRICE_CHANGED", basket)');
  });

  it("refuses a request that does not say what was accepted", () => {
    const route = read("app/api/account/orders/route.ts");
    expect(route).toContain("!Number.isInteger(v.acceptedTotalCents)");
  });

  /**
   * Owner decision: the new price wins, and the change is SHOWN before the
   * confirm re-enables. The refusal carries the recomputed basket so the
   * screen can show the new figure rather than "something changed".
   */
  it("shows the old and the new figure before asking again", () => {
    const checkout = read("src/components/customer/CustomerCheckout.tsx");
    expect(checkout).toContain('tr("Il prezzo è cambiato")');
    expect(checkout).toContain("setPriceChange({ from: submittedTotal");
    expect(checkout).toContain('tr("Nessun ordine è stato creato. Conferma di nuovo per procedere al nuovo importo.")');
  });

  /** The retry is the SAME order, so the key must survive the round trip. */
  it("keeps the idempotency key across a price-change retry", () => {
    const checkout = read("src/components/customer/CustomerCheckout.tsx");
    const effect = checkout.slice(checkout.indexOf("setIdempotencyKey(crypto.randomUUID())"));
    expect(effect.slice(0, 60)).toContain("}, []);");
  });
});

describe("an order records what was actually verified", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;

  /**
   * When a customer disputes an availability promise, the answer turns on
   * whether the supplier was asked at the moment of sale or whether a stored
   * observation stood in.
   */
  it("snapshots the source and the observation time per line", () => {
    const orders = read("src/lib/server/sales-orders.ts");
    expect(orders).toContain("availability_verified: basket.verifiedSource");
    expect(orders).toContain("availability_lines: orderLines.map");
    expect(orders).toContain("live_failure_reason");
  });

  /** Weakest wins: one fallback line makes the whole basket's claim "feed". */
  it("never overstates the basket's claim", () => {
    const fallback: BasketResolvedLine = {
      ...realLine(4),
      provenance: { source: "feed_after_live_failure", observedAt: "2026-09-24T10:31:00Z" },
    };
    const live: BasketResolvedLine = {
      ...realLine(4),
      provenance: { source: "live", observedAt: "2026-09-24T12:00:00Z" },
    };
    expect(customerBasketPayload([live, fallback]).verifiedSource).toBe("feed_after_live_failure");
    expect(customerBasketPayload([live]).verifiedSource).toBe("live");
  });

  /**
   * The wording changed deliberately. "con il fornitore" named the mechanism
   * behind the answer, and the customer buys from GommaRush — the reskin
   * brief forbids supplier terminology on a customer screen. What the line
   * must still do is distinguish a confirmed figure from a stored one.
   */
  /**
   * CHANGED 2026-09-26 (owner decision): the line shows NO verification
   * source, timestamp or retry. The customer sees the catalogue's state; the
   * authoritative check happens at final confirmation.
   */
  it("shows no verification source, timestamp or retry on a line", () => {
    const shared = read("src/components/customer/LineAvailability.tsx");
    for (const gone of ["Verifica non riuscita", "Verificato ora", "Disponibilità rilevata alle", "verifiedAt", "onRetry", "Verifica in corso"]) {
      expect(shared, gone).not.toContain(gone);
    }
    expect(shared.toLowerCase(), "no supplier wording").not.toContain("fornitore");
  });

  /** A failed FINAL check is amber at checkout, never "Non disponibile". */
  it("never dresses a failed final check as out of stock", () => {
    const checkout = read("src/components/customer/CustomerCheckout.tsx");
    const panel = checkout.slice(
      checkout.indexOf('{status === "verification" && ('),
      checkout.indexOf('{status === "pricing"')
    );
    expect(panel).toContain("state-warning");
    expect(panel).not.toContain("Non disponibile");
  });
});
