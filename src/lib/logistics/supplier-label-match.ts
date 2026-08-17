// Matching a scanned ORIGINAL SUPPLIER LABEL against expected order lines.
//
// This is a different operation from scanning GoRush's own barcode later:
// here nothing machine-readable is guaranteed, so the decision is a confidence
// judgement over brand / size / SKU / quantity-still-expected.
//
// Two hard rules:
//   * Only relevant expected orders are considered — today's and other active
//     deliveries first, never arbitrary history.
//   * An uncertain result is reported as uncertain. The system never invents an
//     order, and the success beep is reserved for a confident match.

import { scoreProductAgainstLine } from "@/lib/logistics/product-normalise";
import type { ItemType, OrderItemRow, StandCode } from "@/lib/types/logistics";

/** What we managed to read off the supplier's label. */
export interface ScannedLabel {
  brand?: string | null;
  model?: string | null;
  size?: string | null;
  loadIndex?: string | null;
  speedRating?: string | null;
  supplierSku?: string | null;
  supplierReference?: string | null;
  barcode?: string | null;
  /** Everything the reader saw, kept for the audit trail. */
  rawText?: string | null;
}

/** An order line still expecting physical units, with its order context. */
export interface ExpectedLine {
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  standCode: StandCode | null;
  customerName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  plannedDeliveryDate: string | null;
  itemType: ItemType;
  /** Units on this line still in 'expected' — i.e. still awaited. */
  unitsExpected: number;
  item: Pick<
    OrderItemRow,
    | "brand"
    | "supplier_sku"
    | "width"
    | "aspect_ratio"
    | "rim_diameter"
    | "load_index"
    | "speed_rating"
    | "raw_description"
    | "description"
  >;
}

export interface LabelMatchCandidate {
  line: ExpectedLine;
  score: number;
  matched: string[];
}

export type LabelMatchOutcome =
  | { kind: "confident"; candidate: LabelMatchCandidate; candidates: LabelMatchCandidate[] }
  | { kind: "uncertain"; candidates: LabelMatchCandidate[] }
  | { kind: "no_candidates"; candidates: [] };

/** At/above this a match is acted on automatically (beep + print job). */
export const CONFIDENT_MATCH_THRESHOLD = 0.6;
/** Below this a candidate isn't even worth showing in the manual list. */
export const MIN_CANDIDATE_SCORE = 0.2;
/**
 * A confident winner must also beat the runner-up by this much. Two identical
 * tyre lines on two different orders are the dangerous case: the label alone
 * cannot tell them apart, so a human must choose.
 */
export const MIN_MARGIN_OVER_RUNNER_UP = 0.15;

export interface MatchLabelOptions {
  /** Restrict to this supplier when the label identifies one. */
  supplierId?: string | null;
}

export function matchSupplierLabel(
  scanned: ScannedLabel,
  lines: readonly ExpectedLine[],
  options: MatchLabelOptions = {}
): LabelMatchOutcome {
  // Only lines that still expect something can absorb a physical unit.
  let pool = lines.filter((line) => line.unitsExpected > 0);

  // Prefer the supplier the label names, but don't hard-exclude on it: labels
  // are frequently the manufacturer's, not the distributor's.
  if (options.supplierId) {
    const sameSupplier = pool.filter((line) => line.supplierId === options.supplierId);
    if (sameSupplier.length > 0) pool = sameSupplier;
  }

  const candidates: LabelMatchCandidate[] = pool
    .map((line) => {
      const { score, matched } = scoreProductAgainstLine(
        {
          brand: scanned.brand,
          size: scanned.size,
          supplierSku: scanned.supplierSku,
          loadIndex: scanned.loadIndex,
          speedRating: scanned.speedRating,
          barcode: scanned.barcode,
        },
        line.item
      );
      return { line, score, matched };
    })
    .filter((candidate) => candidate.score >= MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { kind: "no_candidates", candidates: [] };

  const best = candidates[0];
  const runnerUp = candidates[1];

  if (best.score < CONFIDENT_MATCH_THRESHOLD) {
    return { kind: "uncertain", candidates };
  }

  // Ambiguous tie between two orders — never guess which customer's tyre this is.
  if (runnerUp && best.score - runnerUp.score < MIN_MARGIN_OVER_RUNNER_UP) {
    return { kind: "uncertain", candidates };
  }

  return { kind: "confident", candidate: best, candidates };
}

/**
 * Free-text manual search across active expected lines. Supports order number,
 * customer name, brand, model, tyre size and supplier SKU, as specified.
 */
export function searchExpectedLines(
  query: string,
  lines: readonly ExpectedLine[]
): ExpectedLine[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const tokens = needle.split(/\s+/).filter(Boolean);

  return lines
    .filter((line) => line.unitsExpected > 0)
    .map((line) => {
      const haystack = [
        line.orderNumber,
        line.customerName,
        line.supplierName,
        line.item.brand,
        line.item.description,
        line.item.raw_description,
        line.item.supplier_sku,
        line.item.width && line.item.aspect_ratio
          ? `${line.item.width}/${line.item.aspect_ratio} R${line.item.rim_diameter ?? ""}`
          : null,
        line.item.width ? String(line.item.width) : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      // Every token must appear somewhere, so "michelin 225" narrows rather
      // than widens the result set.
      const hits = tokens.filter((token) => haystack.includes(token)).length;
      return { line, hits };
    })
    .filter((entry) => entry.hits === tokens.length)
    .map((entry) => entry.line);
}
