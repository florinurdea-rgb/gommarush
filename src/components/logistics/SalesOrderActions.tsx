"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import {
  NOTE_MAX_LENGTH,
  SALES_ORDER_TRANSITIONS,
  TRANSITION_ACTION_LABELS,
  transitionRequiresNote,
  type SalesOrderStatus,
} from "@/lib/commerce/sales-order-status";
import { useTr } from "@/lib/i18n/tr";

/**
 * The operator's decision on one order.
 *
 * Offers ONLY the moves the lifecycle allows from the current status.
 * Rejecting or cancelling asks for a reason first; confirming is one press
 * with an explicit second step, because it is the commercial commitment.
 *
 * Confirming is NOT a supplier purchase. Supplier ordering is disabled and a
 * separate, visibly inactive control says so, so the two can never be
 * mistaken for each other again (the old "Conferma e invia ordine" merged
 * them into one disabled button).
 */
const ERRORS: Record<string, string> = {
  STATUS_CONFLICT: "Lo stato dell'ordine è cambiato nel frattempo. Ricarica la pagina.",
  TRANSITION_NOT_ALLOWED: "Questo passaggio non è consentito dallo stato attuale.",
  NOTE_REQUIRED: "Indica il motivo.",
  WORKFLOW_NOT_ACTIVATED:
    "La gestione stati non è ancora attivata nel database (migrazione 0008).",
  VALIDATION_FAILED: "Richiesta non valida.",
};

export function SalesOrderActions({ orderId, status }: { orderId: string; status: SalesOrderStatus }) {
  const tr = useTr();
  const router = useRouter();
  const [pending, setPending] = useState<SalesOrderStatus | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moves = SALES_ORDER_TRANSITIONS[status];

  async function apply(to: SalesOrderStatus) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/sales-orders/${orderId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: status, to, note: note.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.code || `HTTP ${r.status}`);
      setPending(null);
      setNote("");
      router.refresh();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setError(tr(ERRORS[code] ?? "Operazione non riuscita.") + (ERRORS[code] ? "" : ` (${code})`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl bg-white p-5 shadow-card">
      <h2 className="font-bold">{tr("Decisione")}</h2>

      {moves.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">{tr("Stato finale: nessuna azione disponibile.")}</p>
      ) : pending === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {moves.map((to) => (
            <Button
              key={to}
              size="md"
              variant={to === "confirmed" || to === "pending_payment" ? "primary" : to === "rejected" ? "danger" : "secondary"}
              disabled={busy}
              onClick={() => {
                setError(null);
                setPending(to);
              }}
            >
              {tr(TRANSITION_ACTION_LABELS[to])}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-ink/10 p-3">
          <p className="text-sm font-semibold text-ink">{tr(TRANSITION_ACTION_LABELS[pending])}?</p>
          {transitionRequiresNote(pending) && (
            <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {tr("Motivo")} *
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-ink/15 p-2 text-base font-normal normal-case tracking-normal text-ink sm:text-sm"
                maxLength={NOTE_MAX_LENGTH}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="md"
              disabled={busy || (transitionRequiresNote(pending) && note.trim() === "")}
              onClick={() => void apply(pending)}
            >
              {busy ? tr("Salvataggio…") : tr("Conferma")}
            </Button>
            <Button size="md" variant="secondary" disabled={busy} onClick={() => setPending(null)}>
              {tr("Annulla")}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-state-danger">
          {error}
        </p>
      )}

      <div className="mt-4 border-t border-ink/10 pt-3">
        <Button size="md" variant="secondary" disabled title={tr("Ordinazione fornitore non ancora attiva")}>
          {tr("Ordine al fornitore")}
        </Button>
        <p className="mt-1 text-xs text-ink-soft">{tr("Ordinazione fornitore non ancora attiva")}</p>
      </div>
    </section>
  );
}
