import { notFound } from "next/navigation";
import { getPublicOrderView } from "@/lib/server/stands";
import { PublicOrderView } from "@/components/logistics/PublicOrderView";

export const dynamic = "force-dynamic";

/** Safe read-only order view. Same projection as the stand QR page. */
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
