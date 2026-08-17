import { NextRequest } from "next/server";
import { supplierLabelScanSchema } from "@/lib/validation/logistics";
import { matchScannedLabel, receiveUnitForOrderItem } from "@/lib/server/receiving";
import { CONFIDENT_MATCH_THRESHOLD } from "@/lib/logistics/supplier-label-match";
import { fail, ok, readJsonBody, runDriverRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

/**
 * POST /api/driver/scan-label — the ORIGINAL SUPPLIER LABEL scan.
 *
 * This is a different operation from scanning GoRush's own barcode later:
 * nothing machine-readable is guaranteed here, so the outcome is a confidence
 * judgement. Two paths:
 *
 *   order_item_id given  -> the operator picked the line manually; record it as
 *                           a manual association.
 *   otherwise            -> match against ACTIVE expected orders only. A
 *                           confident match is acted on; an uncertain one is
 *                           returned as uncertain with candidates, and NO order
 *                           is invented and no success beep is earned.
 */
export async function POST(request: NextRequest) {
  return runDriverRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = supplierLabelScanSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));
    const { label, idempotency_key, order_item_id, manual, reason } = parsed.data;

    const operator = `driver:${session.driverName}`;

    // --- Operator-confirmed association ---------------------------------
    if (order_item_id) {
      const result = await receiveUnitForOrderItem({
        orderItemId: order_item_id,
        rawValue: label.rawText ?? label.barcode ?? null,
        operator,
        manual: true,
        reason: reason ?? "manual_selection",
        idempotencyKey: idempotency_key,
        metadata: { label, selectedBy: operator },
      });

      if (!result.ok && result.code !== "ALREADY_PROCESSED") {
        return fail(409, result.code);
      }
      return ok({ outcome: "matched", manual: true, result });
    }

    // --- Automatic matching ---------------------------------------------
    const match = await matchScannedLabel(label);

    if (match.kind !== "confident") {
      // Honest uncertainty. The client must show "Nu am găsit o asociere
      // sigură" and offer manual search — and must NOT play the success sound.
      return ok({
        outcome: match.kind,
        threshold: CONFIDENT_MATCH_THRESHOLD,
        candidates: match.candidates.slice(0, 8).map((candidate) => ({
          orderItemId: candidate.line.orderItemId,
          orderNumber: candidate.line.orderNumber,
          customerName: candidate.line.customerName,
          standCode: candidate.line.standCode,
          description: candidate.line.item.description ?? candidate.line.item.raw_description,
          brand: candidate.line.item.brand,
          unitsExpected: candidate.line.unitsExpected,
          score: candidate.score,
          matched: candidate.matched,
        })),
      });
    }

    const result = await receiveUnitForOrderItem({
      orderItemId: match.candidate.line.orderItemId,
      rawValue: label.rawText ?? label.barcode ?? null,
      operator,
      manual,
      reason: reason ?? null,
      idempotencyKey: idempotency_key,
      metadata: { label, score: match.candidate.score, matched: match.candidate.matched },
    });

    if (!result.ok && result.code !== "ALREADY_PROCESSED") {
      return fail(409, result.code);
    }

    return ok({
      outcome: "matched",
      manual: false,
      score: match.candidate.score,
      result,
    });
  });
}
