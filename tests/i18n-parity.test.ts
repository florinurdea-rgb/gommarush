import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EN_STRINGS } from "@/lib/i18n/admin-strings.data";
import { translate } from "@/lib/i18n/admin-strings";
import { LOCALES, errorMessage, orderStatusMeta, t } from "@/lib/i18n/logistics";

/**
 * The dashboard is bilingual by data, not by types: the operational string
 * map is keyed on the Italian source text, so nothing here fails to compile
 * when a translation is missing. These tests are what stands in for that.
 */

describe("operational dictionary", () => {
  it("offers both locales", () => {
    expect([...LOCALES]).toEqual(["it", "en"]);
  });

  /** The whole bug this fixes: bare calls used to answer Italian always. */
  it("answers in the locale it is given", () => {
    expect(t("save", "it")).toBe("Salva");
    expect(t("save", "en")).toBe("Save");
    expect(orderStatusMeta("delivered", "it").label).toBe("Consegnato");
    expect(orderStatusMeta("delivered", "en").label).toBe("Delivered");
    expect(errorMessage("ORDER_NOT_FOUND", "it")).toBe("Ordine non trovato");
    expect(errorMessage("ORDER_NOT_FOUND", "en")).toBe("Order not found");
  });

  /** Tones are design tokens; translating one would break the palette. */
  it("keeps status tones identical across locales", () => {
    for (const status of ["draft", "delivered", "cancelled", "on_hold"]) {
      expect(orderStatusMeta(status, "en").tone).toBe(orderStatusMeta(status, "it").tone);
    }
  });

  it("falls back to the raw identifier for an unknown status", () => {
    expect(orderStatusMeta("invented_status", "en").label).toBe("invented_status");
  });
});

describe("operational string map", () => {
  it("returns the source text unchanged in Italian", () => {
    expect(translate("Salva", "it")).toBe("Salva");
    expect(translate("Qualcosa di non mappato", "it")).toBe("Qualcosa di non mappato");
  });

  it("translates in English and falls back rather than showing a blank", () => {
    expect(translate("Salva", "en")).toBe("Save");
    expect(translate("Qualcosa di non mappato", "en")).toBe("Qualcosa di non mappato");
  });

  it("has no empty translations", () => {
    for (const [source, target] of Object.entries(EN_STRINGS)) {
      expect(source.trim(), `empty key for "${target}"`).not.toBe("");
      expect(target.trim(), `empty translation for "${source}"`).not.toBe("");
    }
  });

  /**
   * An entry whose translation equals its key is almost always a copy-paste
   * slip. A handful are legitimately identical in both languages.
   */
  it("has no accidental identity entries", () => {
    const SAME_IN_BOTH = new Set(["Email", "Model"]);
    const identical = Object.entries(EN_STRINGS)
      .filter(([source, target]) => source === target && !SAME_IN_BOTH.has(source))
      .map(([source]) => source);
    expect(identical).toEqual([]);
  });

  /** A duplicated key silently overrides the earlier one. */
  it("declares each source string once", () => {
    const source = readFileSync("src/lib/i18n/admin-strings.data.ts", "utf8");
    const keys = [...source.matchAll(/^\s*"((?:[^"\\]|\\.)*)":/gm)].map((m) => m[1]);
    const seen = new Set<string>();
    const duplicates = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(duplicates).toEqual([]);
  });
});
