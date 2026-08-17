import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { isStandCode } from "@/lib/types/logistics";
import { standQrUrl } from "@/lib/logistics/label";
import { appBaseUrl } from "@/lib/config";

export const runtime = "nodejs";

/**
 * The PERMANENT stand QR code, as an SVG for printing and sticking on the rack.
 *
 * It encodes `/stand/A` — a fixed URL that never changes. The order currently
 * on that stand is resolved server-side at scan time, which is why this sticker
 * is printed once and never replaced when the order changes.
 *
 * Public on purpose: it renders a URL, not data. Scanning it leads to the
 * read-only stand view.
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const standCode = code.toUpperCase();

  if (!isStandCode(standCode)) {
    return NextResponse.json({ ok: false, code: "INVALID_STAND" }, { status: 404 });
  }

  const target = standQrUrl(appBaseUrl(), standCode);

  const svg = await QRCode.toString(target, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 512,
  });

  return new NextResponse(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      // The target URL is fixed forever, so this is safe to cache hard.
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
