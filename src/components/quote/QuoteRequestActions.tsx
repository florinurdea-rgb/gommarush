"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { QuoteRequestStatus } from "@/lib/types/quote-request";

/**
 * Status transitions + Excel export for one request.
 *
 * Status is advanced explicitly by an operator — opening a request never
 * changes it on its own, so "Nuova" keeps meaning "nobody has picked this
 * up" rather than "nobody has glanced at it".
 */
export function QuoteRequestActions({
  requestId,
  status,
}: {
  requestId: string;
  status: QuoteRequestStatus;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<QuoteRequestStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError("Aggiornamento non riuscito. Riprova.");
        return;
      }
      router.refresh();
    } catch {
      setError("Aggiornamento non riuscito. Riprova.");
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
        setError("Esportazione non riuscita. Riprova.");
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
      setError("Esportazione non riuscita. Riprova.");
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
          {exporting ? "Generazione…" : "Apri in Excel"}
        </button>

        {status === "new" && (
          <button
            type="button"
            onClick={() => void changeStatus("in_progress")}
            disabled={pending !== null}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 px-5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {pending === "in_progress" ? "Aggiornamento…" : "Segna in lavorazione"}
          </button>
        )}

        {status === "in_progress" && (
          <button
            type="button"
            onClick={() => void changeStatus("offer_sent")}
            disabled={pending !== null}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 px-5 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {pending === "offer_sent" ? "Aggiornamento…" : "Segna offerta inviata"}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm font-semibold text-state-danger">
          {error}
        </p>
      )}
    </div>
  );
}
