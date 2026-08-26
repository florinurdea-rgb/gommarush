"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { QUOTE_STATUS_LABELS, type QuoteRequestStatus } from "@/lib/types/quote-request";
import { useTr } from "@/lib/i18n/tr";

/**
 * Status transitions + Excel export for one request.
 *
 * Status is advanced explicitly by an operator — opening a request never
 * changes it on its own, so "Nuova" keeps meaning "nobody has picked this
 * up" rather than "nobody has glanced at it".
 *
 * The primary button offers only the NEXT step in the lifecycle, so the
 * common path is one tap; a select alongside it can reach any state, because
 * a sales process that cannot be corrected is a sales process people work
 * around. Both go through the same server-validated endpoint.
 *
 * `status` comes from the server on every render, so if another admin moved
 * the request while this page was open, the next refresh shows their change
 * rather than this page's stale idea of it.
 */

/** The single most likely next step for each state. */
const NEXT_STATUS: Partial<Record<QuoteRequestStatus, QuoteRequestStatus>> = {
  submitted: "reviewing",
  reviewing: "quote_preparing",
  quote_preparing: "quote_ready",
  quote_ready: "sent",
  sent: "accepted",
};

const ALL_STATUSES: QuoteRequestStatus[] = [
  "submitted",
  "reviewing",
  "quote_preparing",
  "quote_ready",
  "sent",
  "accepted",
  "rejected",
  "expired",
  "archived",
];

export function QuoteRequestActions({
  requestId,
  status,
}: {
  requestId: string;
  status: QuoteRequestStatus;
}) {
  const tr = useTr();
  const router = useRouter();
  const [pending, setPending] = useState<QuoteRequestStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextStatus = NEXT_STATUS[status];

  async function changeStatus(next: QuoteRequestStatus) {
    if (pending) return;
    setPending(next);
    setError(null);

    try {
      const response = await fetch(`/api/admin/quote-requests/${requestId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await response.json()) as { ok: boolean };
      if (!payload.ok) {
        setError(tr("Aggiornamento non riuscito. Riprova."));
        return;
      }
      router.refresh();
    } catch {
      setError(tr("Aggiornamento non riuscito. Riprova."));
    } finally {
      setPending(null);
    }
  }

  /**
   * Fetched rather than linked so an auth failure surfaces as a message
   * instead of dumping a JSON error page over the admin UI.
   */
  async function exportExcel() {
    if (exporting) return;
    setExporting(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/quote-requests/${requestId}/export`);
      if (!response.ok) {
        setError(tr("Esportazione non riuscita. Riprova."));
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const url = URL.createObjectURL(blob);

      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = match?.[1] ?? "offerta.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(tr("Esportazione non riuscita. Riprova."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void exportExcel()}
          disabled={exporting}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-bold text-white transition-colors hover:bg-accent-dark disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          {exporting ? "Generazione…" : tr("Apri in Excel")}
        </button>

        {nextStatus && (
          <button
            type="button"
            onClick={() => void changeStatus(nextStatus)}
            disabled={pending !== null}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 px-5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {pending === nextStatus
              ? tr("Aggiornamento…")
              : `Segna: ${tr(QUOTE_STATUS_LABELS[nextStatus])}`}
          </button>
        )}

        <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
          <span className="sr-only">{tr("Cambia stato richiesta")}</span>
          <select
            value={status}
            disabled={pending !== null}
            onChange={(event) => void changeStatus(event.target.value as QuoteRequestStatus)}
            className="min-h-11 rounded-lg border border-ink/15 bg-white px-3 text-sm font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
          >
            {ALL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {tr(QUOTE_STATUS_LABELS[value])}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-state-danger">
          {error}
        </p>
      )}
    </div>
  );
}
