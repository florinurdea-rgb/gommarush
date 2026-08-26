import { describe, expect, it } from "vitest";
import {
  createQuoteRequestSchema,
  listQuoteRequestsQuerySchema,
  toRpcItem,
} from "@/lib/validation/quote-request";
import { formatTyreSize } from "@/lib/types/quote-request";
import { safeFileName } from "@/lib/excel/file-name";

/**
 * The rules that decide whether a customer's request is saved correctly.
 * Cross-field validation is enforced in three places (client, Zod, database
 * CHECK constraints); these cover the Zod layer, which is the one that
 * actually guards the endpoint.
 */

const validTyre = {
  productType: "tyre" as const,
  width: 205,
  profile: 55,
  rim: 16,
  loadSpeedIndex: "91V",
  quantity: 4,
  preferenceType: "best_price" as const,
  deliverySpeed: "48h" as const,
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
    companyName: "Gomme Rossi SRL",
    email: "acquisti@gommerossi.it",
    language: "it",
    items: [validTyre],
    idempotencyKey: "key-1",
    ...overrides,
  };
}

describe("createQuoteRequestSchema", () => {
  it("accepts a well-formed tyre request", () => {
    const result = createQuoteRequestSchema.safeParse(payload());
    expect(result.success).toBe(true);
  });

  it("rejects a request with no items — an empty quote is never savable", () => {
    expect(createQuoteRequestSchema.safeParse(payload({ items: [] })).success).toBe(false);
  });

  it("rejects a tyre missing any dimension", () => {
    for (const field of ["width", "profile", "rim"]) {
      const item = { ...validTyre, [field]: null };
      expect(createQuoteRequestSchema.safeParse(payload({ items: [item] })).success).toBe(false);
    }
  });

  it("rejects an 'other' product with no description", () => {
    const item = {
      productType: "other",
      quantity: 20,
      deliverySpeed: "7d",
      preferenceType: "best_price",
    };
    expect(createQuoteRequestSchema.safeParse(payload({ items: [item] })).success).toBe(false);
  });

  it("accepts an 'other' product that has a description", () => {
    const item = {
      productType: "other",
      description: "Valvole TR414",
      quantity: 20,
      deliverySpeed: "7d",
      preferenceType: "best_price",
    };
    expect(createQuoteRequestSchema.safeParse(payload({ items: [item] })).success).toBe(true);
  });

  it("rejects a specific-brand preference with no brand named", () => {
    const item = { ...validTyre, preferenceType: "specific_brand", preferredBrand: "  " };
    expect(createQuoteRequestSchema.safeParse(payload({ items: [item] })).success).toBe(false);
  });

  it("rejects quantities below 1 — zero or negative is never a real order", () => {
    for (const quantity of [0, -3]) {
      const item = { ...validTyre, quantity };
      expect(createQuoteRequestSchema.safeParse(payload({ items: [item] })).success).toBe(false);
    }
  });

  it("requires a delivery choice", () => {
    const { deliverySpeed: _omitted, ...withoutDelivery } = validTyre;
    expect(
      createQuoteRequestSchema.safeParse(payload({ items: [withoutDelivery] })).success
    ).toBe(false);
  });

  it("requires a valid email and a company name", () => {
    expect(createQuoteRequestSchema.safeParse(payload({ email: "not-an-email" })).success).toBe(false);
    expect(createQuoteRequestSchema.safeParse(payload({ companyName: "  " })).success).toBe(false);
  });

  it("normalises the email to lowercase and trims whitespace", () => {
    const result = createQuoteRequestSchema.parse(payload({ email: "  Acquisti@GommeRossi.IT " }));
    expect(result.email).toBe("acquisti@gommerossi.it");
  });

  it("accepts international WhatsApp numbers and strips formatting", () => {
    const result = createQuoteRequestSchema.parse(payload({ whatsapp: "+39 333 123 4567" }));
    expect(result.whatsapp).toBe("+393331234567");
  });

  it("turns an empty WhatsApp string into null rather than storing \"\"", () => {
    expect(createQuoteRequestSchema.parse(payload({ whatsapp: "   " })).whatsapp).toBeNull();
  });

  it("rejects an implausible phone number", () => {
    expect(createQuoteRequestSchema.safeParse(payload({ whatsapp: "12" })).success).toBe(false);
  });

  it("defaults the language to Italian when absent", () => {
    const { language: _omitted, ...rest } = payload();
    expect(createQuoteRequestSchema.parse(rest).language).toBe("it");
  });
});

describe("toRpcItem — irrelevant values never reach the database", () => {
  it("drops a brand left behind after switching back to best price", () => {
    const parsed = createQuoteRequestSchema.parse(
      payload({
        items: [{ ...validTyre, preferenceType: "best_price", preferredBrand: "Michelin" }],
      })
    );
    expect(toRpcItem(parsed.items[0]).preferred_brand).toBeNull();
  });

  it("keeps the brand when a specific brand really was requested", () => {
    const parsed = createQuoteRequestSchema.parse(
      payload({
        items: [{ ...validTyre, preferenceType: "specific_brand", preferredBrand: "Michelin" }],
      })
    );
    expect(toRpcItem(parsed.items[0]).preferred_brand).toBe("Michelin");
  });

  it("never sends tyre dimensions for a non-tyre product", () => {
    const parsed = createQuoteRequestSchema.parse(
      payload({
        items: [
          {
            productType: "other",
            description: "Valvole TR414",
            quantity: 20,
            deliverySpeed: "7d",
            preferenceType: "best_price",
          },
        ],
      })
    );
    const rpc = toRpcItem(parsed.items[0]);
    expect(rpc.width).toBeNull();
    expect(rpc.profile).toBeNull();
    expect(rpc.rim).toBeNull();
    expect(rpc.description).toBe("Valvole TR414");
  });

  it("never sends a description for a tyre", () => {
    const parsed = createQuoteRequestSchema.parse(payload());
    expect(toRpcItem(parsed.items[0]).description).toBeNull();
  });
});

describe("formatTyreSize", () => {
  it("renders the display form from the stored numbers", () => {
    expect(formatTyreSize(205, 55, 16)).toBe("205/55 R16");
  });

  it("returns null rather than a half-built size when a dimension is missing", () => {
    expect(formatTyreSize(205, null, 16)).toBeNull();
  });
});

describe("safeFileName", () => {
  it("builds a filesystem-safe name from the company and date", () => {
    expect(safeFileName("Gomme Rossi SRL", "2026-08-25T10:12:00.000Z")).toBe(
      "Offerta_Gomme_Rossi_SRL_2026-08-25.xlsx"
    );
  });

  it("strips characters that would break a path or a header", () => {
    const name = safeFileName('A/B\\C:"*?<>|', "2026-08-25T10:12:00.000Z");
    expect(name).toBe("Offerta_A_B_C_2026-08-25.xlsx");
    expect(name).not.toMatch(/[/\\:"*?<>|]/);
  });

  it("falls back to a placeholder when the company name has nothing usable", () => {
    expect(safeFileName("///", "2026-08-25T10:12:00.000Z")).toBe(
      "Offerta_Cliente_2026-08-25.xlsx"
    );
  });
});

describe("delivery options", () => {
  /**
   * The fast option is 48 hours, and '24h' is retired. The stored value and
   * the label have to agree — a value saying one thing while the UI says
   * another is how the wrong promise reaches a customer.
   */
  it("offers exactly 48h and 7d", async () => {
    const { DELIVERY_SPEEDS, DELIVERY_LABELS } = await import("@/lib/types/quote-request");
    expect([...DELIVERY_SPEEDS]).toEqual(["48h", "7d"]);
    expect(DELIVERY_LABELS["48h"]).toBe("48 ore");
    expect(DELIVERY_LABELS["7d"]).toBe("7 giorni");
  });

  it("accepts 48h and rejects the retired 24h", () => {
    const with48 = createQuoteRequestSchema.safeParse(
      payload({ items: [{ ...validTyre, deliverySpeed: "48h" }] })
    );
    expect(with48.success).toBe(true);

    const with24 = createQuoteRequestSchema.safeParse(
      payload({ items: [{ ...validTyre, deliverySpeed: "24h" }] })
    );
    expect(with24.success).toBe(false);
  });

  it("rejects 24h on the admin list filter too", () => {
    expect(listQuoteRequestsQuerySchema.safeParse({ delivery: "48h" }).success).toBe(true);
    expect(listQuoteRequestsQuerySchema.safeParse({ delivery: "24h" }).success).toBe(false);
  });
});
