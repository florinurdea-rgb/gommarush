import { describe, expect, it } from "vitest";
import {
  amountForStorage,
  checkAmountConsistency,
  classifyPaymentTerms,
  isDispatchable,
  requiresDriverCollection,
} from "@/lib/transport/payment";

/**
 * The payment classifier is the highest-consequence pure function in the
 * transport intake: a wrong answer either sends a driver to collect money
 * that was never owed, or sends them away without collecting money that was.
 */

describe("classifyPaymentTerms - the Zuin acceptance case", () => {
  it("reads 'RIBA 30 gg FM' as no collection, NOT as already paid", () => {
    const result = classifyPaymentTerms("RIBA 30 gg FM");

    expect(result.status).toBe("NO_COLLECTION_REQUIRED");
    expect(result.mustDriverCollect).toBe(false);
    expect(result.method).toBe("RIBA");
    expect(result.evidence).toBe("RIBA 30 gg FM");
  });

  it("stores null for the Zuin case, because collection does not apply", () => {
    // Not 0: a zero would assert a zero-value collection event. Nothing is
    // collected here at all -- settlement is by bank draft weeks later.
    const { status } = classifyPaymentTerms("RIBA 30 gg FM");
    expect(amountForStorage({ status, amountToCollectCents: null })).toBeNull();
  });

  it("discards a document total rather than storing it", () => {
    const { status } = classifyPaymentTerms("RIBA 30 gg FM");
    // 63,74 is the taxable total on the real document.
    expect(amountForStorage({ status, amountToCollectCents: 6374 })).toBeNull();
  });

  it("does not claim the invoice is paid", () => {
    const result = classifyPaymentTerms("RIBA 30 gg FM");
    // The distinction the whole module exists to protect.
    expect(result.status).not.toBe("ALREADY_PAID_EXPLICIT");
  });
});

describe("classifyPaymentTerms - explicit cash collection", () => {
  const cashTerms = [
    "CONTRASSEGNO",
    "contrassegno contanti",
    "Pagamento alla consegna",
    "INCASSO VETTORE",
    "contanti alla consegna",
    "COD",
    "Cash on delivery",
  ];

  for (const term of cashTerms) {
    it(`treats "${term}" as COLLECT_CASH`, () => {
      const result = classifyPaymentTerms(term);
      expect(result.status).toBe("COLLECT_CASH");
      expect(result.mustDriverCollect).toBe(true);
      expect(result.method).toBe("CASH");
    });
  }

  it("prefers cash collection over a deferred term on the same document", () => {
    // A document can print both; collection instruction wins, because missing
    // it is the more expensive error.
    const result = classifyPaymentTerms("CONTRASSEGNO - 30 gg");
    expect(result.status).toBe("COLLECT_CASH");
  });
});

describe("classifyPaymentTerms - no collection required", () => {
  const noCollectionTerms: readonly [string, string][] = [
    ["RIBA", "RIBA"],
    ["Ricevuta Bancaria 60 gg", "RIBA"],
    ["BONIFICO BANCARIO", "BANK_TRANSFER"],
    ["30 gg", "BANK_TRANSFER"],
    ["60 giorni", "BANK_TRANSFER"],
    ["fine mese", "BANK_TRANSFER"],
    ["rimessa diretta", "OTHER"],
  ];

  for (const [term, method] of noCollectionTerms) {
    it(`treats "${term}" as NO_COLLECTION_REQUIRED (${method})`, () => {
      const result = classifyPaymentTerms(term);
      expect(result.status).toBe("NO_COLLECTION_REQUIRED");
      expect(result.mustDriverCollect).toBe(false);
      expect(result.method).toBe(method);
    });
  }

  it("does not match a bare letter b as a bank transfer", () => {
    // Regression: the BB pattern had both the dot and the second b optional,
    // so a lone "b" anywhere in the terms matched.
    const result = classifyPaymentTerms("vedi nota b");
    expect(result.status).toBe("UNKNOWN_REVIEW_REQUIRED");
  });
});

describe("classifyPaymentTerms - already paid", () => {
  for (const term of ["PAGATO", "Saldo effettuato", "PREPAGATO", "paid", "payment received"]) {
    it(`treats "${term}" as ALREADY_PAID_EXPLICIT`, () => {
      const result = classifyPaymentTerms(term);
      expect(result.status).toBe("ALREADY_PAID_EXPLICIT");
      expect(result.mustDriverCollect).toBe(false);
      expect(result.evidence).toBeTruthy();
    });
  }
});

describe("classifyPaymentTerms - unknown blocks dispatch", () => {
  it("returns review-required for empty terms", () => {
    const result = classifyPaymentTerms("");
    expect(result.status).toBe("UNKNOWN_REVIEW_REQUIRED");
    expect(result.mustDriverCollect).toBeNull();
  });

  it("returns review-required for null terms", () => {
    expect(classifyPaymentTerms(null).status).toBe("UNKNOWN_REVIEW_REQUIRED");
  });

  it("returns review-required for unrecognised wording", () => {
    const result = classifyPaymentTerms("come da accordi");
    expect(result.status).toBe("UNKNOWN_REVIEW_REQUIRED");
    expect(result.mustDriverCollect).toBeNull();
  });

  it("is not dispatchable while unresolved", () => {
    expect(isDispatchable("UNKNOWN_REVIEW_REQUIRED")).toBe(false);
    expect(isDispatchable("NO_COLLECTION_REQUIRED")).toBe(true);
    expect(isDispatchable("COLLECT_CASH")).toBe(true);
  });

  it("stores a null amount while unresolved, so no figure is implied", () => {
    expect(amountForStorage({ status: "UNKNOWN_REVIEW_REQUIRED", amountToCollectCents: null })).toBeNull();
  });
});

describe("requiresDriverCollection", () => {
  it("is true only for the two collecting statuses", () => {
    expect(requiresDriverCollection("COLLECT_CASH")).toBe(true);
    expect(requiresDriverCollection("COLLECT_OTHER")).toBe(true);
    expect(requiresDriverCollection("NO_COLLECTION_REQUIRED")).toBe(false);
    expect(requiresDriverCollection("ALREADY_PAID_EXPLICIT")).toBe(false);
    expect(requiresDriverCollection("UNKNOWN_REVIEW_REQUIRED")).toBe(false);
  });
});

describe("checkAmountConsistency", () => {
  it("blocks COD with no amount stated", () => {
    const issues = checkAmountConsistency({ status: "COLLECT_CASH", amountToCollectCents: null });
    expect(issues.map((i) => i.code)).toContain("COD_AMOUNT_MISSING");
  });

  it("blocks COD with a zero amount", () => {
    const issues = checkAmountConsistency({ status: "COLLECT_CASH", amountToCollectCents: 0 });
    expect(issues.map((i) => i.code)).toContain("COD_AMOUNT_NOT_POSITIVE");
  });

  it("accepts COD with a positive amount", () => {
    expect(checkAmountConsistency({ status: "COLLECT_CASH", amountToCollectCents: 6374 })).toEqual([]);
  });

  it("blocks any amount when nothing is collected", () => {
    // This is the Zuin failure mode: 63,74 leaking in as a COD amount.
    const issues = checkAmountConsistency({
      status: "NO_COLLECTION_REQUIRED",
      amountToCollectCents: 6374,
    });
    expect(issues.map((i) => i.code)).toContain("NO_COLLECTION_BUT_AMOUNT_SET");
  });

  it("rejects zero when nothing is collected, because zero means a real zero collection", () => {
    // 0 and null carry different claims. 0 asserts "we collected nothing on a
    // collection that applied"; null says collection never applied.
    expect(
      checkAmountConsistency({ status: "NO_COLLECTION_REQUIRED", amountToCollectCents: 0 }).map((i) => i.code)
    ).toContain("NO_COLLECTION_BUT_AMOUNT_SET");
  });

  it("accepts null when nothing is collected", () => {
    expect(checkAmountConsistency({ status: "NO_COLLECTION_REQUIRED", amountToCollectCents: null })).toEqual([]);
    expect(checkAmountConsistency({ status: "ALREADY_PAID_EXPLICIT", amountToCollectCents: null })).toEqual([]);
  });

  it("always blocks while the status is unresolved", () => {
    const issues = checkAmountConsistency({ status: "UNKNOWN_REVIEW_REQUIRED", amountToCollectCents: 0 });
    expect(issues.map((i) => i.code)).toEqual(["PAYMENT_STATUS_UNRESOLVED"]);
  });
});
