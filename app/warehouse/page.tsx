import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/auth/admin-session";
import { getDriverSession } from "@/lib/auth/driver-session";
import { WarehouseScanStation } from "@/components/logistics/WarehouseScanStation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Depozitare" };

/**
 * The storage scanning station: after the printed GoRush label is physically
 * attached, an operator scans it here and the unit becomes `stored`.
 *
 * Open to either an admin session or a driver session — the storage bench is
 * worked by whoever is on shift, and whichever identity was used is recorded on
 * every scan.
 */
export default async function WarehousePage() {
  const [admin, driver] = await Promise.all([getAdminSession(), getDriverSession()]);
  if (!admin && !driver) redirect("/admin/login");

  return <WarehouseScanStation operatorName={driver?.driverName ?? admin?.displayName ?? "operator"} />;
}
