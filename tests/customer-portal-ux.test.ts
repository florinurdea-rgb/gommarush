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
    customer: toCustomerOffer(listing),
    internal: toInternalOffer(listing),
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
  it("pins the bar to the top of the viewport", () => {
    expect(read(CATALOGUE)).toContain("sticky top-0 z-30");
  });

  it("puts a small label above each field rather than beside it", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("function Field({");
    expect(source).toContain('className="block text-[11px] font-bold uppercase tracking-wide text-ink-soft"');
  });

  it("lays the controls out as a single row at full width", () => {
    const source = read(CATALOGUE);
    // Seven columns when the tier filter is configured, six when it is not.
    expect(source).toContain('tiersConfigured ? "lg:grid-cols-8" : "lg:grid-cols-7"');
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

  /** Disabled rather than hidden, so the row does not reflow under the cursor. */
  it("keeps the reset in the bar at all times", () => {
    expect(read(CATALOGUE)).toContain("disabled={!hasSelection}");
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
    expect(source).toContain("if (addBasketLine(o.tyre.productId, o.tyre.oldDot))");
  });

  it("shows a live count in the account navigation", () => {
    const layout = read("app/account/(secure)/layout.tsx");
    expect(layout).toContain("CustomerBasketLink");

    const link = read("src/components/customer/CustomerBasketLink.tsx");
    // The event writeBasket already dispatched, which nothing used to hear.
    expect(link).toContain("BASKET_CHANGED_EVENT");
    // ...and cross-tab, so two open tabs cannot show two different baskets.
    expect(link).toContain('addEventListener("storage"');
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
    expect(source).toContain("<CheckIcon");
    expect(source).toContain("ring-2 ring-state-success");
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

describe("the basket in the top bar", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;
  const LINK = "src/components/customer/CustomerBasketLink.tsx";

  it("carries an ordinary cart icon before the count", () => {
    const source = read(LINK);
    expect(source).toContain("<CartIcon");
    // Icon first, then the label, then the badge.
    expect(source.indexOf("<CartIcon")).toBeLessThan(source.indexOf('tr("Carrello")'));
    expect(source.indexOf('tr("Carrello")')).toBeLessThan(source.indexOf("aria-label="));
  });

  it("uses one cart mark everywhere, not a second drawing of the same thing", () => {
    const icon = read("src/components/customer/CartIcon.tsx");
    expect(icon).toContain("export function CartIcon");
    expect(read(LINK)).toContain('from "@/components/customer/CartIcon"');
    expect(read("src/components/customer/CustomerCatalogue.tsx")).toContain(
      'from "@/components/customer/CartIcon"'
    );
  });

  /** Decorative: the count beside it already carries the meaning. */
  it("hides the icon from assistive technology", () => {
    expect(read("src/components/customer/CartIcon.tsx")).toContain('aria-hidden="true"');
  });

  /** Growing on a REMOVAL would celebrate the wrong event. */
  it("draws the eye only when the count goes up", () => {
    const source = read(LINK);
    expect(source).toContain("next > previous.current");
    expect(source).toContain("scale-125");
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
