// Decimal-safe money for supplier documents.
//
// Money is INTEGER CENTS throughout. Not a convention — a correctness
// requirement. `0.1 + 0.2 !== 0.3` in IEEE-754, and a document whose lines
// sum to a hundredth of a cent off its stated total would either fail
// reconciliation for no reason or, worse, pass a tolerance wide enough to
// hide a real error.
//
// Italian commercial documents print "1.234,56": dot for thousands, comma
// for decimals. Anglo documents print "1,234.56". The same eight characters
// mean different numbers, so separator detection is explicit rather than
// guessed by regex replacement.
//
// Pure and dependency-free.

/** Money as an integer number of cents. Never a float. */
export type Cents = number;

export interface ParsedAmount {
  cents: Cents | null;
  /** Exactly as printed on the document, kept for audit. */
  raw: string | null;
  /** Why parsing refused. Null on success. */
  reason: string | null;
}

const NOT_A_NUMBER: ParsedAmount = { cents: null, raw: null, reason: "EMPTY" };

/**
 * Parses a printed amount into cents.
 *
 * Separator resolution, in order:
 *   1. Both ',' and '.' present -> whichever occurs LAST is the decimal
 *      separator. "1.234,56" -> comma decimal; "1,234.56" -> dot decimal.
 *   2. Only one separator present, with exactly 3 digits after it and more
 *      than one group -> a thousands separator ("1.234" is 1234, not 1.234).
 *      This is the genuinely ambiguous case and the rule is documented
 *      rather than inferred.
 *   3. Only one separator, 1 or 2 digits after -> decimal separator.
 *
 * Refuses anything with more than 2 decimal places rather than rounding
 * silently: a supplier printing 3 decimals means something we do not
 * understand, and quietly dropping a digit is how a price becomes wrong.
 */
export function parseAmount(input: string | number | null | undefined): ParsedAmount {
  if (input === null || input === undefined) return NOT_A_NUMBER;

  if (typeof input === "number") {
    if (!Number.isFinite(input)) return { cents: null, raw: String(input), reason: "NOT_FINITE" };
    // A JSON number reached us already floating. Round at the cent, which is
    // the only place a float can be trusted to land.
    return { cents: Math.round(input * 100), raw: String(input), reason: null };
  }

  const raw = input.trim();
  if (!raw) return NOT_A_NUMBER;

  // Strip currency symbols, spaces and non-breaking spaces; keep sign.
  const cleaned = raw.replace(/[€$£\s  ]/g, "");
  if (!/^[+-]?[\d.,]+$/.test(cleaned)) {
    return { cents: null, raw, reason: "UNSUPPORTED_CHARACTERS" };
  }

  const negative = cleaned.startsWith("-");
  const digitsOnly = cleaned.replace(/^[+-]/, "");

  const lastComma = digitsOnly.lastIndexOf(",");
  const lastDot = digitsOnly.lastIndexOf(".");

  let integerPart: string;
  let fractionPart: string;

  if (lastComma !== -1 && lastDot !== -1) {
    const decimalAt = Math.max(lastComma, lastDot);
    integerPart = digitsOnly.slice(0, decimalAt).replace(/[.,]/g, "");
    fractionPart = digitsOnly.slice(decimalAt + 1);
  } else if (lastComma === -1 && lastDot === -1) {
    integerPart = digitsOnly;
    fractionPart = "";
  } else {
    const separatorAt = lastComma !== -1 ? lastComma : lastDot;
    const separator = lastComma !== -1 ? "," : ".";
    const after = digitsOnly.slice(separatorAt + 1);
    const groups = digitsOnly.split(separator);

    if (after.length === 3 && groups.length > 1 && groups[0].length <= 3) {
      // Thousands separator: "1.234", "12,345".
      integerPart = digitsOnly.replace(/[.,]/g, "");
      fractionPart = "";
    } else {
      integerPart = digitsOnly.slice(0, separatorAt).replace(/[.,]/g, "");
      fractionPart = after;
    }
  }

  if (/[.,]/.test(fractionPart)) return { cents: null, raw, reason: "MALFORMED" };
  if (fractionPart.length > 2) return { cents: null, raw, reason: "TOO_MANY_DECIMALS" };
  if (integerPart === "" && fractionPart === "") return { cents: null, raw, reason: "EMPTY" };

  const whole = integerPart === "" ? 0 : Number(integerPart);
  const frac = fractionPart === "" ? 0 : Number(fractionPart.padEnd(2, "0"));
  if (!Number.isSafeInteger(whole) || !Number.isFinite(frac)) {
    return { cents: null, raw, reason: "OUT_OF_RANGE" };
  }

  const cents = whole * 100 + frac;
  return { cents: negative ? -cents : cents, raw, reason: null };
}

/** Cents back to a display string. Used for UI and audit records only. */
export function formatCents(cents: Cents, currency = "EUR"): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const body = `${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  return `${negative ? "-" : ""}${body} ${currency}`;
}

/**
 * quantity x unitPrice, in cents, rounded half-up at the cent.
 *
 * Half-up rather than JavaScript's Math.round (which is half-up only for
 * positives) so a credit line rounds the same magnitude as a debit line.
 */
export function multiplyCents(unitCents: Cents, quantity: number): Cents {
  const exact = unitCents * quantity;
  return exact < 0 ? -Math.round(Math.abs(exact)) : Math.round(exact);
}

/** Applies a percentage discount to cents. `10` means 10%. */
export function applyPercent(cents: Cents, percent: number): Cents {
  const exact = (cents * percent) / 100;
  return exact < 0 ? -Math.round(Math.abs(exact)) : Math.round(exact);
}

export function sumCents(values: readonly (Cents | null | undefined)[]): Cents {
  return values.reduce<Cents>((total, value) => total + (value ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Tolerance for comparing a computed total against the document's stated one.
 *
 * 2 cents, not 0. Suppliers legitimately round each line before summing while
 * we sum then round, and the two differ by a cent per line on a long
 * document. Wider than this stops being rounding and starts hiding errors.
 */
export const RECONCILE_TOLERANCE_CENTS = 2;

export type ReconcileStatus = "OK" | "MISMATCH" | "NOT_CHECKABLE";

export interface ReconcileIssue {
  field: string;
  expectedCents: Cents;
  statedCents: Cents;
  deltaCents: Cents;
}

export interface LineForReconcile {
  quantity: number | null;
  unitPriceCents: Cents | null;
  discountPercent: number | null;
  lineTotalCents: Cents | null;
}

export interface DocumentTotalsForReconcile {
  subtotalCents: Cents | null;
  discountTotalCents: Cents | null;
  taxableTotalCents: Cents | null;
  vatTotalCents: Cents | null;
  documentTotalCents: Cents | null;
  /** PFU, logistics, transport — charges that sit outside the line subtotal. */
  chargeCents: readonly Cents[];
}

export interface ReconcileResult {
  status: ReconcileStatus;
  issues: ReconcileIssue[];
  computedSubtotalCents: Cents;
  computedChargeCents: Cents;
  /** Lines whose own arithmetic does not hold. Indexes into the input. */
  inconsistentLineIndexes: number[];
  /** Lines that could not be checked because a field was unreadable. */
  uncheckableLineIndexes: number[];
}

/**
 * Deterministic financial reconciliation.
 *
 * Returns NOT_CHECKABLE rather than OK when the document gives nothing to
 * check against. That distinction matters: "we verified this" and "there was
 * nothing to verify" must not be the same answer, or an unreadable document
 * would look as trustworthy as a verified one.
 */
export function reconcileDocument(
  lines: readonly LineForReconcile[],
  totals: DocumentTotalsForReconcile
): ReconcileResult {
  const issues: ReconcileIssue[] = [];
  const inconsistentLineIndexes: number[] = [];
  const uncheckableLineIndexes: number[] = [];

  let computedSubtotal = 0;

  lines.forEach((line, index) => {
    const { quantity, unitPriceCents, discountPercent, lineTotalCents } = line;

    if (quantity === null || unitPriceCents === null) {
      // Cannot verify. If the document stated a total, it still counts toward
      // the subtotal — dropping it would make the subtotal wrong in the safe-
      // looking direction.
      if (lineTotalCents !== null) computedSubtotal += lineTotalCents;
      else uncheckableLineIndexes.push(index);
      return;
    }

    const gross = multiplyCents(unitPriceCents, quantity);
    const discounted = discountPercent ? gross - applyPercent(gross, discountPercent) : gross;
    computedSubtotal += lineTotalCents ?? discounted;

    if (lineTotalCents !== null && Math.abs(discounted - lineTotalCents) > RECONCILE_TOLERANCE_CENTS) {
      inconsistentLineIndexes.push(index);
      issues.push({
        field: `line[${index}].lineTotal`,
        expectedCents: discounted,
        statedCents: lineTotalCents,
        deltaCents: lineTotalCents - discounted,
      });
    }
  });

  const computedCharges = sumCents(totals.chargeCents);

  if (totals.subtotalCents !== null) {
    const delta = totals.subtotalCents - computedSubtotal;
    if (Math.abs(delta) > RECONCILE_TOLERANCE_CENTS) {
      issues.push({
        field: "subtotal",
        expectedCents: computedSubtotal,
        statedCents: totals.subtotalCents,
        deltaCents: delta,
      });
    }
  }

  // Document total = taxable + VAT, when both are stated. Charges are already
  // inside the taxable base on every layout seen so far, so they are not
  // added again here — doing so double-counted PFU.
  if (totals.documentTotalCents !== null && totals.taxableTotalCents !== null && totals.vatTotalCents !== null) {
    const expected = totals.taxableTotalCents + totals.vatTotalCents;
    const delta = totals.documentTotalCents - expected;
    if (Math.abs(delta) > RECONCILE_TOLERANCE_CENTS) {
      issues.push({
        field: "documentTotal",
        expectedCents: expected,
        statedCents: totals.documentTotalCents,
        deltaCents: delta,
      });
    }
  }

  const hadSomethingToCheck =
    totals.subtotalCents !== null ||
    totals.documentTotalCents !== null ||
    lines.some((line) => line.lineTotalCents !== null && line.quantity !== null && line.unitPriceCents !== null);

  if (!hadSomethingToCheck) {
    return {
      status: "NOT_CHECKABLE",
      issues: [],
      computedSubtotalCents: computedSubtotal,
      computedChargeCents: computedCharges,
      inconsistentLineIndexes,
      uncheckableLineIndexes,
    };
  }

  return {
    status: issues.length > 0 ? "MISMATCH" : "OK",
    issues,
    computedSubtotalCents: computedSubtotal,
    computedChargeCents: computedCharges,
    inconsistentLineIndexes,
    uncheckableLineIndexes,
  };
}
