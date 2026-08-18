import { describe, expect, it } from "vitest";
import { detectPaymentSignals } from "@/lib/logistics/ddt-payment";

/** Spec §39 tests F and G. */

describe("Test F — CASH AUTISTA", () => {
  it("sets cash_required = true", () => {
    const signals = detectPaymentSignals("CONSEGNA CASH AUTISTA ALLA RICEZIONE");
    expect(signals.cashRequired).toBe(true);
    expect(signals.paymentMethod).toBe("cash");
  });
});

describe("Test G — Ricevuta Bancaria 30 GG", () => {
  it("sets cash_required = false and payment_method to bank receipt", () => {
    const signals = detectPaymentSignals("Pagamento: Ricevuta Bancaria 30 GG");
    expect(signals.cashRequired).toBe(false);
    expect(signals.paymentMethod).toBe("bank_receipt");
  });
});

describe("detectPaymentSignals — never infers", () => {
  it("returns every flag false/null when the document says nothing about payment", () => {
    const signals = detectPaymentSignals("225/55 R18 94V — Michelin Primacy 4");
    expect(signals).toEqual({ cashRequired: false, chequeRequired: false, paymentMethod: null });
  });

  it("detects CONTRASSEGNO ASSEGNO as cheque_required", () => {
    const signals = detectPaymentSignals("CONTRASSEGNO ASSEGNO");
    expect(signals.chequeRequired).toBe(true);
    expect(signals.paymentMethod).toBe("cheque");
  });

  it("is case-insensitive", () => {
    expect(detectPaymentSignals("cash autista").cashRequired).toBe(true);
  });
});
