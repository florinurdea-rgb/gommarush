import { NextRequest } from "next/server";
import { analyzeStoredDocument, storeOrderDocument } from "@/lib/server/documents";
import { matchCustomerFromDocument } from "@/lib/server/customers";
import { isAnalysisConfigured } from "@/lib/documents";
import { isSupportedUpload, MAX_UPLOAD_BYTES } from "@/lib/documents/analyzer";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// Document analysis (upload + a vision model round-trip) comfortably exceeds
// the default serverless limit on a multi-page invoice.
export const maxDuration = 120;

/**
 * POST /api/admin/documents — step 1 of the import pipeline.
 *
 *   upload -> STORE ORIGINAL -> extract -> identify supplier -> extract customer
 *   -> match against customer database -> extract products -> normalise
 *   -> validate -> review screen
 *
 * The original is stored BEFORE analysis, so a failing analyser can never lose
 * the upload. No order is created here: the Admin reviews and confirms first.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return fail(415, "UNSUPPORTED_MEDIA_TYPE");
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return fail(400, "VALIDATION_FAILED");
    }

    const file = formData.get("file");
    if (!(file instanceof File)) return fail(400, "VALIDATION_FAILED");
    if (file.size === 0) return fail(400, "VALIDATION_FAILED");
    if (file.size > MAX_UPLOAD_BYTES) return fail(413, "FILE_TOO_LARGE");

    const fileName = file.name || "document";
    const mimeType = file.type || "application/octet-stream";
    if (!isSupportedUpload(mimeType, fileName)) return fail(415, "UNSUPPORTED_FILE_TYPE");

    const bytes = Buffer.from(await file.arrayBuffer());

    // 1. Store the original. Never discarded after extraction.
    const stored = await storeOrderDocument({
      bytes,
      fileName,
      mimeType,
      uploadedBy: session.subject,
    });

    // 2. Analyse — or honestly report that automatic analysis isn't available.
    const analysis = await analyzeStoredDocument({
      documentId: stored.id,
      bytes,
      fileName,
      mimeType,
    });

    // 3. Match the extracted customer against the database. Produces a
    //    decision for a human; never writes anything.
    const customerMatch =
      analysis.customer.companyName || analysis.customer.vatNumber
        ? await matchCustomerFromDocument({
            extractedCustomer: {
              companyName: analysis.customer.companyName,
              vatNumber: analysis.customer.vatNumber,
              fiscalCode: analysis.customer.fiscalCode,
              supplierCustomerCode: analysis.customer.supplierCustomerCode,
            },
            extractedLocation: {
              recipientName: analysis.customer.deliveryRecipient,
              addressLine1: analysis.customer.addressLine1,
              addressLine2: analysis.customer.addressLine2,
              city: analysis.customer.city,
              province: analysis.customer.province,
              postalCode: analysis.customer.postalCode,
              country: analysis.customer.country,
            },
          })
        : null;

    return ok(
      {
        documentId: stored.id,
        sourceType: stored.sourceType,
        analysis,
        customerMatch,
        analysisConfigured: isAnalysisConfigured(),
      },
      201
    );
  });
}
