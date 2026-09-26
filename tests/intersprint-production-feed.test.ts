import { describe, expect, it } from "vitest";
import { intersprintFeedAdapter } from "@/lib/catalogue/intersprint-feed-adapter";
import { readIntersprintCsv } from "@/lib/suppliers/intersprint/feed/csv-reader";
import { authenticateFeedWorker } from "@/lib/auth/feed-worker-auth";

/**
 * The REAL production delivery format.
 *
 * Verified on the FTP VM on 2026-09-22: two semicolon-delimited CSV files,
 * `vrd-001-21185-107.csv` (PCR) and `vrd-001-21185.csv` (truck). Headers match
 * the contract M8 established from the August XLSX samples, with PCR carrying
 * `wcat` and truck not.
 *
 * The fixtures below are a handful of rows in that exact shape. The supplier's
 * live price list is not committed to this repository.
 */

const PCR_HEADER =
  "sysnr;itemcode;description;Type;brand;brand description;group;group description;" +
  "E-mark;European;width tyre;aspect ratio;diameter;LI/SI;nett-price;gross;available;" +
  "eancode;ip-code;photolink;weight;Fuel efficiency;Wet grip;Rollnoise;Noiselevel;" +
  "Snowgrip;Icegrip;EPREL-id;EPREL-url;wcat";

/** Identical but for the absent `wcat`. */
const TRUCK_HEADER = PCR_HEADER.replace(";wcat", "");

const PCR_ROW_EXACT_STOCK =
  "34197;205 55VR 16TWINTRACXL;205/55 VR16 TL 94V  VR WINTRAC XL;WINTRACXL;VR;VREDESTEIN;" +
  "13;LUXE BANDEN M&S;J;J;205;55;16;94V;99.2;143;6;8714692361425;AP20555016VWTRA02;" +
  "https://www.etyre.net/preview/t3/vr-wintrac.jpg;8.238;C;B;70;B;J;N;615687;" +
  "https://eprel.ec.europa.eu/qr/615687;1";

const PCR_ROW_BANDED_STOCK =
  "12851;145    R 10TTR10;145     R10 TL 84N  NANK TR10;TR10;NA;NANKANG;16;BESTELWAGEN BANDEN;" +
  "J;N;145;80;10;84N;66.08;0;>  20;4717622044652;EB208;" +
  "https://www.etyre.net/preview/t3/na-tr10.jpg;6.031;;;;;;;;;1";

const TRUCK_ROW =
  "26725;255 70 R225TRT500;255/70  R225TL 140N DC RT500 (ST);RT500;DC;DOUBLE COIN;41;TRUCKBANDEN;" +
  "J;N;255;70;225;140N;151.9;281;>  20;8859513010011;80201175;" +
  "https://www.etyre.net/preview/t3/dc-rt500.jpg;;;;;;;;;";

const PCR_CSV = `${PCR_HEADER}\n${PCR_ROW_EXACT_STOCK}\n${PCR_ROW_BANDED_STOCK}\n`;
const TRUCK_CSV = `${TRUCK_HEADER}\n${TRUCK_ROW}\n`;

describe("the production PCR feed", () => {
  it("parses as semicolon-delimited", () => {
    const result = readIntersprintCsv(PCR_CSV);
    expect(result.delimiter).toBe(";");
    expect(result.rows).toHaveLength(2);
  });

  it("reads the commercial columns off a real row", () => {
    const { rows } = readIntersprintCsv(PCR_CSV);
    const outcome = intersprintFeedAdapter.normalizeRow(2, rows[0].cells as Record<string, string>);
    const row = outcome.normalized;

    expect(row?.supplierListingKey).toBe("ISB:34197");
    expect(row?.purchasePrice).toBe(99.2);
    expect(row?.stockExact).toBe(6);
    expect(row?.ean).toBe("8714692361425");
    expect(row?.weightKg).toBeCloseTo(8.238, 3);
    expect(row?.eprelId).toBe("615687");
    expect(row?.brand).toBe("VREDESTEIN");
  });

  /** The band must survive the real format exactly as it did the samples. */
  it("keeps '>  20' as a minimum with no exact quantity", () => {
    const { rows } = readIntersprintCsv(PCR_CSV);
    const row = intersprintFeedAdapter.normalizeRow(
      3,
      rows[1].cells as Record<string, string>
    ).normalized;

    expect(row?.stockRaw).toBe(">  20");
    expect(row?.stockMinimum).toBe(20);
    expect(row?.stockExact).toBeNull();
    expect(row?.purchasePrice).toBe(66.08);
  });

  it("never mistakes `gross` for our cost", () => {
    const { rows } = readIntersprintCsv(PCR_CSV);
    const row = intersprintFeedAdapter.normalizeRow(
      2,
      rows[0].cells as Record<string, string>
    ).normalized;
    expect(row?.purchasePrice).toBe(99.2);
    expect(row?.purchasePrice).not.toBe(143);
  });
});

describe("the production truck feed", () => {
  it("parses without wcat", () => {
    const result = readIntersprintCsv(TRUCK_CSV);
    expect(result.headers).not.toContain("wcat");
    expect(result.rows).toHaveLength(1);
  });

  it("flags the truck rim written as tenths", () => {
    const { rows } = readIntersprintCsv(TRUCK_CSV);
    const outcome = intersprintFeedAdapter.normalizeRow(2, rows[0].cells as Record<string, string>);

    expect(outcome.normalized?.rimInch).toBe(225);
    expect(outcome.validation.reasons).toContain("RIM_LOOKS_LIKE_TENTHS");
    expect(outcome.normalized?.purchasePrice).toBe(151.9);
  });
});

describe("telling the two feeds apart", () => {
  it("uses the wcat column, not the filename", () => {
    expect(intersprintFeedAdapter.detectCategory(readIntersprintCsv(PCR_CSV).headers)).toBe("pcr");
    expect(intersprintFeedAdapter.detectCategory(readIntersprintCsv(TRUCK_CSV).headers)).toBe(
      "truck"
    );
  });

  /**
   * THE TRAP. Production ships 'vrd-001-21185.csv' (truck) and
   * 'vrd-001-21185-107.csv' (PCR). The truck name is a STRICT PREFIX of the
   * PCR name, so any startsWith/includes match on filenames classifies PCR as
   * truck — and applies a minimum release of 10 instead of 60.
   */
  it("is not fooled by filenames where one is a prefix of the other", () => {
    const truckName = "vrd-001-21185.csv";
    const pcrName = "vrd-001-21185-107.csv";

    expect(pcrName.startsWith(truckName.replace(".csv", ""))).toBe(true);

    // Content decides, and gets it right regardless.
    expect(intersprintFeedAdapter.detectCategory(readIntersprintCsv(PCR_CSV).headers)).toBe("pcr");
    expect(intersprintFeedAdapter.detectCategory(readIntersprintCsv(TRUCK_CSV).headers)).toBe(
      "truck"
    );
  });

  it("says nothing rather than guessing on an unrecognisable header", () => {
    expect(intersprintFeedAdapter.detectCategory(["a", "b"])).toBeNull();
  });
});

describe("malformed production files", () => {
  it("refuses a header that is not the Inter-Sprint contract", () => {
    expect(() => readIntersprintCsv("a;b;c\n1;2;3\n")).toThrow(/no_delimiter_matched/);
  });

  it("refuses a feed whose price column was dropped", () => {
    const header = PCR_HEADER.replace(";nett-price", "");
    expect(() => readIntersprintCsv(`${header}\n${PCR_ROW_EXACT_STOCK}\n`)).toThrow(
      /no_delimiter_matched/
    );
  });

  it("records a short row as malformed instead of importing it", () => {
    const result = readIntersprintCsv(`${PCR_HEADER}\n${PCR_ROW_EXACT_STOCK}\n34197;205;99.2\n`);
    expect(result.rows).toHaveLength(1);
    expect(result.malformedLines).toEqual([3]);
  });
});

describe("feed worker authentication", () => {
  const TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef";

  it("accepts the configured token", () => {
    expect(
      authenticateFeedWorker(`Bearer ${TOKEN}`, { FEED_WORKER_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ ok: true });
  });

  it("rejects a wrong token", () => {
    expect(
      authenticateFeedWorker("Bearer wrong", { FEED_WORKER_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects a missing or malformed header", () => {
    const env = { FEED_WORKER_TOKEN: TOKEN } as unknown as NodeJS.ProcessEnv;
    expect(authenticateFeedWorker(null, env).ok).toBe(false);
    expect(authenticateFeedWorker("", env).ok).toBe(false);
    expect(authenticateFeedWorker(TOKEN, env).ok).toBe(false);
    expect(authenticateFeedWorker(`Basic ${TOKEN}`, env).ok).toBe(false);
  });

  /**
   * An ingestion endpoint that accepts anything because nobody configured a
   * secret is worse than one that refuses everything: the first looks like it
   * is working.
   */
  it("disables itself when no token is configured", () => {
    expect(authenticateFeedWorker(`Bearer ${TOKEN}`, {} as unknown as NodeJS.ProcessEnv)).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("treats a short token as unconfigured rather than as a secret", () => {
    expect(
      authenticateFeedWorker("Bearer short", { FEED_WORKER_TOKEN: "short" } as unknown as NodeJS.ProcessEnv)
    ).toEqual({ ok: false, reason: "not_configured" });
  });
});
