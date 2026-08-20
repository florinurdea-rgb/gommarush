"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OrderStatusBadge, UnitStatusBadge } from "@/components/logistics/StatusBadge";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { itemTypeLabel, t } from "@/lib/i18n/logistics";
import type { OrderDetail } from "@/lib/server/orders";

/**
 * The board card's "quick look": fetches the same data as the full order
 * page. A side drawer on desktop, a full-screen sheet on mobile — the same
 * markup does both (w-full max-w-md is a full-width sheet under 448px and a
 * right-hand drawer above it), so a click on a card never leaves the board.
 * Deliberately read-only — editing (driver/vehicle/status/etc.) stays on
 * the full page, reached via the footer link.
 */
export function OrderDetailModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDetail(null);

    fetch(`/api/admin/orders/${orderId}/detail`)
      .then((response) => response.json())
      .then((payload: { ok: boolean; detail?: OrderDetail }) => {
        if (cancelled) return;
        if (!payload.ok || !payload.detail) {
          setError(true);
          return;
        }
        setDetail(payload.detail);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const phone = detail?.location?.phone ?? null;

  return (
    <div role="presentation" className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={detail ? formatOrderNumber(detail.order.order_number) : "Detalii comandă"}
        onClick={(event) => event.stopPropagation()}
        className="fixed inset-y-0 right-0 flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-modal"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink/10 bg-white/95 px-5 py-3 backdrop-blur">
          <span className="text-sm font-bold text-ink">Detalii comandă</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Închide"
            className="flex h-8 w-8 items-center justify-center rounded-full text-ink-soft hover:bg-surface-soft hover:text-ink"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 p-5 sm:p-6">
          {loading && <div className="py-16 text-center text-sm text-ink-soft">Se încarcă…</div>}

          {!loading && error && (
            <div className="py-16 text-center text-sm text-state-danger">Comanda nu a putut fi încărcată.</div>
          )}

          {!loading && detail && (
            <>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-xs font-semibold text-ink-soft">
                    {formatOrderNumber(detail.order.order_number)}
                  </div>
                  <h2 className="truncate text-xl font-extrabold tracking-tight text-ink">
                    {detail.customer?.name ?? "Client nespecificat"}
                  </h2>
                  <div className="mt-1">
                    <OrderStatusBadge status={detail.order.status} size="sm" />
                  </div>
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-soft">{t("plannedDate")}</dt>
                  <dd className="font-medium text-ink">{detail.order.planned_delivery_date ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-soft">{t("driverVehicle")}</dt>
                  <dd className="font-medium text-ink">
                    {detail.driver?.name ?? "—"}
                    {detail.vehicle?.name ? ` · ${detail.vehicle.name}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-soft">Poziție livrare</dt>
                  <dd className="font-medium text-ink">
                    {detail.order.delivery_sequence ? `#${detail.order.delivery_sequence}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-soft">{t("supplier")}</dt>
                  <dd className="font-medium text-ink">{detail.supplier?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-soft">{t("documentReference")}</dt>
                  <dd className="font-mono text-ink">{detail.order.supplier_document_number ?? "—"}</dd>
                </div>
                {phone && (
                  <div>
                    <dt className="text-xs text-ink-soft">Telefon</dt>
                    <dd className="font-medium text-ink">
                      <a href={`tel:${phone}`} className="text-accent hover:underline">
                        {phone}
                      </a>
                    </dd>
                  </div>
                )}
              </dl>

              {(detail.order.delivery_address_line1 || detail.location) && (
                <div className="mt-4 rounded-xl bg-surface-soft p-3 text-sm text-ink">
                  {detail.order.delivery_address_line1 ?? detail.location?.address_line1}
                  <div className="text-ink-soft">
                    {detail.order.delivery_postal_code ?? detail.location?.postal_code ?? ""}{" "}
                    {detail.order.delivery_city ?? detail.location?.city ?? ""}
                  </div>
                </div>
              )}

              {detail.order.cash_on_delivery && (
                <div className="mt-3 rounded-xl bg-state-warning-soft px-3 py-2 text-sm font-semibold text-state-warning">
                  {t("amountToCollect")}: {detail.order.amount_to_collect ?? "—"} {detail.order.currency}
                </div>
              )}

              {(detail.order.delivery_notes || detail.order.notes) && (
                <div className="mt-3 rounded-xl border border-ink/10 p-3 text-sm">
                  <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">Note</div>
                  {detail.order.delivery_notes && <p className="mt-1 text-ink">{detail.order.delivery_notes}</p>}
                  {detail.order.notes && <p className="mt-1 text-ink-soft">{detail.order.notes}</p>}
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {(
                  [
                    ["Pregătit", detail.order.ready_at],
                    ["Încărcat", detail.order.loaded_at],
                    ["Livrat", detail.order.delivered_at],
                  ] as const
                ).map(([label, timestamp]) => (
                  <span key={label} className={timestamp ? "font-semibold text-ink" : "text-ink-soft"}>
                    {timestamp ? "✓" : "○"} {label}
                  </span>
                ))}
              </div>

              <div className="mt-5">
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-soft">{t("products")}</h3>
                <ul className="mt-2 space-y-2">
                  {detail.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate text-ink">
                        {item.description ?? item.raw_description ?? itemTypeLabel(item.item_type)}
                      </span>
                      <span className="flex-none font-mono text-xs text-ink-soft">×{item.quantity}</span>
                    </li>
                  ))}
                </ul>
                {detail.units.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.units.map((unit) => (
                      <UnitStatusBadge key={unit.id} status={unit.status} size="sm" />
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-3 border-t border-ink/10 pt-4 text-sm">
                {detail.order.source_document_id && (
                  <a
                    href={`/api/admin/orders/${detail.order.id}/document-url`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-accent hover:underline"
                  >
                    Vezi documentul original →
                  </a>
                )}
                <Link href="/admin/print-jobs" className="font-semibold text-accent hover:underline">
                  Coadă de printare →
                </Link>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-4">
                <Link
                  href={`/admin/orders/${detail.order.id}`}
                  className="text-sm font-semibold text-accent hover:underline"
                >
                  Deschide pagina completă →
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl bg-surface-soft px-4 py-2 text-sm font-semibold text-ink hover:bg-ink/10"
                >
                  Închide
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
