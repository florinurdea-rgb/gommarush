import { describe, expect, it } from "vitest";
import {
  isLaneCode,
  laneByCode,
  laneForAdapter,
  SUPPLIER_LANES,
} from "@/lib/catalogue/supplier-lanes";
import {
  classifyVehicle,
  deriveListingState,
  isLiveOffer,
} from "@/lib/catalogue/listing-state";

/**
 * Lane attribution and row state.
 *
 * Both replace things that were previously either hard-coded or absent, and
 * both are the kind of logic that is cheap to get subtly wrong: a listing
 * attributed to the wrong lane is judged by the wrong commercial policy, and a
 * row in the wrong state is either hidden when it should be visible or shown
 * as a live offer when it is not.
 */

describe("the lane registry", () => {
  it("declares the three lanes the workspace shows", () => {
    expect(SUPPLIER_LANES.map((l) => l.code)).toEqual(["intersprint", "deldo", "carlini"]);
  });

  it("carries the indicative lead time per lane", () => {
    expect(laneByCode("intersprint")?.leadTimeLabel).toBe("7d");
    expect(laneByCode("deldo")?.leadTimeLabel).toBe("7d");
    expect(laneByCode("carlini")?.leadTimeLabel).toBe("48h");
  });

  /** Both Inter-Sprint importers are one commercial relationship. */
  it("maps both Inter-Sprint adapters to one lane", () => {
    expect(laneForAdapter("intersprint-feed")).toBe("intersprint");
    expect(laneForAdapter("isb")).toBe("intersprint");
  });

  /**
   * THE BUG THIS REPLACES: the selling policy was called with a literal
   * "intersprint" for every listing. Attribution now comes from the adapter
   * that wrote the row, so another lane's stock is never judged by
   * Inter-Sprint's offer rules.
   */
  it("returns null for an adapter it does not recognise, rather than guessing", () => {
    expect(laneForAdapter("some-new-supplier")).toBeNull();
    expect(laneForAdapter(null)).toBeNull();
    expect(laneForAdapter("")).toBeNull();
  });

  it("validates lane codes coming off a query string", () => {
    expect(isLaneCode("deldo")).toBe(true);
    expect(isLaneCode("DELDO")).toBe(false);
    expect(isLaneCode("intersprint-feed")).toBe(false);
    expect(isLaneCode(null)).toBe(false);
  });
});

describe("vehicle classification", () => {
  /** Provenance first: which feed delivered the row is a fact, not a guess. */
  it("uses the import run's feed category when there is one", () => {
    expect(classifyVehicle({ feedCategory: "truck", productClass: null })).toBe("truck");
    expect(classifyVehicle({ feedCategory: "pcr", productClass: null })).toBe("car_van");
  });

  it("lets provenance win over a disagreeing product class", () => {
    expect(classifyVehicle({ feedCategory: "truck", productClass: "passenger_car" })).toBe("truck");
  });

  it("falls back to product_class for legacy rows with no feed category", () => {
    expect(classifyVehicle({ feedCategory: null, productClass: "passenger_car" })).toBe("car_van");
    expect(classifyVehicle({ feedCategory: null, productClass: "suv_4x4" })).toBe("car_van");
    expect(classifyVehicle({ feedCategory: null, productClass: "truck" })).toBe("truck");
  });

  /**
   * A van tyre is not a lorry tyre. Putting `light_truck_van` behind the Truck
   * tab would hide several hundred tyres from where anyone would look.
   */
  it("keeps van tyres with cars", () => {
    expect(classifyVehicle({ feedCategory: null, productClass: "light_truck_van" })).toBe("car_van");
  });

  it("says unknown rather than inventing a class", () => {
    expect(classifyVehicle({ feedCategory: null, productClass: null })).toBe("unknown");
    expect(classifyVehicle({ feedCategory: null, productClass: "something_new" })).toBe("unknown");
  });
});

describe("listing state", () => {
  const base = { hasCurrentPrice: true, reviewRequired: false, hasOpenConflict: false };

  it("is CURRENT when nothing is wrong", () => {
    expect(deriveListingState(base)).toBe("CURRENT");
  });

  /**
   * The 1,841 legacy listings the live feed no longer carries. They stay
   * visible — deactivating them would assert the supplier dropped them, and
   * D14 is unresolved.
   */
  it("is NO_CURRENT_PRICE when the latest observation has no price", () => {
    expect(deriveListingState({ ...base, hasCurrentPrice: false })).toBe("NO_CURRENT_PRICE");
  });

  it("is NEEDS_REVIEW when priced but incompletely described", () => {
    expect(deriveListingState({ ...base, reviewRequired: true })).toBe("NEEDS_REVIEW");
  });

  /** Two sources disagreeing about what a product IS outranks everything. */
  it("is CONFLICT above every other state", () => {
    expect(
      deriveListingState({ hasCurrentPrice: true, reviewRequired: true, hasOpenConflict: true })
    ).toBe("CONFLICT");
    expect(
      deriveListingState({ hasCurrentPrice: false, reviewRequired: false, hasOpenConflict: true })
    ).toBe("CONFLICT");
  });

  it("prefers the missing price over the review flag", () => {
    expect(
      deriveListingState({ hasCurrentPrice: false, reviewRequired: true, hasOpenConflict: false })
    ).toBe("NO_CURRENT_PRICE");
  });

  it("counts only priced states as live offers", () => {
    expect(isLiveOffer("CURRENT")).toBe(true);
    expect(isLiveOffer("NEEDS_REVIEW")).toBe(true);
    expect(isLiveOffer("NO_CURRENT_PRICE")).toBe(false);
    expect(isLiveOffer("CONFLICT")).toBe(false);
  });
});
