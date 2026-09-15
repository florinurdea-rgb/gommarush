/**
 * Operational payment status for a transport delivery.
 *
 * The single most important rule in this module: "no collection required" and
 * "already paid" are DIFFERENT FACTS and must never be conflated.
 *
 *   RIBA 30 gg FM  ->  the carrier collects nothing, and the invoice is
 *                      almost certainly NOT yet paid. The distributor will be
 *                      paid by bank draft at month end, weeks from now.
 *
 * Telling a driver "already paid" on that basis would be a false statement
 * about someone else's commercial relationship. So ALREADY_PAID_EXPLICIT is
 * reserved for documents that say so in words.
 *
 * The second rule: a document that does not settle the question resolves to
 * UNKNOWN_REVIEW_REQUIRED, which BLOCKS dispatch. A driver arriving without
 * knowing whether to take money is an operational failure; guessing is worse
 * than stopping.
 */

/** Operational payment states. Ordered from "driver acts" to "cannot dispatch". */
export const PAYMENT_OPERATIONAL_STATUSES = [
  "COLLECT_CASH",
  "COLLECT_OTHER",
  "NO_COLLECTION_REQUIRED",
  "ALREADY_PAID_EXPLICIT",
  "UNKNOWN_REVIEW_REQUIRED",
] as const;

export type PaymentOperationalStatus = (typeof PAYMENT_OPERATIONAL_STATUSES)[number];

export const PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "RIBA",
  "OTHER",
  "UNKNOWN",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Terms that prove the carrier does NOT collect, because settlement happens
 * between distributor and customer through the banking system.
 *
 * Matched case-insensitively against the document's printed payment terms.
 * Deliberately conservative: anything not listed here falls through to
 * review rather than being assumed.
 */
const NO_COLLECTION_TERMS: readonly { pattern: RegExp; method: PaymentMethod }[] = [
  // Ricevuta Bancaria - the standard Italian bank draft. Never carrier-collected.
  { pattern: /\bri\.?ba\b/i, method: "RIBA" },
  { pattern: /\bricevuta\s+bancaria\b/i, method: "RIBA" },
  { pattern: /\bbonific/i, method: "BANK_TRANSFER" },
  { pattern: /\bb\.?b\b/i, method: "BANK_TRANSFER" },
  // Deferred terms: "30 gg", "60 giorni", "fine mese", "FM", "D.F. 30"
  { pattern: /\b\d{1,3}\s*(?:gg|giorni|days?)\b/i, method: "BANK_TRANSFER" },
  { pattern: /\bfine\s+mese\b/i, method: "BANK_TRANSFER" },
  { pattern: /\bf\.?m\.?\b/i, method: "BANK_TRANSFER" },
  { pattern: /\bd\.?f\.?\s*\d/i, method: "BANK_TRANSFER" },
  { pattern: /\bsepa\b/i, method: "BANK_TRANSFER" },
  { pattern: /\brid\b/i, method: "BANK_TRANSFER" },
  // "Rimessa diretta" states HOW settlement happens, not that it has
  // happened. It is a no-collection term, never an already-paid term.
  { pattern: /\brimessa\s+diretta\b/i, method: "OTHER" },
];

/** Terms that prove the driver must collect CASH on delivery. */
const COLLECT_CASH_TERMS: readonly RegExp[] = [
  /\bcontrassegn/i,
  /\bcontr\.?\s*assegno\b/i,
  /\bc\/assegno\b/i,
  /\bpagamento\s+alla\s+consegna\b/i,
  /\bpag\.?\s*alla\s+consegna\b/i,
  /\bincasso\s+vettore\b/i,
  /\bcontanti\s+alla\s+consegna\b/i,
  /\bcontanti\s+in\s+consegna\b/i,
  /\bc\.?o\.?d\.?\b/i,
  /\bcash\s+on\s+delivery\b/i,
];

/** Terms that prove the driver collects, but by a method other than cash. */
const COLLECT_OTHER_TERMS: readonly { pattern: RegExp; method: PaymentMethod }[] = [
  { pattern: /\bassegno\s+alla\s+consegna\b/i, method: "OTHER" },
  { pattern: /\bbancomat\s+alla\s+consegna\b/i, method: "CARD" },
  { pattern: /\bpos\s+alla\s+consegna\b/i, method: "CARD" },
  { pattern: /\bcarta\s+alla\s+consegna\b/i, method: "CARD" },
];

/**
 * Terms that prove the document itself asserts settlement has ALREADY
 * happened. Note what is absent: "rimessa diretta" is not here. It means
 * "direct remittance" and says how payment will be made, not that it was.
 */
const ALREADY_PAID_TERMS: readonly RegExp[] = [
  /\bpagat[oa]\b/i,
  /\bsaldo\s+effettuato\b/i,
  /\bprepagat[oa]\b/i,
  /\bpre-?paid\b/i,
  /\bpaid\b/i,
  /\bpayment\s+received\b/i,
  /\bincassato\b/i,
];

export interface PaymentClassification {
  status: PaymentOperationalStatus;
  /** Whether the driver has to take money. null only when status is UNKNOWN. */
  mustDriverCollect: boolean | null;
  method: PaymentMethod;
  /** The exact substring that decided this, kept for the operator and the audit trail. */
  evidence: string | null;
  /** Human-readable reason, for the review screen. */
  reason: string;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[0] : null;
}

/**
 * Classifies printed payment terms deterministically.
 *
 * This runs in application code, NOT in the model. The model reports what the
 * document printed; this function decides what it means operationally. That
 * split is deliberate -- a payment misclassification costs real money, so the
 * rule has to be inspectable, testable and identical on every run.
 *
 * Precedence is ordered by how much a wrong answer costs:
 *   1. explicit cash collection   (driver must take money -- most costly to miss)
 *   2. explicit other collection
 *   3. explicit already-paid
 *   4. deferred/bank terms        (driver takes nothing)
 *   5. everything else            -> review
 */
export function classifyPaymentTerms(printedTerms: string | null | undefined): PaymentClassification {
  const text = (printedTerms ?? "").trim();

  if (!text) {
    return {
      status: "UNKNOWN_REVIEW_REQUIRED",
      mustDriverCollect: null,
      method: "UNKNOWN",
      evidence: null,
      reason: "Il documento non riporta condizioni di pagamento.",
    };
  }

  for (const pattern of COLLECT_CASH_TERMS) {
    const evidence = firstMatch(text, pattern);
    if (evidence) {
      return {
        status: "COLLECT_CASH",
        mustDriverCollect: true,
        method: "CASH",
        evidence,
        reason: "Il documento richiede esplicitamente l'incasso in contanti alla consegna.",
      };
    }
  }

  for (const { pattern, method } of COLLECT_OTHER_TERMS) {
    const evidence = firstMatch(text, pattern);
    if (evidence) {
      return {
        status: "COLLECT_OTHER",
        mustDriverCollect: true,
        method,
        evidence,
        reason: "Il documento richiede l'incasso alla consegna con un metodo diverso dai contanti.",
      };
    }
  }

  for (const pattern of ALREADY_PAID_TERMS) {
    const evidence = firstMatch(text, pattern);
    if (evidence) {
      return {
        status: "ALREADY_PAID_EXPLICIT",
        mustDriverCollect: false,
        method: "UNKNOWN",
        evidence,
        reason: "Il documento dichiara esplicitamente che il pagamento e' stato effettuato.",
      };
    }
  }

  for (const { pattern, method } of NO_COLLECTION_TERMS) {
    const evidence = firstMatch(text, pattern);
    if (evidence) {
      return {
        status: "NO_COLLECTION_REQUIRED",
        mustDriverCollect: false,
        method,
        // Deliberate wording: the carrier collects nothing. It does NOT say paid.
        evidence: text,
        reason: `Condizioni di pagamento "${text}": il pagamento avviene tra fornitore e cliente, il vettore non incassa.`,
      };
    }
  }

  return {
    status: "UNKNOWN_REVIEW_REQUIRED",
    mustDriverCollect: null,
    method: "UNKNOWN",
    evidence: text,
    reason: `Condizioni di pagamento "${text}" non riconosciute: l'operatore deve confermare se l'autista deve incassare.`,
  };
}

/** Does this status permit the job to be dispatched to a driver? */
export function isDispatchable(status: PaymentOperationalStatus): boolean {
  return status !== "UNKNOWN_REVIEW_REQUIRED";
}

/** Does this status require the driver to record a collection outcome? */
export function requiresDriverCollection(status: PaymentOperationalStatus): boolean {
  return status === "COLLECT_CASH" || status === "COLLECT_OTHER";
}

export interface AmountConsistencyIssue {
  code:
    | "COD_AMOUNT_MISSING"
    | "COD_AMOUNT_NOT_POSITIVE"
    | "NO_COLLECTION_BUT_AMOUNT_SET"
    | "PAYMENT_STATUS_UNRESOLVED";
  message: string;
}

/**
 * Enforces the amount/status consistency rules.
 *
 * `amountToCollectCents` is integer cents, and THREE states are distinct:
 *
 *   a number > 0  -- collect exactly this
 *   0             -- a known, deliberate zero collection
 *   null          -- collection is not applicable, or not specified
 *
 * Keeping 0 and null apart is what makes the data honest. "The carrier
 * collects nothing because settlement is by bank draft" is not the same fact
 * as "the carrier collects a zero amount", and storing the first as 0 would
 * assert a collection event that never existed. On a COD document a null is a
 * blocking problem, because the driver would otherwise have to invent the
 * figure at the customer's counter.
 */
export function checkAmountConsistency(input: {
  status: PaymentOperationalStatus;
  amountToCollectCents: number | null;
}): AmountConsistencyIssue[] {
  const { status, amountToCollectCents } = input;
  const issues: AmountConsistencyIssue[] = [];

  if (status === "UNKNOWN_REVIEW_REQUIRED") {
    issues.push({
      code: "PAYMENT_STATUS_UNRESOLVED",
      message: "Stato del pagamento da verificare: selezionare l'opzione corretta prima di confermare.",
    });
    return issues;
  }

  if (requiresDriverCollection(status)) {
    if (amountToCollectCents === null) {
      issues.push({
        code: "COD_AMOUNT_MISSING",
        message: "Incasso richiesto ma l'importo non e' indicato nel documento: inserire l'importo da riscuotere.",
      });
    } else if (amountToCollectCents <= 0) {
      issues.push({
        code: "COD_AMOUNT_NOT_POSITIVE",
        message: "Incasso richiesto ma l'importo non e' positivo.",
      });
    }
    return issues;
  }

  // NO_COLLECTION_REQUIRED or ALREADY_PAID_EXPLICIT: collection does not
  // apply, so the amount must be null. A 0 here would claim a zero-value
  // collection took place, which is a different and untrue statement.
  if (amountToCollectCents !== null) {
    issues.push({
      code: "NO_COLLECTION_BUT_AMOUNT_SET",
      message: "Nessun incasso previsto: l'importo da riscuotere deve restare vuoto.",
    });
  }

  return issues;
}

/**
 * Normalises the amount for storage once the status is settled.
 *
 * Only a collecting status carries a figure. Everything else stores null,
 * which is why a document total like "TOTALE IMPONIBILE 63,74" cannot survive
 * into a driver's collection instruction: on a non-collecting document the
 * value is discarded here regardless of what the model returned.
 */
export function amountForStorage(input: {
  status: PaymentOperationalStatus;
  amountToCollectCents: number | null;
}): number | null {
  return requiresDriverCollection(input.status) ? input.amountToCollectCents : null;
}
