import { describe, expect, it } from "vitest";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";
import {
  buildIntersprintObservation,
  buildIntersprintPreviewObservation,
  CURRENT_INTERSPRINT_PRICE_BASIS,
  CURRENT_PRICE_BASIS_PROVENANCE,
  INTERSPRINT_FRESHNESS_POLICY,
  INTERSPRINT_LANE_CODE,
  isPriceBasisCommerciallyUsable,
} from "@/lib/suppliers/intersprint/feed/observation";
import {
  classifyObservation,
  DataClassificationError,
  isCommerciallyUsable,
  type FreshnessPolicy,
} from "@/lib/suppliers/observation";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
import { resolvePfu } from "@/lib/pricing/pfu";
import { toCustomerOffer, toInternalOffer, type PricedListing } from "@/lib/pricing/projection";
import { assessSellability } from "@/lib/commerce/selling-policy";
import { INTERSPRINT_PCR_ROWS, intersprintRow } from "./intersprint-feed-fixtures";

/**
 * Inter-Sprint feed row -> observation -> M7 pricing engine -> preview.
 *
 * The whole chain, with no database. It exists to prove that a real
 * price-bearing row produces a real GommaRush selling price, and that every
 * refusal along the way still holds when the price is genuine rather than
 * absent.
 */

const ROW = INTERSPRINT_PCR_ROWS.vredestein20555R16;
const OBSERVED_AT = new Date("2026-08-05T09:00:00Z");
const NOW = new Date("2026-08-05T10:00:00Z");
/** Supplied by the caller, never by the lane. See the freshness test below. */
const POLICY: FreshnessPolicy = { staleAfterMs: 24 * 60 * 60 * 1000 };

function normalized(overrides: Record<string, string> = {}) {
  const outcome = intersprintFeedAdapter.normalizeRow(2, intersprintRow(ROW, overrides));
  if (!outcome.normalized) throw new Error("fixture row should normalise");
  return outcome.normalized;
}

function observation(overrides: Record<string, string> = {}, classification: "live" | "test" = "live") {
  return buildIntersprintObservation({
    row: normalized(overrides),
    classification,
    observedAt: OBSERVED_AT,
  });
}

describe("feed row becomes a supplier observation", () => {
  it("carries the exact supplier listing identity, never the EAN", () => {
    const o = observation();
    expect(o.laneCode).toBe(INTERSPRINT_LANE_CODE);
    expect(o.supplierListingKey).toBe("ISB:34197");
    expect(o.supplierArticleId).toBe("34197");
  });

  it("carries the purchase price and the availability band shape", () => {
    const o = observation();
    expect(o.purchasePrice).toBe(99.2);
    expect(o.stockExact).toBe(6);
    expect(o.stockMinimum).toBe(6);
    expect(o.stockRaw).toBe("6");
  });

  it("keeps a banded availability as a minimum through the observation", () => {
    const o = observation({ available: ">  20" });
    expect(o.stockExact).toBeNull();
    expect(o.stockMinimum).toBe(20);
    expect(o.stockRaw).toBe(">  20");
  });

  /** Inter-Sprint states no currency anywhere. EUR is a guess, not a fact. */
  it("invents no currency", () => {
    expect(observation().currency).toBeNull();
  });

  it("states no DOT year, demo flag or stock condition, because the feed does not", () => {
    const o = observation();
    expect(o.dotYear).toBeNull();
    expect(o.demo).toBeNull();
    expect(o.stockCondition).toBeNull();
  });
});

describe("classification is explicit and enforced at run time", () => {
  it("marks a sample file as test data, whatever else is valid", () => {
    const state = classifyObservation(observation({}, "test"), POLICY, NOW);
    expect(state.state).toBe("test_data");
    expect(isCommerciallyUsable(state)).toBe(false);
  });

  /**
   * The two files we hold ARE samples from August. An importer that defaulted
   * to "live" would publish them as today's cost.
   */
  it("refuses to build an observation with no classification", () => {
    expect(() =>
      buildIntersprintObservation({
        row: normalized(),
        observedAt: OBSERVED_AT,
      } as unknown as Parameters<typeof buildIntersprintObservation>[0])
    ).toThrow(DataClassificationError);
  });

  it("refuses an invalid classification rather than coercing it", () => {
    for (const value of [null, "", "LIVE", "production", "sample", 1, {}]) {
      expect(() =>
        buildIntersprintObservation({
          row: normalized(),
          classification: value,
          observedAt: OBSERVED_AT,
        } as unknown as Parameters<typeof buildIntersprintObservation>[0])
      ).toThrow(DataClassificationError);
    }
  });
});

describe("freshness is a policy, never a supplier fact", () => {
  /** Inter-Sprint publishes no refresh cadence, so the lane supplies none. */
  it("declares no freshness threshold of its own", () => {
    expect(INTERSPRINT_FRESHNESS_POLICY).toBeNull();
  });

  /**
   * Freshness is tested on an observation whose commercial mode has been
   * resolved, because an unresolved mode fails closed FIRST and would mask
   * the age check entirely. This is what an Inter-Sprint observation will
   * look like once the price basis is confirmed.
   */
  const asIfBasisConfirmed = (o: ReturnType<typeof observation>) => ({
    ...o,
    commercialMode: "transport_separate" as const,
  });

  it("goes stale against a caller-supplied policy", () => {
    const august = asIfBasisConfirmed(
      buildIntersprintObservation({
        row: normalized(),
        classification: "live",
        observedAt: new Date("2026-08-05T09:00:00Z"),
      })
    );

    const state = classifyObservation(august, POLICY, new Date("2026-09-22T09:00:00Z"));
    expect(state.state).toBe("stale");
    expect(isCommerciallyUsable(state)).toBe(false);
  });

  it("is current inside the policy window", () => {
    const state = classifyObservation(asIfBasisConfirmed(observation()), POLICY, NOW);
    expect(state.state).toBe("current");
    expect(isCommerciallyUsable(state)).toBe(true);
  });

  /** A banded '>  20' row is just as usable as an exact count. */
  it("accepts a banded availability as usable stock", () => {
    const state = classifyObservation(
      asIfBasisConfirmed(observation({ available: ">  20" })),
      POLICY,
      NOW
    );
    expect(state.state).toBe("current");
  });
});

describe("the price basis is unconfirmed, and that is recorded", () => {
  /**
   * Nothing in the feed or the covering email says whether `nett-price` is the
   * price Go Rush actually pays. The number is carried; the claim is not.
   */
  /**
   * M9 CHANGE. M8 carried 'feed_nett_price_unconfirmed', which made every
   * Inter-Sprint price unusable. The owner has since confirmed nett-price is
   * the net purchase cost, so the basis is confirmed — by the OWNER, which is
   * what the provenance records. Inter-Sprint has still never written it down.
   */
  it("carries the owner-confirmed basis, labelled as the owner's", () => {
    expect(CURRENT_INTERSPRINT_PRICE_BASIS).toBe("confirmed_net_to_gorush");
    expect(isPriceBasisCommerciallyUsable(CURRENT_INTERSPRINT_PRICE_BASIS)).toBe(true);
    expect(CURRENT_PRICE_BASIS_PROVENANCE).toBe("POLICY_OWNER");
  });

  it("still treats the M8 unconfirmed basis as unusable", () => {
    expect(isPriceBasisCommerciallyUsable("feed_nett_price_unconfirmed")).toBe(false);
  });

  /**
   * commercialMode 'unknown' is what stops an unconfirmed price being marked
   * up and quoted, via the same gate the Deldo lane uses.
   */
  /**
   * Transport inclusion depends on the RELEASE, not the row, so an
   * observation built without a release quantity still fails closed. Sourcing
   * has not decided yet, and guessing a full batch would promise delivery we
   * have not earned.
   */
  it("fails closed when the release quantity is not yet known", () => {
    const o = observation();
    expect(o.commercialMode).toBe("unknown");

    expect(classifyObservation(o, POLICY, NOW)).toEqual({
      state: "no_usable_observation",
      reason: "unknown_commercial_mode",
    });
  });

  it("includes transport once the PCR minimum of 60 is reached", () => {
    const o = buildIntersprintObservation({
      row: normalized(),
      classification: "live",
      observedAt: OBSERVED_AT,
      category: "pcr",
      releaseQuantity: 60,
    });

    expect(o.commercialMode).toBe("transport_included");
    expect(isCommerciallyUsable(classifyObservation(o, POLICY, NOW))).toBe(true);
  });

  it("keeps transport separate below the minimum", () => {
    const o = buildIntersprintObservation({
      row: normalized(),
      classification: "live",
      observedAt: OBSERVED_AT,
      category: "pcr",
      releaseQuantity: 59,
    });

    expect(o.commercialMode).toBe("transport_separate");
    // Still a real, usable price — it simply does not carry delivery.
    expect(isCommerciallyUsable(classifyObservation(o, POLICY, NOW))).toBe(true);
  });

  it("uses the truck minimum of 10 for truck stock", () => {
    const pcr = buildIntersprintObservation({
      row: normalized(), classification: "live", observedAt: OBSERVED_AT,
      category: "pcr", releaseQuantity: 10,
    });
    const truck = buildIntersprintObservation({
      row: normalized(), classification: "live", observedAt: OBSERVED_AT,
      category: "truck", releaseQuantity: 10,
    });

    expect(pcr.commercialMode).toBe("transport_separate");
    expect(truck.commercialMode).toBe("transport_included");
  });

  /** The preview prices on the consolidated-release basis, and says so. */
  it("builds a preview observation that reaches the minimum", () => {
    const o = buildIntersprintPreviewObservation({
      row: normalized(),
      classification: "live",
      observedAt: OBSERVED_AT,
    });

    expect(o.commercialMode).toBe("transport_included");
    expect(isCommerciallyUsable(classifyObservation(o, POLICY, NOW))).toBe(true);
  });
});

describe("a real price flows into the central pricing engine", () => {
  /** The headline number: EUR 99.20 cost, 20% configured markup. */
  it("produces a GommaRush net selling price from the feed price", () => {
    const o = observation();
    const costCents = Math.round((o.purchasePrice as number) * 100);

    const breakdown = calculateTyrePrice(
      { supplierCostCents: costCents, pfu: resolvePfu({ weightKg: 8.238 }) },
      DEFAULT_PRICING_SETTINGS
    );

    expect(costCents).toBe(9_920);
    expect(breakdown.markupPercentApplied).toBe(20);
    expect(breakdown.markupAmountCents).toBe(1_984);
    expect(breakdown.tyreSaleNetCents).toBe(11_904);
  });

  it("leaves PFU unresolved and therefore produces no customer total", () => {
    const breakdown = calculateTyrePrice(
      { supplierCostCents: 9_920, pfu: resolvePfu({ weightKg: 8.238 }) },
      DEFAULT_PRICING_SETTINGS
    );

    expect(breakdown.resolution).toBe("pfu_unresolved");
    expect(breakdown.pfuStatus).toBe("TO_CONFIRM");
    expect(breakdown.pfuAmountCents).toBeNull();
    expect(breakdown.customerTotalCents).toBeNull();
  });

  /** A tyre weight is in the feed. It still cannot become a PFU amount. */
  it("does not let the feed's weight become a PFU value", () => {
    expect(normalized().weightKg).toBeCloseTo(8.238, 3);
    expect(resolvePfu({ weightKg: 8.238 }).amountCents).toBeNull();
  });

  it("cannot price a row whose price the adapter refused", () => {
    const o = observation({ "nett-price": "" });
    expect(o.purchasePrice).toBeNull();

    const breakdown = calculateTyrePrice(
      { supplierCostCents: null, pfu: resolvePfu({}) },
      DEFAULT_PRICING_SETTINGS
    );
    expect(breakdown.resolution).toBe("cost_unavailable");
    expect(breakdown.tyreSaleNetCents).toBeNull();
  });
});

describe("the catalogue preview projections", () => {
  function pricedListing(): PricedListing {
    const row = normalized();
    const o = observation();
    return {
      tyre: {
        productId: "00000000-0000-0000-0000-000000000001",
        brand: row.brand,
        modelPattern: row.modelPattern,
        description: row.description,
        sizeDisplay: "205/55 R16",
        widthMm: row.widthMm,
        aspectRatio: row.aspectRatio,
        rimInch: row.rimInch,
        loadIndex: row.loadIndex,
        speedRating: row.speedRating,
        loadSpeedRaw: row.loadSpeedRaw,
        season: "winter",
        productClass: "passenger_car",
        xl: null,
        runFlat: null,
        oldDot: false,
        eprelId: row.eprelId,
      },
      availability: "in_stock",
      supplierListingId: "00000000-0000-0000-0000-000000000002",
      supplierName: "Inter-Sprint Banden BV",
      supplierArticleId: row.supplierArticleId,
      costObservedAt: o.observedAt.toISOString(),
      supplierStockExact: o.stockExact,
      supplierStockMinimum: o.stockMinimum,
      supplierStockRaw: o.stockRaw,
      sellability: assessSellability({
        stock: { stockExact: o.stockExact, stockMinimum: o.stockMinimum },
        laneCode: INTERSPRINT_LANE_CODE,
      }),
      breakdown: calculateTyrePrice(
        { supplierCostCents: 9_920, pfu: resolvePfu({ weightKg: 8.238 }) },
        DEFAULT_PRICING_SETTINGS
      ),
    };
  }

  it("gives an operator the whole commercial chain", () => {
    const internal = toInternalOffer(pricedListing());

    expect(internal.supplierCostCents).toBe(9_920);
    expect(internal.markupPercentApplied).toBe(20);
    expect(internal.tyreSaleNetCents).toBe(11_904);
    expect(internal.grossProfitCents).toBe(1_984);
    expect(internal.pfuStatus).toBe("TO_CONFIRM");
    expect(internal.customerTotalCents).toBeNull();
    expect(internal.supplierName).toBe("Inter-Sprint Banden BV");
  });

  /** The commercial secret this whole boundary exists to keep. */
  it("never shows a customer the Inter-Sprint cost, name or article", () => {
    const serialised = JSON.stringify(toCustomerOffer(pricedListing()));

    expect(serialised).not.toContain("Inter-Sprint");
    expect(serialised).not.toContain("9920");
    expect(serialised).not.toContain("99.2");
    expect(serialised).not.toContain("34197");
    expect(serialised).not.toContain("1984");
    // The tyre and its selling price are still there.
    expect(serialised).toContain("VREDESTEIN");
    expect(serialised).toContain("11904");
  });

  it("hides the supplier's stock internals from the customer", () => {
    const customer = toCustomerOffer(pricedListing());
    const serialised = JSON.stringify(customer);

    expect(customer.availability).toBe("in_stock");
    expect(serialised).not.toContain(">  20");
    expect(serialised).not.toContain("stockMinimum");
    expect(serialised).not.toContain("stockRaw");
  });
});
