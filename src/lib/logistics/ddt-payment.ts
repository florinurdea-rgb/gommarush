/**
 * Payment-instruction detection for the DDT/invoice import system (spec
 * §6/§39 tests F–G). Rule-based and literal on purpose: "Nu deduce payment
 * dacă documentul nu îl spune." A field stays false/null unless the
 * document's own wording says so — no inference from context, amount, or
 * customer history.
 */

export interface PaymentSignals {
  cashRequired: boolean;
  chequeRequired: boolean;
  /** "cash" | "cheque" | "bank_receipt" | null — null when the document gives no explicit instruction. */
  paymentMethod: "cash" | "cheque" | "bank_receipt" | null;
}

const CASH_PATTERNS: RegExp[] = [/\bCASH\s+AUTISTA\b/i, /\bCONTANTI\b/i];
const CHEQUE_PATTERNS: RegExp[] = [/\bCONTRASSEGNO\s+ASSEGNO\b/i];
const BANK_RECEIPT_PATTERNS: RegExp[] = [/\bRICEVUTA\s+BANCARIA\b/i];

export function detectPaymentSignals(text: string): PaymentSignals {
  const cashRequired = CASH_PATTERNS.some((pattern) => pattern.test(text));
  const chequeRequired = CHEQUE_PATTERNS.some((pattern) => pattern.test(text));
  const isBankReceipt = BANK_RECEIPT_PATTERNS.some((pattern) => pattern.test(text));

  const paymentMethod = isBankReceipt ? "bank_receipt" : cashRequired ? "cash" : chequeRequired ? "cheque" : null;

  return { cashRequired, chequeRequired, paymentMethod };
}
