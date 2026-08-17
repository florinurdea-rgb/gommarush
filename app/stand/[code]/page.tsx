import { notFound } from "next/navigation";
import { getCurrentStandOrder } from "@/lib/server/stands";
import { PublicOrderView } from "@/components/logistics/PublicOrderView";
import { isStandCode, STAND_CODES } from "@/lib/types/logistics";

export const dynamic = "force-dynamic";

/**
 * The PERMANENT stand QR target.
 *
 * The sticker on stand A encodes `/stand/A` and never changes. Which order is
 * on the stand is resolved here, at scan time — so the physical QR never has to
 * be reprinted when the order changes, and a free stand honestly reports itself
 * as free.
 */
export function generateStaticParams() {
  return STAND_CODES.map((code) => ({ code }));
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return { title: `Stativ ${code.toUpperCase()}` };
}

export default async function StandPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const standCode = code.toUpperCase();
  if (!isStandCode(standCode)) notFound();

  const view = await getCurrentStandOrder(standCode);
  return <PublicOrderView view={view} />;
}
