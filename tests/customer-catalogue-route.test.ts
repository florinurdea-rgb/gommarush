import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FORBIDDEN_CUSTOMER_FIELDS } from "@/lib/pricing/projection";

/**
 * The customer catalogue ROUTE, exercised as a request.
 *
 * Two things can only be asserted here rather than one level down:
 *
 *  1. that an incomplete size does not reach the catalogue read at all. The
 *     component has the same gate, but a query string is typed by whoever is
 *     holding the browser, so the guarantee has to live on the server.
 *  2. that the JSON actually sent over the wire carries no supplier internals.
 *     The projection makes that structurally true; this proves the route did
 *     not add anything alongside it.
 */

const searchCustomerCatalogue = vi.fn();
const getCatalogueFacets = vi.fn();
const getTyreDimensions = vi.fn();
const requireCustomerSession = vi.fn();

vi.mock("@/lib/server/customer-catalogue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/customer-catalogue")>();
  return { ...actual, searchCustomerCatalogue: (...a: unknown[]) => searchCustomerCatalogue(...a) };
});

vi.mock("@/lib/server/catalogue-browse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/catalogue-browse")>();
  return { ...actual, getCatalogueFacets: (...a: unknown[]) => getCatalogueFacets(...a) };
});

vi.mock("@/lib/server/catalogue-dimensions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/catalogue-dimensions")>();
  return { ...actual, getTyreDimensions: (...a: unknown[]) => getTyreDimensions(...a) };
});

vi.mock("@/lib/auth/customer-session", () => ({
  requireCustomerSession: () => requireCustomerSession(),
}));

const FACETS = {
  widths: [195, 205],
  aspectRatios: [55, 60],
  rims: [16, 17],
  seasons: ["summer"],
  brands: ["ALPHA"],
  schemaAvailable: true,
};

/** The whole, unfiltered size list — the same answer for every selection. */
const DIMENSIONS = {
  widths: [195, 205, 225],
  aspectRatios: [45, 55, 60],
  rims: [16, 17, 18],
  schemaAvailable: true,
};

/** A customer offer as the real projection produces it: no supplier fields. */
const OFFER = {
  tyre: {
    productId: "p-1",
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
  tyreSaleNetCents: 12_000,
  pfuStatus: "TO_CONFIRM",
  pfuAmountCents: null,
  vatAmountCents: null,
  customerTotalCents: null,
  priceAvailable: true,
};

async function call(query: string) {
  const { GET } = await import("../app/api/account/catalogue/route");
  const { NextRequest } = await import("next/server");
  const response = await GET(new NextRequest(`https://gommarush.test/api/account/catalogue${query}`));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  requireCustomerSession.mockResolvedValue({
    subject: "auth-1",
    accountId: "acc-1",
    customerId: "cust-1",
    email: "cliente@example.com",
  });
  getCatalogueFacets.mockResolvedValue(FACETS);
  getTyreDimensions.mockResolvedValue(DIMENSIONS);
  searchCustomerCatalogue.mockResolvedValue({
    offers: [OFFER],
    total: 1,
    limit: 24,
    offset: 0,
    sort: "price_asc",
    schemaAvailable: true,
    refused: null,
  });
});

afterEach(() => vi.clearAllMocks());

describe("the catalogue is not queried before a complete size", () => {
  const incomplete = [
    ["nothing chosen", ""],
    ["width only", "?width=205"],
    ["width and aspect", "?width=205&aspect=55"],
    ["width and rim, no aspect", "?width=205&rim=16"],
    ["aspect and rim, no width", "?aspect=55&rim=16"],
  ] as const;

  for (const [name, query] of incomplete) {
    it(`does not read the catalogue with ${name}`, async () => {
      const { body } = await call(query);

      expect(searchCustomerCatalogue, "an incomplete size must not reach the read").not.toHaveBeenCalled();
      expect(body.awaitingDimensions).toBe(true);
      expect(body.offers).toEqual([]);
      expect(body.total).toBe(0);
    });
  }

  /**
   * THE SIZE LISTS NO LONGER NARROW, and this is where that is pinned.
   *
   * It used to assert the opposite — that choosing a width narrowed the rim
   * list — because the selectors were filled from these dependent facets.
   * That narrowing was the slow half of the screen (a scan per keystroke) and
   * the unstable half (a list that moves under an open dropdown closes it, a
   * list that drops the chosen value blanks its own control).
   *
   * They now come from getTyreDimensions: the whole catalogue, unfiltered,
   * cached, the same answer whatever is selected. A size with no tyres behind
   * it becomes selectable, and the results panel says so.
   */
  it("serves the whole size list, unnarrowed, whatever has been chosen", async () => {
    const none = await call("");
    const partial = await call("?width=205&aspect=55");

    for (const { body } of [none, partial]) {
      expect(body.awaitingDimensions).toBe(true);
      expect(body.facets.widths).toEqual([195, 205, 225]);
      expect(body.facets.aspectRatios).toEqual([45, 55, 60]);
      expect(body.facets.rims).toEqual([16, 17, 18]);
    }
  });

  it("reads them from the cached source, never from the dependent facet scan", async () => {
    await call("?width=205");

    expect(getTyreDimensions).toHaveBeenCalled();
    expect(
      getCatalogueFacets,
      "the scan this path exists to avoid must not run"
    ).not.toHaveBeenCalled();
  });

  /**
   * The first selector must always have options. Previously guaranteed by
   * always running the facet scan; now guaranteed by the lists not depending
   * on the selection at all, which is strictly stronger.
   */
  it("offers widths when nothing at all has been chosen", async () => {
    const { body } = await call("");

    expect(body.facets.widths.length).toBeGreaterThan(0);
    expect(searchCustomerCatalogue).not.toHaveBeenCalled();
  });

  /**
   * A brand list over the whole catalogue is exactly the scan that made the
   * screen slow, and it is meaningless before a size narrows it.
   */
  it("does not compute a brand list before a size is chosen", async () => {
    const { body } = await call("?width=205");
    expect(body.facets.brands).toEqual([]);
  });

  it("asks only for the brand facet once the size is complete", async () => {
    await call("?width=205&aspect=55&rim=16");

    expect(getCatalogueFacets).toHaveBeenCalledTimes(1);
    const [facetQuery, , fields] = getCatalogueFacets.mock.calls[0];
    expect(facetQuery).toMatchObject({ widthMm: 205, aspectRatio: 55, rimInch: 16 });
    expect(fields, "four discarded scans per keystroke is what this removes").toEqual(["brands"]);
  });

  it("reads the catalogue once all three dimensions are present", async () => {
    const { body } = await call("?width=205&aspect=55&rim=16");

    expect(searchCustomerCatalogue).toHaveBeenCalledTimes(1);
    expect(body.awaitingDimensions).toBe(false);
    expect(body.total).toBe(1);
    expect(body.offers).toHaveLength(1);
  });

  it("treats a non-numeric dimension as absent rather than as a filter", async () => {
    await call("?width=205&aspect=55&rim=sedici");
    expect(searchCustomerCatalogue).not.toHaveBeenCalled();
  });
});

describe("the catalogue route refuses anonymous callers", () => {
  it("returns 401 and reads nothing without a bound customer session", async () => {
    requireCustomerSession.mockRejectedValue(new Error("UNAUTHORIZED_CUSTOMER"));

    const { status, body } = await call("?width=205&aspect=55&rim=16");

    expect(status).toBe(401);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(searchCustomerCatalogue).not.toHaveBeenCalled();
    expect(getCatalogueFacets).not.toHaveBeenCalled();
  });
});

describe("the catalogue response carries no supplier internals", () => {
  it("emits none of the forbidden fields in the serialised body", async () => {
    const { body } = await call("?width=205&aspect=55&rim=16");
    const json = JSON.stringify(body);

    for (const field of FORBIDDEN_CUSTOMER_FIELDS) {
      expect(json, `${field} must not reach a customer`).not.toContain(field);
    }
    for (const word of ["supplier", "lane", "adapter", "purchase", "margin", "markup"]) {
      expect(json.toLowerCase(), `"${word}" must not appear in a customer payload`).not.toContain(word);
    }
  });

  it("never asks the read for a supplier lane", async () => {
    await call("?width=205&aspect=55&rim=16");

    const [query] = searchCustomerCatalogue.mock.calls[0];
    expect(query).not.toHaveProperty("lane");
  });
});

describe("the catalogue route states the delivery and tax position", () => {
  it("promises delivery by service class, not by supplier lead time", async () => {
    const { body } = await call("?width=205&aspect=55&rim=16");

    expect(body.fulfilment).toEqual({ class: "standard", maxDays: 7 });
  });

  it("publishes the statutory VAT rate and the resolved PFU position", async () => {
    const { body } = await call("?width=205&aspect=55&rim=16");

    expect(body.vatRatePercent).toBe(22);
    // D11, resolved by the owner: PFU is inside the VAT taxable base.
    expect(body.pfuInVatBase).toBe(true);
  });

  it("does not resolve a customer total, because the PFU tariff is still open", async () => {
    const { body } = await call("?width=205&aspect=55&rim=16");

    expect(body.offers[0].pfuStatus).toBe("TO_CONFIRM");
    expect(body.offers[0].customerTotalCents).toBeNull();
    expect(body.offers[0].tyreSaleNetCents).toBe(12_000);
  });
});

describe("the catalogue route keeps the brand-tier taxonomy owner-approved", () => {
  it("ignores a tier the customer asks for while no mapping is approved", async () => {
    const { body } = await call("?width=205&aspect=55&rim=16&tier=premium");

    const [query] = searchCustomerCatalogue.mock.calls[0];
    expect(query.brandTier).toBeNull();
    expect(body.tiersConfigured).toBe(false);
  });
});
