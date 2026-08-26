"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/i18n/tr";

/**
 * Permanent deletion of one quote request.
 *
 * This destroys the customer's request, its products and its history, and
 * nothing brings it back — so the confirmation is a real one. It states
 * what is being deleted by reference, says plainly that it cannot be
 * undone, and the destructive button is never the one under the cursor
 * when the dialog opens.
 *
 * Deliberately NOT window.confirm: a native dialog cannot name the request
 * or carry the "cannot be undone" line, and on mobile it is a system alert
 * with two identical-looking buttons.
 */
export function DeleteQuoteRequestButton({
  requestId,
  reference,
  companyName,
  /** "row" is the compact icon in the table; "detail" is the full button. */
  variant = "detail",
  /** Where to go after deleting from the detail page. */
  redirectTo,
}: {
  requestId: string;
  reference: string;
  companyName: string;
  variant?: "row" | "detail";
  redirectTo?: string;
}) {
  const tr = useTr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Focus lands on Cancel, not Delete: the safe choice is the default.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function confirmDelete() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/quote-requests/${requestId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };

      if (!payload.ok) {
        setError(
          payload.code === "NOT_FOUND"
            ? tr("Questa richiesta non esiste più.")
            : tr("Eliminazione non riuscita. Riprova.")
        );
        return;
      }

      setOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
      } else {
        // Stay on the list; the row disappears on the next server render.
        router.refresh();
      }
    } catch {
      setError(tr("Errore di rete. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {variant === "row" ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`${tr("Elimina definitivamente")} ${reference}`}
          title={tr("Elimina definitivamente")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-state-danger-soft hover:text-state-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path
              d="M4 6h12M8 6V4.5h4V6M6.5 6l.6 9a1 1 0 0 0 1 1h3.8a1 1 0 0 0 1-1l.6-9M8.5 9v4M11.5 9v4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-state-danger/40 px-4 text-sm font-semibold text-state-danger transition-colors hover:bg-state-danger hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger focus-visible:ring-offset-2"
        >
          {tr("Elimina definitivamente")}
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) setOpen(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`delete-title-${requestId}`}
            aria-describedby={`delete-body-${requestId}`}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2
              id={`delete-title-${requestId}`}
              className="text-base font-bold text-ink"
            >
              {tr("Eliminare definitivamente questa richiesta?")}
            </h2>

            <p id={`delete-body-${requestId}`} className="mt-2 text-sm text-ink-soft">
              <span className="font-mono font-bold text-ink">{reference}</span>
              {" — "}
              <span className="font-semibold text-ink">{companyName}</span>
            </p>

            <p className="mt-3 rounded-lg bg-state-danger-soft px-3 py-2 text-sm text-ink">
              {tr(
                "Vengono eliminati la richiesta, i prodotti richiesti e la cronologia. L'operazione non può essere annullata."
              )}
            </p>

            {error && (
              <p role="alert" className="mt-3 text-sm font-semibold text-state-danger">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 px-5 text-sm font-semibold text-ink transition-colors hover:border-ink/30 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {tr("Annulla")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmDelete()}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-state-danger px-5 text-sm font-bold text-white transition-colors hover:opacity-90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger focus-visible:ring-offset-2"
              >
                {busy ? tr("Eliminazione…") : tr("Elimina definitivamente")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
