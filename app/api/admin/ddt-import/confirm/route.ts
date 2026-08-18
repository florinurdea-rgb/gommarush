import { NextRequest } from "next/server";
import { z } from "zod";
import { locationResolutionSchema } from "@/lib/validation/logistics";
import { confirmDdtDocument } from "@/lib/server/ddt-import";
import type { ProcessedDocumentWithMatch } from "@/lib/server/ddt-import";
import type { CustomerInput } from "@/lib/server/customers";
import { createSupabaseAdminClient } from "@/lib/supabase/server-admin";
import { normaliseDocumentNumber } from "@/lib/logistics/ddt-dedup";
import { isMissingSchemaError } from "@/lib/server/schema-errors";
import { describeError, fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";
import { logError, logEvent } from "@/lib/logger";

export const runtime = "nodejs";

const uuid = z.string().uuid();

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

type ExistingOrder = {
  id: string;
  order_number: string | number;
  supplier_document_number: string | null;
};

/**
 * Confirmation must be idempotent. A previous request can successfully create
 * the order and then fail while attaching DDT metadata (settings/migration/
 * network error). Retrying that same READY document must return the already
 * created order, not turn a partial success into ALREADY_IMPORTED.
 *
 * The normalized column is preferred when the DDT migration exists. Older DB
 * states fall back to normalising the raw supplier_document_number in code.
 */
async function findExistingOrder(processed: ProcessedDocumentWithMatch): Promise<ExistingOrder | null> {
  const supplierId = processed.supplierId;
  const rawNumber = processed.extracted?.document?.documentNumber ?? null;
  const normalized = processed.normalizedDocumentNumber ?? (rawNumber ? normaliseDocumentNumber(rawNumber) : null);
  if (!supplierId || !normalized) return null;

  const supabase = createSupabaseAdminClient();
  const primary = await supabase
    .from("orders")
    .select("id, order_number, supplier_document_number")
    .eq("supplier_id", supplierId)
    .eq("normalized_document_number", normalized)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!primary.error) return (primary.data as ExistingOrder | null) ?? null;
  if (!isMissingSchemaError(primary.error)) throw primary.error;

  const fallback = await supabase
    .from("orders")
    .select("id, order_number, supplier_document_number")
    .eq("supplier_id", supplierId)
    .not("supplier_document_number", "is", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (fallback.error) throw fallback.error;

  return (
    ((fallback.data ?? []) as ExistingOrder[]).find(
      (row) => row.supplier_document_number && normaliseDocumentNumber(row.supplier_document_number) === normalized
    ) ?? null
  );
}

function recoveredPayload(processed: ProcessedDocumentWithMatch, existing: ExistingOrder) {
  return {
    orderId: existing.id,
    orderNumber: String(existing.order_number),
    tyreCount: processed.tyreCount,
    transportRevenue: 0,
    droppedLineCount: processed.physicalItems.filter((line) => line.raw.quantity === null).length,
    recoveredExisting: true,
  };
}

export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const processed = parsed.data.processed as unknown as ProcessedDocumentWithMatch;

    try {
      // READY documents are allowed to be retried safely. Explicit duplicate
      // flows keep their existing human-decision behaviour ("Adaugă din nou").
      if (processed.status !== "DUPLICATE" && processed.status !== "POSSIBLE_DUPLICATE") {
        const existing = await findExistingOrder(processed);
        if (existing) {
          logEvent("ddt_confirm_retry_recovered", {
            orderId: existing.id,
            sourceDocumentId: parsed.data.sourceDocumentId,
          });
          return ok(recoveredPayload(processed, existing), 200);
        }
      }

      const result = await confirmDdtDocument({
        processed,
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
      const pgError = error as { code?: string; message?: string } | null;

      // Race-safe idempotency: if another request inserted the same DDT between
      // our pre-check and createOrder(), resolve the winner and return it.
      if (pgError?.code === "23505") {
        try {
          const existing = await findExistingOrder(processed);
          if (existing) {
            logEvent("ddt_confirm_duplicate_race_recovered", {
              orderId: existing.id,
              sourceDocumentId: parsed.data.sourceDocumentId,
            });
            return ok(recoveredPayload(processed, existing), 200);
          }
        } catch (lookupError) {
          logError("ddt_confirm_duplicate_recovery_failed", lookupError, {
            sourceDocumentId: parsed.data.sourceDocumentId,
          });
        }

        const message = pgError.message ?? "";
        if (
          message.includes("orders_supplier_document_unique") ||
          message.includes("orders_supplier_doc_number_key") ||
          message.includes("supplier_document") ||
          message.includes("normalized_document_number")
        ) {
          logError("ddt_confirm_duplicate_race", error, { sourceDocumentId: parsed.data.sourceDocumentId });
          return fail(409, "ALREADY_IMPORTED", ["Acest document a fost deja importat ca o altă comandă."]);
        }
      }

      if (pgError?.message?.includes("NOTHING_IMPORTABLE")) {
        return fail(400, "NOTHING_IMPORTABLE", ["Nicio linie cu cantitate citibilă — completează manual."]);
      }

      logError("ddt_confirm_failed", error, { sourceDocumentId: parsed.data.sourceDocumentId });
      return fail(500, "SAVE_FAILED", describeError(error));
    }
  });
}
