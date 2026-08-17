import { describe, expect, it, vi } from "vitest";
import { formatTyreSizeLine, seasonLabel, yesNo } from "@/lib/tyre-lookup/format";
import { isPlausibleBarcode, normaliseBarcode } from "@/lib/tyre-lookup/normalise";

vi.mock("server-only", () => ({}));

const { coerceLookupResult, extractCitationSources } = await import("@/lib/tyre-lookup/anthropic-lookup");

describe("normaliseBarcode / isPlausibleBarcode", () => {
  it("trims and strips internal whitespace scanner noise", () => {
    expect(normaliseBarcode("  5452000742457  ")).toBe("5452000742457");
    expect(normaliseBarcode("545 200 074")).toBe("545200074");
  });

  it("accepts numeric EAN-length codes and alphanumeric article codes", () => {
    expect(isPlausibleBarcode("5452000742457")).toBe(true);
    expect(isPlausibleBarcode("ABC-1234-XL")).toBe(true);
  });

  it("rejects empty, too-short, and too-long input", () => {
    expect(isPlausibleBarcode("")).toBe(false);
    expect(isPlausibleBarcode("12")).toBe(false);
    expect(isPlausibleBarcode("1".repeat(65))).toBe(false);
  });

  it("rejects characters a real barcode would never contain", () => {
    expect(isPlausibleBarcode("545 200")).toBe(false); // internal space
    expect(isPlausibleBarcode("<script>")).toBe(false);
  });
});

describe("formatTyreSizeLine", () => {
  it("builds the full size line with load index, speed rating, and XL", () => {
    const line = formatTyreSizeLine({
      width: 225,
      aspectRatio: 40,
      rimDiameter: 18,
      loadIndex: "92",
      speedRating: "Y",
      extraLoad: true,
    });
    expect(line).toBe("225/40 R18 92Y XL");
  });

  it("omits the load-index/speed-rating segment when both are unknown", () => {
    const line = formatTyreSizeLine({
      width: 225,
      aspectRatio: 40,
      rimDiameter: 18,
      loadIndex: null,
      speedRating: null,
      extraLoad: false,
    });
    expect(line).toBe("225/40 R18");
  });

  it("returns null rather than a half-built size when a dimension is missing", () => {
    const line = formatTyreSizeLine({
      width: 225,
      aspectRatio: null,
      rimDiameter: 18,
      loadIndex: null,
      speedRating: null,
      extraLoad: null,
    });
    expect(line).toBeNull();
  });
});

describe("seasonLabel / yesNo", () => {
  it("translates season and booleans, passing through null", () => {
    expect(seasonLabel("summer")).toBe("Vară");
    expect(seasonLabel("winter")).toBe("Iarnă");
    expect(seasonLabel(null)).toBeNull();
    expect(yesNo(true)).toBe("Da");
    expect(yesNo(false)).toBe("Nu");
    expect(yesNo(null)).toBeNull();
  });
});

describe("extractCitationSources", () => {
  it("collects unique URLs from web_search_result_location citations only", () => {
    const sources = extractCitationSources([
      { type: "text", text: "a", citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A" }] },
      { type: "text", text: "b", citations: [{ type: "web_search_result_location", url: "https://a.example", title: "A dup" }] },
      { type: "text", text: "c", citations: [{ type: "some_other_citation_type", url: "https://ignored.example" }] },
      { type: "server_tool_use" },
    ]);
    expect(sources).toEqual([{ url: "https://a.example", title: "A" }]);
  });

  it("returns an empty list when there are no citations at all", () => {
    expect(extractCitationSources([{ type: "text", text: "no citations here" }])).toEqual([]);
  });
});

describe("coerceLookupResult — the honesty rules", () => {
  const SOURCES = [{ url: "https://example.com/tyre", title: "Example catalog" }];

  it("trusts an 'identified' claim only when backed by at least one source", () => {
    const result = coerceLookupResult(
      { status: "identified", brand: "Goodyear", model: "Eagle F1", width: 225, aspectRatio: 40, rimDiameter: 18 },
      "5452000742457",
      SOURCES
    );
    expect(result.status).toBe("identified");
    expect(result.brand).toBe("Goodyear");
    expect(result.sources).toEqual(SOURCES);
  });

  it("downgrades a claimed 'identified' with zero sources to 'uncertain' — never trusted at face value", () => {
    const result = coerceLookupResult(
      { status: "identified", brand: "Goodyear", model: "Eagle F1" },
      "5452000742457",
      []
    );
    expect(result.status).toBe("uncertain");
    expect(result.notes.some((n) => n.toLowerCase().includes("sursă"))).toBe(true);
  });

  it("returns every field null for 'unknown', even if the model tried to fill some in", () => {
    const result = coerceLookupResult(
      { status: "unknown", brand: "Should be discarded", ean: "should-be-discarded" },
      "0000000000000",
      SOURCES
    );
    expect(result.status).toBe("unknown");
    expect(result.brand).toBeNull();
    expect(result.ean).toBeNull();
    expect(result.sources).toEqual([]);
  });

  it("treats an unrecognised/missing status as 'unknown' rather than trusting stray fields", () => {
    const result = coerceLookupResult({ brand: "Goodyear" }, "123456789012", SOURCES);
    expect(result.status).toBe("unknown");
    expect(result.brand).toBeNull();
  });

  it("always echoes back the barcode that was actually searched, not anything from the model", () => {
    const result = coerceLookupResult({ status: "unknown" }, "5452000742457", []);
    expect(result.barcode).toBe("5452000742457");
  });
});
