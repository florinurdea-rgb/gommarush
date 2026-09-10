import { isPhysicalLine } from "@/lib/logistics/ddt-classification";
import type { ClassifiedLineType } from "@/lib/logistics/ddt-classification";

/**
 * The deterministic counting/revenue rules the spec insists on (§11–13):
 * "Calculul trebuie făcut în COD, nu cerut AI-ului ca sumă finală." An AI
 * extraction pass may propose a quantity per line, but the totals an order
 * is billed and audited on always come from summing already-classified
 * lines in code — never from an AI-reported total.
 */

export interface ClassifiedQuantityLine {
  lineType: ClassifiedLineType;
  quantity: number;
}

/** tyre_count = SUM(quantity WHERE item_type = TYRE) — nothing else, ever. */
export function calculateTyreCount(lines: ClassifiedQuantityLine[]): number {
  return lines
    .filter((line) => line.lineType === "TYRE")
    .reduce((sum, line) => sum + line.quantity, 0);
}

/** Every physical object transported — tyres, tubes, rims, other physical items. */
export function calculatePhysicalItemCount(lines: ClassifiedQuantityLine[]): number {
  return lines
    .filter((line) => isPhysicalLine(line.lineType))
    .reduce((sum, line) => sum + line.quantity, 0);
}

export function calculateTransportRevenue(tyreCount: number, ratePerTyre: number): number {
  // Round to cents: floating-point multiplication of two decimals can land
  // a fraction of a cent off (e.g. 5 * 2.00 is fine, but not every rate is).
  return Math.round(tyreCount * ratePerTyre * 100) / 100;
}

export type TyreCountValidationResult = "OK" | "TYRE_COUNT_REVIEW_REQUIRED";

/**
 * Cross-checks tyre_count against the document's stated package count
 * (§22). "Colli" (packages) is supporting evidence, never the source of
 * truth — a match is reassuring, a mismatch is only a problem if nothing
 * else on the document explains it (e.g. a tube shipped alongside a tyre
 * legitimately makes colli = physical_item_count, not tyre_count).
 */
export function validateTyreCount(input: {
  tyreCount: number;
  physicalItemCount: number;
  colli: number | null;
}): TyreCountValidationResult {
  if (input.colli === null) return "OK";
  if (input.colli === input.tyreCount) return "OK";
  if (input.colli === input.physicalItemCount) return "OK";
  return "TYRE_COUNT_REVIEW_REQUIRED";
}
