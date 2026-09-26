import { NextRequest } from "next/server";
import { analyzeStoredDocument, downloadDocumentBytes, recordUploadedDocument } from "@/lib/server/documents";
import { matchCustomerFromDocument } from "@/lib/server/customers";
import { isAnalysisConfigured } from "@/lib/documents";
import { isSupportedUpload, MAX_UPLOAD_BYTES } from "@/lib/documents/analyzer";
import { analyzeUploadedDocumentSchema } from "@/lib/validation/logistics";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
// Document analysis (a vision model round-trip) comfortably exceeds the
// default serverless limit on a multi-page invoice.
export const maxDuration = 120;

/**
 * POST /api/admin/documents — step 2 of the single-document import.
 *
 * The browser already uploaded the file straight to Supabase Storage (see
 * /api/admin/documents/upload-url and src/lib/client/document-upload.ts) —
 * this route only receives the small JSON pointer to it:
 *
 *   record the upload -> download bytes -> extract -> identify supplier
 *   -> extract customer -> match against customer database -> extract
 *   products -> normalise -> validate -> review screen
 *
 * The original is already stored before this runs, so a failing analyser
 * can never lose the upload. No order is created here: the Admin reviews
 * and confirms first.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = analyzeUploadedDocumentSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));

    const { storagePath, fileName, mimeType, fileSize } = parsed.data;
    if (fileSize > MAX_UPLOAD_BYTES) return fail(413, "FILE_TOO_LARGE");
    if (!isSupportedUpload(mimeType, fileName)) return fail(415, "UNSUPPORTED_FILE_TYPE");

    // 1. Record the already-uploaded original. Never discarded after extraction.
    const stored = await recordUploadedDocument({
      storagePath,
      fileName,
      mimeType,
      fileSize,
      uploadedBy: session.subject,
    });

    const bytes = await downloadDocumentBytes(storagePath);

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
