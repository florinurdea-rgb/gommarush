import { Logo } from "@/components/Logo";
import { StandBadge } from "@/components/logistics/StandBadge";
import { OrderStatusBadge } from "@/components/logistics/StatusBadge";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { itemTypeLabel, t } from "@/lib/i18n/logistics";
import type { PublicStandView } from "@/lib/server/stands";

/**
 * The read-only view anyone in the warehouse gets by scanning a stand QR or a
 * unit QR with their phone.
 *
 * What it deliberately does NOT show: admin actions, edit/delete controls,
 * payment details, addresses, or unit tokens. A unit token is effectively a
 * bearer credential for marking that object stored or loaded, so it must never
 * appear on a page reachable from a public QR code.
 */
export function PublicOrderView({
  view,
  highlightUnitId,
}: {
  view: PublicStandView;
  highlightUnitId?: string;
}) {
  const { order } = view;

  return (
    <div className="min-h-screen bg-surface-soft">
      <header className="border-b border-ink/10 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <Logo iconClassName="h-9 w-9" textClassName="text-lg" />
          <span className="rounded-md bg-state-neutral-soft px-2 py-1 text-xs font-semibold text-state-neutral">
            {t("readOnlyView")}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-lg px-4 py-6">
        <div className="flex items-center gap-4">
          <StandBadge standCode={view.standCode} size="lg" />
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-ink-soft">{t("stand")}</div>
            <div className="text-3xl font-black text-ink">{view.standCode}</div>
          </div>
        </div>

        {!order ? (
          <div className="mt-8 rounded-2xl border-2 border-dashed border-state-success/40 bg-state-success-soft px-6 py-16 text-center">
            <p className="text-2xl font-extrabold text-state-success">
              Stativ {view.standCode} {t("standFree")}
            </p>
            <p className="mt-2 text-sm text-state-success/80">
              Nicio comandă activă pe acest stativ.
            </p>
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-2xl border border-ink/10 bg-white p-5 shadow-card">
              <div className="font-mono text-sm font-bold text-accent">
                {formatOrderNumber(order.order_number)}
              </div>
              <h1 className="mt-1 text-2xl font-extrabold text-ink">
                {order.customer_name ?? "—"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status} />
                {order.planned_delivery_date && (
                  <span className="text-sm text-ink-soft">
                    {t("plannedDate")}: {order.planned_delivery_date}
                  </span>
                )}
              </div>
              {(order.driver_name || order.vehicle_name) && (
                <p className="mt-2 text-sm text-ink-soft">
                  {[order.driver_name, order.vehicle_name].filter(Boolean).join(" · ")}
                </p>
              )}
            </section>

            <section className="mt-5 space-y-3">
              {view.items.map((item) => {
                const highlighted = highlightUnitId != null && item.units.some((unit) => unit.id === highlightUnitId);
                return (
                  <article
                    key={item.id}
                    className={`rounded-2xl border p-4 ${
                      highlighted ? "border-accent bg-accent-light" : "border-ink/10 bg-white"
                    }`}
                  >
                    <div className="font-semibold text-ink">{item.description}</div>
                    <div className="mt-0.5 text-xs text-ink-soft">
                      {itemTypeLabel(item.item_type)} · {t("quantity")}: {item.quantity}
                    </div>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
