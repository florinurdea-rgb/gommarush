"use client";

import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { itemTypeLabel } from "@/lib/i18n/logistics";
import type { OrderDetail } from "@/lib/server/orders";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!
  );
}

/**
 * "Prepara l'ordine" — shows the order and, per physical unit, exactly
 * "Stampa riepilogo e prepara" opens the browser's print dialog for a
 * one-page order summary and then advances the order; "Prepara senza
 * stampare" only advances it. The summary print is purely client-side —
 * the thermal-label queue and its desktop Print Agent were removed, so
 * there is no longer a second printer involved.
 *
 * Both buttons move the order to `ready_for_loading` — see prepareOrder()
 * in src/lib/server/prepare-order.ts.
 */
export function PrepareOrderModal({
  orderId,
  onClose,
  onPrepared,
}: {
  orderId: string;
  onClose: () => void;
  onPrepared: () => void;
}) {
  const { showToast } = useToast();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<"print" | "skip" | null>(null);

  useEffect(() => {
    let cancelled = false;
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

  function printSummary() {
    if (!detail) return;
    const address = [
      detail.order.delivery_address_line1 ?? detail.location?.address_line1,
      detail.order.delivery_city ?? detail.location?.city,
    ]
      .filter(Boolean)
      .join(", ");

    const rows = detail.items
      .map((item) => {
        const size =
          item.width && item.rim_diameter ? `${item.width}/${item.aspect_ratio} R${item.rim_diameter}` : "";
        return `<tr>
          <td>${escapeHtml([item.brand, size].filter(Boolean).join(" ") || item.description || item.raw_description || itemTypeLabel(item.item_type))}</td>
          <td style="text-align:right">${item.quantity}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>GommaRush — ${escapeHtml(formatOrderNumber(detail.order.order_number))}</title>
      <style>
        body { font-family: -apple-system, sans-serif; color: #152238; padding: 24px; }
        h1 { font-size: 20px; margin: 0 0 2px; }
        .sub { color: #4A5568; font-size: 13px; margin: 0 0 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
      </style></head><body>
      <h1>Ordine ${escapeHtml(formatOrderNumber(detail.order.order_number))}</h1>
      <p class="sub">
        ${escapeHtml(detail.customer?.name ?? detail.order.delivery_name ?? "Client necunoscut")}<br/>
        ${escapeHtml(address || "—")}<br/>
        Furnizor: ${escapeHtml(detail.supplier?.name ?? "—")}
      </p>
      <table><thead><tr><th>Produs</th><th style="text-align:right">Cant.</th></tr></thead>
      <tbody>${rows}</tbody></table>
      </body></html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function submit(printSummaryFirst: boolean) {
    if (!detail) return;
    setBusy(printSummaryFirst ? "print" : "skip");
    try {
      // A browser print of the order summary for the office printer. This
      // is entirely client-side — the server is not told about it, and no
      // job is queued anywhere.
      if (printSummaryFirst) printSummary();

      const response = await fetch(`/api/admin/orders/${orderId}/prepare`, {
        method: "POST",
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };

      if (!payload.ok) {
        showToast(`Non è stato possibile preparare l'ordine (${payload.code ?? "errore"}).`, "error");
        return;
      }

      showToast("Ordine preparato e pronto per il carico.", "success");
      onPrepared();
      onClose();
    } catch {
      showToast("Errore di rete. Riprova.", "error");
    } finally {
      setBusy(null);
    }
  }

  const address = detail
    ? [detail.order.delivery_address_line1 ?? detail.location?.address_line1, detail.order.delivery_city ?? detail.location?.city]
        .filter(Boolean)
        .join(", ")
    : "";

  return (
    <Modal onClose={onClose} size="lg" label="Prepara l'ordine">
      <ModalHeader title="Prepara l'ordine" onClose={onClose} />
      <div className="p-6">
        {loading && <div className="py-16 text-center text-sm text-ink-soft">Caricamento…</div>}
        {!loading && error && (
          <div className="py-16 text-center text-sm text-state-danger">Non è stato possibile caricare l&apos;ordine.</div>
        )}

        {!loading && detail && (
          <>
            <div className="rounded-xl border border-ink/10 bg-surface-soft p-4">
              <div className="font-mono text-xs font-semibold text-ink-soft">
                {formatOrderNumber(detail.order.order_number)}
              </div>
              <div className="text-lg font-bold text-ink">
                {detail.customer?.name ?? detail.order.delivery_name ?? "Client necunoscut"}
              </div>
              <div className="text-sm text-ink-soft">{address || "Indirizzo sconosciuto"}</div>
              <div className="mt-1 text-xs text-ink-soft">Furnizor: {detail.supplier?.name ?? "—"}</div>
            </div>

            <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-ink-soft">
              Etichete ({detail.units.length})
            </h3>
            <p className="mt-1 text-xs text-ink-soft">
              Ogni etichetta conterrà: prodotto, fornitore, cliente, ordine e indirizzo di consegna.
            </p>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {detail.units.map((unit) => {
                const item = detail.items.find((i) => i.id === unit.order_item_id);
                const size = item?.width && item?.rim_diameter ? `${item.width}/${item.aspect_ratio} R${item.rim_diameter}` : "";
                return (
                  <li
                    key={unit.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate text-ink">
                      {[item?.brand, size].filter(Boolean).join(" ") ||
                        item?.description ||
                        item?.raw_description ||
                        (item ? itemTypeLabel(item.item_type) : "—")}
                    </span>
                    <span className="flex-none font-mono text-xs text-ink-soft">#{unit.unit_sequence}</span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-5 flex flex-col gap-2 border-t border-ink/10 pt-4 sm:flex-row-reverse">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void submit(true)}
                className="h-11 flex-1 rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy === "print" ? "Preparazione…" : "Stampa riepilogo e prepara"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void submit(false)}
                className="h-11 flex-1 rounded-xl border border-ink/15 bg-white px-5 text-sm font-bold text-ink disabled:opacity-50"
              >
                {busy === "skip" ? "Preparazione…" : "Prepara senza stampare"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
