"use client";
import { useTr } from "@/lib/i18n/tr";

/**
 * Replaces the old hard-stop duplicate error with an informational choice.
 * A DUPLICATE/POSSIBLE_DUPLICATE flag (or the database's own unique-
 * constraint 409 on confirm) is a signal for a human to double check, not a
 * reason to dead-end the import — the admin may know it's genuinely a
 * repeat delivery, or that an earlier attempt actually failed. Bilingual
 * (RO/IT) since documents in this pipeline come from Italian suppliers.
 */
export function DuplicateImportDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const tr = useTr();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-import-dialog-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-modal">
        <h3 id="duplicate-import-dialog-title" className="text-base font-bold text-ink">
          Ordine forse già esistente
        </h3>
        <p className="mt-2 text-sm text-ink-soft">{tr("Sembra che lo stesso ordine sia già stato inserito.")}</p>
        <p className="mt-1 text-sm italic text-ink-soft">
          Sembra che lo stesso ordine sia già stato inserito nel sistema.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-ink/15 px-4 py-2.5 text-sm font-semibold text-ink disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? "Aggiunta…" : tr("Aggiungi di nuovo")}
          </button>
        </div>
      </div>
    </div>
  );
}
