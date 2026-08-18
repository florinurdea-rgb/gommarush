import { NextRequest } from "next/server";
import { z } from "zod";
import { locationResolutionSchema } from "@/lib/validation/logistics";
import { confirmDdtDocument } from "@/lib/server/ddt-import";
import type { ProcessedDocumentWithMatch } from "@/lib/server/ddt-import";
import type { CustomerInput } from "@/lib/server/customers";
import { describeError, fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";

const uuid = z.string().uuid();

/**
 * Deliberately light validation on `processed`: it is the exact JSON this
 * same server returned from /analyze moments earlier (an admin-only,
 * authenticated round trip, not third-party input), and every field
 * confirmDdtDocument() reads from it is already handled defensively
 * (optional chaining, `?? null`) — a malformed shape degrades a field to
 * null rather than opening a security hole. What's validated strictly here
 * is what actually gates a write: the resolution enum and the ids.
 */
const confirmSchema = z
  .object({
    processed: z.record(z.string(), z.unknown()),
    sourceDocumentId: uuid,
    customerId: uuid.nullish(),
    customerLocationId: uuid.nullish(),
    newCustomer: z.record(z.string(), z.unknown()).nullish(),
    resolution: locationResolutionSchema,
    supplierCustomerCode: z.string().trim().max(100).nullish(),
  })
  .strict();

export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    try {
      const result = await confirmDdtDocument({
        processed: parsed.data.processed as unknown as ProcessedDocumentWithMatch,
        sourceDocumentId: parsed.data.sourceDocumentId,
        customerResolution: {
          customerId: parsed.data.customerId ?? null,
          customerLocationId: parsed.data.customerLocationId ?? null,
          newCustomer: (parsed.data.newCustomer as unknown as CustomerInput | null) ?? null,
          resolution: parsed.data.resolution,
          supplierCustomerCode: parsed.data.supplierCustomerCode ?? null,
        },
        changedBy: session.subject,
      });

      return ok({ ...result }, 201);
    } catch (error) {
      logError("ddt_confirm_failed", error, { sourceDocumentId: parsed.data.sourceDocumentId });
      return fail(500, "SAVE_FAILED", describeError(error));
    }
  });
}
