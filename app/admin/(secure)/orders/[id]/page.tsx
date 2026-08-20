import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrderDetail, getOrderStatusHistory } from "@/lib/server/orders";
import { listDrivers, listVehicles } from "@/lib/server/reference";
import { PageHeading } from "@/components/logistics/AdminShell";
import { OrderStatusBadge, UnitStatusBadge } from "@/components/logistics/StatusBadge";
import { OrderEditPanel } from "@/components/logistics/OrderEditPanel";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { itemTypeLabel, orderStatusMeta, t } from "@/lib/i18n/logistics";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();

  const [drivers, vehicles, history] = await Promise.all([
    listDrivers(),
    listVehicles(),
    getOrderStatusHistory(id, 30),
  ]);

  const unitsByItem = new Map<string, typeof detail.units>();
  for (const unit of detail.units) {
    const list = unitsByItem.get(unit.order_item_id) ?? [];
    list.push(unit);
    unitsByItem.set(unit.order_item_id, list);
  }

  return (
    <>
      <PageHeading
        title={formatOrderNumber(detail.order.order_number)}
        description={detail.customer?.name ?? "Client nespecificat"}
        back
        action={<OrderStatusBadge status={detail.order.status} />}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
            <h2 className="text-base font-bold text-ink">{t("products")}</h2>
            <div className="mt-4 space-y-4">
              {detail.items.map((item) => {
                const units = unitsByItem.get(item.id) ?? [];
                return (
                  <div key={item.id} className="rounded-lg border border-ink/10 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-ink">
                          {item.description ?? item.raw_description ?? "—"}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-soft">
                          {itemTypeLabel(item.item_type)} · {t("quantity")}: {item.quantity}
                          {item.brand ? ` · ${item.brand}` : ""}
                          {item.width ? ` · ${item.width}/${item.aspect_ratio} R${item.rim_diameter}` : ""}
                        </div>
                        {item.needs_review && item.review_fields.length > 0 && (
                          <div className="mt-1 text-xs font-semibold text-state-warning">
                            De verificat: {item.review_fields.join(", ")}
                          </div>
                        )}
                      </div>
                      {!item.is_physical && (
                        <span className="rounded-md bg-state-neutral-soft px-2 py-0.5 text-xs font-semibold text-state-neutral">
                          Fără obiecte fizice
                        </span>
                      )}
                    </div>

                    {units.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {units.map((unit) => (
                          <div
                            key={unit.id}
                            className="flex items-center gap-2 rounded-md border border-ink/10 px-2 py-1"
                          >
                            <span className="font-mono text-xs font-bold text-ink-soft">
                              #{unit.unit_sequence}
                            </span>
                            <UnitStatusBadge status={unit.status} size="sm" />
                            {unit.matched_manually && (
                              <span className="text-xs font-semibold text-state-warning">manual</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
            <h2 className="text-base font-bold text-ink">Istoric</h2>
            {history.length === 0 ? (
              <p className="mt-3 text-sm text-ink-soft">Niciun eveniment încă.</p>
            ) : (
              <ul className="mt-3 divide-y divide-ink/5 text-sm">
                {history.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="font-mono text-xs text-ink-soft">
                      {new Date(event.changed_at).toLocaleString("ro-RO")}
                    </span>
                    <span className="font-semibold text-ink">
                      {event.old_status && event.old_status !== event.new_status
                        ? `${orderStatusMeta(event.old_status).label} → ${orderStatusMeta(event.new_status).label}`
                        : orderStatusMeta(event.new_status).label}
                    </span>
                    {event.changed_by_label && <span className="text-ink-soft">{event.changed_by_label}</span>}
                    {event.notes && <span className="text-xs text-ink-soft">({event.notes})</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
            <h2 className="text-base font-bold text-ink">Progres</h2>
            <ol className="mt-3 space-y-2 text-sm">
              {(
                [
                  ["Pregătit", detail.order.ready_at],
                  ["Încărcat", detail.order.loaded_at],
                  ["Livrat", detail.order.delivered_at],
                ] as const
              ).map(([label, timestamp]) => (
                <li key={label} className="flex items-center justify-between gap-2">
                  <span className={timestamp ? "font-semibold text-ink" : "text-ink-soft"}>
                    {timestamp ? "✓" : "○"} {label}
                  </span>
                  {timestamp && (
                    <span className="font-mono text-xs text-ink-soft">
                      {new Date(timestamp).toLocaleString("ro-RO")}
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t("supplier")}</dt>
                <dd className="font-medium text-ink">{detail.supplier?.name ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t("documentReference")}</dt>
                <dd className="font-mono text-ink">{detail.order.supplier_document_number ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-soft">{t("deliveryLocation")}</dt>
                <dd className="text-right text-ink">
                  {detail.order.delivery_address_line1 ?? detail.location?.address_line1 ?? "—"}
                  <br />
                  <span className="text-xs text-ink-soft">
                    {detail.order.delivery_postal_code ?? detail.location?.postal_code ?? ""}{" "}
                    {detail.order.delivery_city ?? detail.location?.city ?? ""}
                  </span>
                </dd>
              </div>
              {detail.order.cash_on_delivery && (
                <div className="flex justify-between">
                  <dt className="text-ink-soft">{t("amountToCollect")}</dt>
                  <dd className="font-bold text-ink">
                    {detail.order.amount_to_collect ?? "—"} {detail.order.currency}
                  </dd>
                </div>
              )}
            </dl>

            <Link
              href={`/orders/${detail.order.id}`}
              className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
            >
              {t("readOnlyView")} →
            </Link>
          </section>

          <OrderEditPanel
            orderId={detail.order.id}
            drivers={drivers.map((d) => ({ id: d.id, name: d.name }))}
            vehicles={vehicles.map((v) => ({ id: v.id, name: v.name }))}
            driverId={detail.order.driver_id}
            vehicleId={detail.order.vehicle_id}
            plannedDate={detail.order.planned_delivery_date}
            status={detail.order.status}
          />
        </div>
      </div>
    </>
  );
}
