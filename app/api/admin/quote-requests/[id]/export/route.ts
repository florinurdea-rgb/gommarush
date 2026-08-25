import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getQuoteRequest } from "@/lib/server/quote-requests";
import { buildQuoteRequestWorkbook, safeFileName } from "@/lib/excel/quote-request-workbook";
import { getAdminSession } from "@/lib/auth/admin-session";
import { logError, logEvent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const uuid = z.string().uuid();

/**
 * GET /api/admin/quote-requests/[id]/export — the .xlsx download.
 *
 * Authenticated explicitly rather than via runAdminRoute, because that
 * helper returns JSON envelopes and this route returns a binary body. The
 * gate itself is the same: a real Supabase admin session. Without it this
 * would be a public endpoint where anyone holding a request UUID could
 * download a customer's contact details.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getAdminSession();
  if (!session) {
    logEvent("quote_request_export_unauthorized", { requestId: params.id });
    return NextResponse.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!uuid.safeParse(params.id).success) {
    return NextResponse.json({ ok: false, code: "VALIDATION_FAILED" }, { status: 400 });
  }

  try {
    // Loaded server-side from Supabase — the client never supplies the
    // content that ends up in the workbook.
    const detail = await getQuoteRequest(params.id);
    if (!detail) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    }

    const buffer = await buildQuoteRequestWorkbook(detail);
    const fileName = safeFileName(detail.request.company_name, detail.request.created_at);

    logEvent("quote_request_exported", {
      requestId: params.id,
      requestNumber: detail.request.request_number,
    });

    // NextResponse's BodyInit doesn't accept a Node Buffer directly; a
    // Uint8Array view over the same bytes is a valid body and copies nothing.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${fileName}"`,
        "content-length": String(buffer.byteLength),
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    logError("quote_request_export_failed", error, { requestId: params.id });
    return NextResponse.json({ ok: false, code: "EXPORT_FAILED" }, { status: 500 });
  }
}
