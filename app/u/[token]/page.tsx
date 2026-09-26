import { notFound } from "next/navigation";
import { getPublicOrderViewByUnitToken } from "@/lib/server/public-order-view";
import { PublicOrderView } from "@/components/logistics/PublicOrderView";

export const dynamic = "force-dynamic";

/**
 * The QR on a printed unit label resolves here — the phone fallback for when no
 * handheld scanner is available. It highlights the specific unit within its
 * order, and is read-only: scanning this URL never changes any status.
 */
export default async function UnitPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getPublicOrderViewByUnitToken(token);
  if (!result) notFound();

  return <PublicOrderView view={result.view} highlightUnitId={result.unitId} />;
}
