import { NextResponse } from "next/server";
import { getOrderDetail } from "@/lib/server/orders";
import { getDocumentDownloadUrl } from "@/lib/server/documents";
import { fail, runAdminRoute } from "@/lib/server/route-helpers";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET — redirects to a short-lived signed URL for the order's original
 * source document (the uploaded DDT/invoice), computed fresh on every
 * click so the drawer's "Vezi documentul original" link never has a
 * stale/expired signed URL baked in.
 */
export async function GET(_request: Request, context: RouteContext) {
  return runAdminRoute(async () => {
    const { id } = await context.params;
    const detail = await getOrderDetail(id);
    if (!detail) return fail(404, "ORDER_NOT_FOUND");
    if (!detail.order.source_document_id) return fail(404, "NO_SOURCE_DOCUMENT");

    const url = await getDocumentDownloadUrl(detail.order.source_document_id);
    if (!url) return fail(404, "DOCUMENT_NOT_FOUND");

    return NextResponse.redirect(url);
  });
}
