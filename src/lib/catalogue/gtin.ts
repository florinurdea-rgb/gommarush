// GS1 identifier validation.
//
// An EAN is not a number. '0012345678905' and 12345678905 are the same
// integer and different barcodes, so every value here is text from end to
// end and leading zeros are load-bearing.
//
// The one rule this module exists to enforce: a digit is never invented.
// Recovery is limited to prepending zeros — which is what a spreadsheet
// strips when it coerces a barcode to a number — and the result is accepted
// only if its GS1 check digit validates. Nothing else is repaired, ever.
//
// Pure and dependency-free.

export type GtinStatus = "valid" | "recovered_leading_zero" | "invalid_check_digit" | "missing";

export interface GtinResult {
  status: GtinStatus;
  /** Exactly what the source supplied, trimmed. Never rewritten. */
  raw: string | null;
  /** Canonical digits. Null unless the value validated. */
  normalized: string | null;
  /** Why it was rejected. Never a guess at what the value should have been. */
  reason: string | null;
}

/** GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13), GTIN-14. */
export const SUPPORTED_GTIN_LENGTHS = [8, 12, 13, 14] as const;

/**
 * Separators a supplier may legitimately use to space a barcode. Deliberately
 * short: a dot is NOT included, because a dot in a barcode field almost always
 * means the value already went through a numeric coercion, and silently
 * dropping it would turn a corrupted value into a plausible one.
 */
const FORMATTING = /[\s \-‐-―]/g;

/**
 * The GS1 check digit for a body (the code without its final digit).
 * Weights alternate 3,1 leftwards from the rightmost body digit.
 */
export function gtinCheckDigit(body: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

/** True only for an all-digit value of a supported length whose check digit agrees. */
export function isValidGtin(value: string): boolean {
  if (!/^[0-9]+$/.test(value)) return false;
  if (!(SUPPORTED_GTIN_LENGTHS as readonly number[]).includes(value.length)) return false;
  return gtinCheckDigit(value.slice(0, -1)) === Number(value[value.length - 1]);
}

/**
 * The canonical form used for identifier lookup and storage.
 *
 * Leading zeros are preserved, so this is the value the warehouse scanner
 * matches against. A GTIN-12 is NOT expanded to its 14-digit form: the
 * shortest validating representation is the canonical one, and the reader
 * and the scanner agree on it because both come through here.
 */
export function normalizeIdentifierValue(raw: string): string {
  return raw.replace(FORMATTING, "").toUpperCase();
}

/**
 * Validates a supplier-supplied barcode.
 *
 * Recovery, when it happens, prepends zeros to reach the smallest supported
 * length above the input's own — and only that one candidate is tried.
 * Padding further is pointless rather than dangerous: a leading zero
 * contributes nothing to the weighted sum, so if the 12-digit candidate
 * fails, the 13- and 14-digit ones fail identically. One attempt is the
 * whole search space.
 */
export function validateGtin(raw: string | null | undefined): GtinResult {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    return { status: "missing", raw: null, normalized: null, reason: null };
  }

  const cleaned = normalizeIdentifierValue(trimmed);
  if (!cleaned) {
    return { status: "missing", raw: trimmed, normalized: null, reason: null };
  }

  if (!/^[0-9]+$/.test(cleaned)) {
    return {
      status: "invalid_check_digit",
      raw: trimmed,
      normalized: null,
      reason: "UNSUPPORTED_CHARACTERS",
    };
  }

  const maxLength = SUPPORTED_GTIN_LENGTHS[SUPPORTED_GTIN_LENGTHS.length - 1];
  if (cleaned.length > maxLength) {
    return { status: "invalid_check_digit", raw: trimmed, normalized: null, reason: "TOO_LONG" };
  }

  if ((SUPPORTED_GTIN_LENGTHS as readonly number[]).includes(cleaned.length)) {
    if (isValidGtin(cleaned)) {
      return { status: "valid", raw: trimmed, normalized: cleaned, reason: null };
    }
    // A supported length that fails is simply wrong. Padding it cannot help,
    // for the reason given above, so no recovery is attempted.
    return {
      status: "invalid_check_digit",
      raw: trimmed,
      normalized: null,
      reason: "CHECK_DIGIT_MISMATCH",
    };
  }

  const target = SUPPORTED_GTIN_LENGTHS.find((length) => length > cleaned.length);
  if (target !== undefined) {
    const candidate = cleaned.padStart(target, "0");
    if (isValidGtin(candidate)) {
      return {
        status: "recovered_leading_zero",
        raw: trimmed,
        normalized: candidate,
        reason: null,
      };
    }
  }

  return {
    status: "invalid_check_digit",
    raw: trimmed,
    normalized: null,
    reason: "UNSUPPORTED_LENGTH",
  };
}

/** Whether a validated status may be trusted for warehouse barcode matching. */
export function isScannable(status: GtinStatus): boolean {
  return status === "valid" || status === "recovered_leading_zero";
}
