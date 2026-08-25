"use client";

import { useMemo, useState } from "react";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { useOps } from "@/lib/i18n/ops";
import { PROFIT_PER_DELIVERED_TYRE_EUR } from "@/lib/logistics/summary-constants";
import type { DeliveryRow } from "@/lib/server/summary";
import { useTr } from "@/lib/i18n/tr";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
}

/**
 * The "Vezi livrările" modal: the period's delivered orders, searchable and
 * filterable client-side (the full list was already fetched for the Sumar
 * page — no extra round trip). "Stampa" opens a plain print-friendly
 * window and calls window.print() — there's no existing report-printing
 * infrastructure to reuse (print_jobs is thermal barcode labels, a
 * different system), so this is the smallest addition that covers it.
 */
export function DeliveriesModal({
  deliveries,
  periodLabel,
  onClose,
}: {
  deliveries: DeliveryRow[];
  periodLabel: string;
  onClose: () => void;
}) {
  const tr = useTr();
  const ops = useOps();
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [vehicleFilter, setVehicleFilter] = useState("all");

  const supplierOptions = useMemo(
    () => [...new Set(deliveries.map((d) => d.supplierName).filter((n): n is string => Boolean(n)))].sort(),
    [deliveries]
  );
  const vehicleOptions = useMemo(
    () => [...new Set(deliveries.map((d) => d.vehicleName).filter((n): n is string => Boolean(n)))].sort(),
    [deliveries]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return deliveries.filter((delivery) => {
      if (supplierFilter !== "all" && delivery.supplierName !== supplierFilter) return false;
      if (vehicleFilter !== "all" && delivery.vehicleName !== vehicleFilter) return false;
      if (!query) return true;
      const haystack = [
        formatOrderNumber(delivery.orderNumber),
        delivery.customerName,
        delivery.supplierName,
        delivery.vehicleName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [deliveries, search, supplierFilter, vehicleFilter]);

  const totalTyres = filtered.reduce((sum, d) => sum + d.tyreCount, 0);
  const totalProfit = totalTyres * PROFIT_PER_DELIVERED_TYRE_EUR;

  function handlePrint() {
    const rows = filtered
      .map(
        (d) => `<tr>
          <td>${formatDateTime(d.deliveredAt)}</td>
          <td>${formatOrderNumber(d.orderNumber)}</td>
          <td>${escapeHtml(d.customerName ?? "—")}</td>
          <td>${escapeHtml(d.supplierName ?? "—")}</td>
          <td>${escapeHtml(d.vehicleName ?? "—")}</td>
          <td style="text-align:right">${d.tyreCount}</td>
          <td>${escapeHtml(ops.orderStatusMeta(d.status).label)}</td>
        </tr>`
      )
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>{tr("GommaRush — Consegne")}</title>
      <style>
        body { font-family: -apple-system, sans-serif; color: #152238; padding: 24px; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        .period { color: #4A5568; margin: 0 0 16px; }
        .summary { display: flex; gap: 24px; margin-bottom: 16px; font-size: 14px; }
        .summary strong { display: block; font-size: 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border-bottom: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
        th { text-transform: uppercase; font-size: 10px; color: #4A5568; }
      </style></head><body>
      <h1>{tr("GommaRush — Consegne")}</h1>
      <p class="period">Periodo: ${escapeHtml(periodLabel)}</p>
      <div class="summary">
        <div>Comenzi<strong>${filtered.length}</strong></div>
        <div>{tr("Pneumatici")}<strong>${totalTyres}</strong></div>
        <div>Profit<strong>€${totalProfit.toLocaleString("ro-RO")}</strong></div>
      </div>
      <table>
        <thead><tr><th>{tr("Data")}</th><th>{tr("Ordine")}</th><th>Client</th><th>Supplier</th><th>{tr("Veicolo")}</th><th>{tr("Nr. pneumatici")}</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </body></html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  return (
    <Modal onClose={onClose} size="xl" label={tr("Consegne")}>
      <ModalHeader title={`Consegne — ${periodLabel}`} onClose={onClose} />
      <div className="p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tr("Cerca ordine / cliente")}
            className="h-10 flex-1 min-w-[12rem] rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent"
          />
          {supplierOptions.length > 1 && (
            <select
              value={supplierFilter}
              onChange={(event) => setSupplierFilter(event.target.value)}
              className="h-10 rounded-lg border border-ink/15 px-2 text-sm text-ink"
            >
              <option value="all">{tr("Tutti i fornitori")}</option>
              {supplierOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          {vehicleOptions.length > 1 && (
            <select
              value={vehicleFilter}
              onChange={(event) => setVehicleFilter(event.target.value)}
              className="h-10 rounded-lg border border-ink/15 px-2 text-sm text-ink"
            >
              <option value="all">{tr("Tutti i veicoli")}</option>
              {vehicleOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handlePrint}
            className="h-10 rounded-lg bg-accent px-4 text-sm font-bold text-white hover:bg-accent-dark"
          >
            Stampa
          </button>
        </div>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-soft">{tr("Nessuna consegna nel periodo selezionato.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/10 text-left text-xs uppercase text-ink-soft">
                  <th className="py-2 pr-3">{tr("Data")}</th>
                  <th className="py-2 pr-3">{tr("Ordine")}</th>
                  <th className="py-2 pr-3">Client</th>
                  <th className="py-2 pr-3">Supplier</th>
                  <th className="py-2 pr-3">{tr("Veicolo")}</th>
                  <th className="py-2 pr-3 text-right">{tr("Pneumatici")}</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((delivery) => (
                  <tr key={delivery.orderId} className="border-b border-ink/5">
                    <td className="py-2 pr-3 text-ink-soft">{formatDateTime(delivery.deliveredAt)}</td>
                    <td className="py-2 pr-3 font-mono text-xs font-semibold">
                      {formatOrderNumber(delivery.orderNumber)}
                    </td>
                    <td className="py-2 pr-3 font-medium text-ink">{delivery.customerName ?? "—"}</td>
                    <td className="py-2 pr-3 text-ink-soft">{delivery.supplierName ?? "—"}</td>
                    <td className="py-2 pr-3 text-ink-soft">{delivery.vehicleName ?? "—"}</td>
                    <td className="py-2 pr-3 text-right font-mono">{delivery.tyreCount}</td>
                    <td className="py-2">{ops.orderStatusMeta(delivery.status).label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
