import { notFound } from "next/navigation";
import { getPublicOrderView } from "@/lib/server/public-order-view";
import { PublicOrderView } from "@/components/logistics/PublicOrderView";

export const dynamic = "force-dynamic";

/** Safe read-only order view, reachable from a public link or QR code. */
export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const view = await getPublicOrderView(id);
  if (!view) notFound();

  return <PublicOrderView view={view} />;
}
