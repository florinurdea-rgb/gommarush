import { NextRequest } from "next/server";
import { getAnalysisStatus } from "@/lib/server/document-analysis-jobs";
import { fail, ok, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ddt-import/status?analysisId=... — what the review UI polls.
 *
 * Returns the analysis state and the line tally only. Deliberately not the
 * raw extraction or the provider payload: the browser needs to know whether
 * the job finished and whether anything is unresolved, and every additional
 * field is one the client could then be tempted to send back as truth.
 */
export async function GET(request: NextRequest) {
  return runAdminRoute(async () => {
    const analysisId = request.nextUrl.searchParams.get("analysisId");
    if (!analysisId || !/^[0-9a-f-]{36}$/i.test(analysisId)) {
      return fail(400, "VALIDATION_FAILED");
    }

    const status = await getAnalysisStatus(analysisId);
    if (!status) return fail(404, "ANALYSIS_NOT_FOUND");

    return ok({ analysis: status });
  });
}
