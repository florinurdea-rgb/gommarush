import { describe, expect, it } from "vitest";
import { alternativesHref } from "@/lib/customer/alternatives";

/**
 * "Vedi alternative" on an unavailable basket line.
 *
 * A line the customer cannot buy is only half an answer; the other half is
 * where to find one they can. The rule about WHICH filters carry over is the
 * part that goes wrong, so it lives in a pure function and is asserted here
 * rather than being buried in a click handler.
 */

const TYRE = { widthMm: 205, aspectRatio: 55, rimInch: 16, season: "summer" };

describe("the link a blocked line offers", () => {
  it("lands on the catalogue already filtered to this size", () => {
    const href = alternativesHref(TYRE);
    expect(href).toContain("/account/catalogue?");
    expect(href).toContain("width=205");
    expect(href).toContain("aspect=55");
    expect(href).toContain("rim=16");
  });

  /**
   * A summer tyre is not an alternative to a winter one; it is a different
   * purchase.
   */
  it("carries the season over", () => {
    expect(alternativesHref(TYRE)).toContain("season=summer");
  });

  it("omits the season when the catalogue does not know it", () => {
    expect(alternativesHref({ ...TYRE, season: null })).not.toContain("season=");
  });

  /**
   * Brand and model are exactly what the customer now needs to change.
   * Carrying them over would reproduce the empty result they are escaping.
   */
  it("carries nothing that would reproduce the empty result", () => {
    const href = alternativesHref(TYRE) ?? "";
    expect(href).not.toContain("brand");
    expect(href).not.toContain("model");
    expect(href).not.toContain("tier");
  });
});

describe("when there is nothing to link to", () => {
  /**
   * The catalogue refuses to search on a partial size, so a link that could
   * only land on "choose a size" is worse than no link: it looks like it
   * failed.
   */
  it("returns null for an incomplete size", () => {
    expect(alternativesHref({ widthMm: 205, aspectRatio: 55, rimInch: null })).toBeNull();
    expect(alternativesHref({ widthMm: null, aspectRatio: 55, rimInch: 16 })).toBeNull();
  });

  it("returns null when the product has left the catalogue entirely", () => {
    expect(alternativesHref(null)).toBeNull();
    expect(alternativesHref(undefined)).toBeNull();
  });

  it("treats a zero or non-finite dimension as missing, not as a filter", () => {
    expect(alternativesHref({ ...TYRE, widthMm: 0 })).toBeNull();
    expect(alternativesHref({ ...TYRE, rimInch: Number.NaN })).toBeNull();
  });
});

describe("the catalogue reads what this writes", () => {
  const read = (path: string) => require("node:fs").readFileSync(path, "utf8") as string;

  /**
   * The two halves of the same feature. A link that arrives on a screen which
   * ignores its query string has sent the customer back to the beginning of
   * the job they were halfway through.
   */
  it("initialises its selection from the same parameter names", () => {
    const source = read("src/components/customer/CustomerCatalogue.tsx");
    expect(source).toContain('initialNumber("width")');
    expect(source).toContain('initialNumber("aspect")');
    expect(source).toContain('initialNumber("rim")');
    expect(source).toContain('initial("season")');
  });

  /**
   * Read ONCE, as initial state. An effect that wrote the query string back on
   * every render would fight the customer: every change they made would be
   * overwritten by the URL still sitting in the address bar.
   */
  it("reads the URL as initial state, never as a running effect", () => {
    const source = read("src/components/customer/CustomerCatalogue.tsx");
    expect(source).toContain("useState(() => initialNumber(");
    expect(source).not.toContain("useEffect(() => setWidth");
  });

  /** A hand-written query string must not reach the request unchecked. */
  it("accepts only digits as a dimension", () => {
    const source = read("src/components/customer/CustomerCatalogue.tsx");
    expect(source).toContain("/^\\d{1,4}$/.test(raw)");
  });
});
