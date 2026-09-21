/**
 * EAN / GTIN identity. Deterministic, no AI, no guessing.
 *
 * EAN is the strongest cross-supplier product bridge
 * (docs/architecture/01_SUPPLIER_ARCHITECTURE.md), so it must be validated
 * rather than trusted. A code that fails its check digit is NOT silently
 * accepted: it is reported as invalid so the row stays provisional.
 */

import type { EanStatus } from "./types";

/** Digits only. Spreadsheet exports carry spaces, dashes and NBSPs. */
export function stripNonDigits(raw: string): string {
  return raw.replace(/\D+/g, "");
}

/**
 * GS1 mod-10 check digit over the payload (all digits except the last).
 * Weights alternate 3,1,3,1… counting RIGHT to LEFT from the payload's end,
 * which is what makes the same routine valid for GTIN-8/12/13/14.
 */
export function gs1CheckDigit(payloadDigits: string): number {
  let sum = 0;
  for (let i = payloadDigits.length - 1, mult = 3; i >= 0; i--, mult = mult === 3 ? 1 : 3) {
    sum += Number(payloadDigits[i]) * mult;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (![8, 12, 13, 14].includes(code.length)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

export interface EanResolution {
  /** Normalized value, or null when nothing trustworthy could be derived. */
  ean: string | null;
  status: EanStatus;
  /** Machine-readable reasons, mirroring production's review_reasons vocabulary. */
  reasons: string[];
}

/**
 * Resolve a raw supplier EAN field.
 *
 * Spreadsheet exports routinely drop leading zeros (a numeric cell turns
 * "0291429282870" into "291429282870"). We therefore retry a short code with
 * leading zeros restored, but ONLY accept the result if the check digit then
 * validates — recovery never invents an identity, it only restores one that
 * verifies. Production records this outcome as `recovered_leading_zero`.
 */
export function resolveEan(rawValue: unknown): EanResolution {
  if (rawValue === null || rawValue === undefined) {
    return { ean: null, status: "missing", reasons: ["EAN_MISSING"] };
  }
  const digits = stripNonDigits(String(rawValue).trim());
  if (digits.length === 0 || /^0+$/.test(digits)) {
    return { ean: null, status: "missing", reasons: ["EAN_MISSING"] };
  }

  if (isValidGtin(digits)) {
    return { ean: digits, status: "valid", reasons: [] };
  }

  // Leading-zero recovery, shortest padding first.
  for (const target of [8, 12, 13, 14]) {
    if (digits.length >= target) continue;
    const padded = digits.padStart(target, "0");
    if (isValidGtin(padded)) {
      return {
        ean: padded,
        status: "recovered_leading_zero",
        reasons: ["EAN_LEADING_ZERO_RECOVERED"],
      };
    }
  }

  return {
    ean: null,
    status: "invalid_check_digit",
    reasons: ["EAN_INVALID:CHECK_DIGIT_MISMATCH"],
  };
}

/** Only these statuses may be trusted for identity or barcode scanning. */
export function isTrustworthyEan(status: EanStatus): boolean {
  return status === "valid" || status === "recovered_leading_zero";
}

/**
 * Identity key for a supplier row.
 *
 * `GTIN:<ean>` when the EAN is trustworthy — that is what lets two suppliers
 * converge on one catalogue product. Otherwise a PROVISIONAL lane-scoped key,
 * so a row with no verifiable identity can never collide with, or silently
 * merge into, another supplier's product.
 */
export function deriveProductKey(args: {
  ean: string | null;
  eanStatus: EanStatus;
  lanePrefix: string;
  supplierArticleId: string;
}): { productKey: string; provisional: boolean } {
  if (args.ean && isTrustworthyEan(args.eanStatus)) {
    return { productKey: `GTIN:${args.ean}`, provisional: false };
  }
  return {
    productKey: `${args.lanePrefix}:${args.supplierArticleId}`,
    provisional: true,
  };
}
