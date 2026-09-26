"use client";

import { useCallback, useRef, useState } from "react";
import { uploadDocumentDirect, DocumentUploadError } from "@/lib/client/document-upload";
import { useTr } from "@/lib/i18n/tr";

/**
 * Upload -> preview -> commit, for a supplier catalogue file.
 *
 * The shape follows the DDT importer that already exists: the browser puts
 * the file straight into Supabase Storage and the server never receives raw
 * bytes in a request body. Nothing here parses a workbook — 9,500 rows of
 * XLSX is not the browser's job.
 *
 * The preview step is not a formality. Analyze writes staging rows and
 * changes nothing in the catalogue, so an operator can read the numbers and
 * cancel. Commit is the only button that writes.
 */

interface Supplier {
  id: string;
  name: string;
}

interface Summary {
  sourceRows: number;
  valid: number;
  review: number;
  rejected: number;
  newProducts: number;
  newListings: number;
  updatedListings: number;
  unchangedListings: number;
  conflicts: number;
  proposedDeactivations: number;
  newEans: number;
  newWeights: number;
  missingEans: number;
  invalidEans: number;
  missingWeights: number;
  truncated: boolean;
}

interface Analysis {
  runId: string;
  duplicateOfRunId: string | null;
  summary: Summary;
  errors: { sourceRow: number; messages: string[] }[];
}

interface Progress {
  applied: number;
  newProducts: number;
  insertedListings: number;
  updatedListings: number;
  unchanged: number;
  deactivated: number;
  conflicts: number;
  finished: boolean;
}

type Phase = "idle" | "uploading" | "analyzing" | "previewed" | "committing" | "done" | "error";

export function CatalogueImporter({ suppliers }: { suppliers: Supplier[] }) {
  const tr = useTr();
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [importMode, setImportMode] = useState<"partial" | "complete">("partial");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setFile(null);
    setAnalysis(null);
    setProgress(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  async function startAnalysis() {
    if (!file || !supplierId) return;
    setError(null);
    setPhase("uploading");

    try {
      const uploaded = await uploadDocumentDirect(file);
      setPhase("analyzing");

      const response = await fetch("/api/admin/catalogue/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storagePath: uploaded.storagePath,
          fileName: uploaded.fileName,
          fileSize: uploaded.fileSize,
          supplierId,
          adapterId: "isb",
          importMode,
        }),
      });
      const payload = (await response.json()) as
        | ({ ok: true } & Analysis)
        | { ok: false; code: string; details?: string[] };

      if (!payload.ok) {
        setError([payload.code, ...(payload.details ?? [])].join(" — "));
        setPhase("error");
        return;
      }

      setAnalysis(payload);
      setPhase("previewed");
    } catch (caught) {
      setError(caught instanceof DocumentUploadError ? caught.code : tr("Errore di rete"));
      setPhase("error");
    }
  }

  /**
   * Commit loops because one request cannot finish a large catalogue inside
   * the function time limit. The server applies a bounded number of atomic
   * batches and reports whether anything is left; this keeps asking until
   * it says finished, and the totals accumulate across the calls.
   */
  async function commit() {
    if (!analysis) return;
    setPhase("committing");
    setError(null);

    const totals: Progress = {
      applied: 0, newProducts: 0, insertedListings: 0, updatedListings: 0,
      unchanged: 0, deactivated: 0, conflicts: 0, finished: false,
    };

    // A hard ceiling so a server that never reports finished cannot spin here.
    for (let round = 0; round < 200; round++) {
      const response = await fetch("/api/admin/catalogue/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: analysis.runId, maxBatches: 6 }),
      });
      const payload = (await response.json()) as
        | ({ ok: true } & Progress)
        | { ok: false; code: string; details?: string[] };

      if (!payload.ok) {
        setError([payload.code, ...(payload.details ?? [])].join(" — "));
        setPhase("error");
        return;
      }

      totals.applied += payload.applied;
      totals.newProducts += payload.newProducts;
      totals.insertedListings += payload.insertedListings;
      totals.updatedListings += payload.updatedListings;
      totals.unchanged += payload.unchanged;
      totals.deactivated += payload.deactivated;
      totals.conflicts += payload.conflicts;
      totals.finished = payload.finished;
      setProgress({ ...totals });

      if (payload.finished) break;
      // A round that applied nothing means no progress is possible; stop
      // rather than loop, and leave the run visibly unfinished.
      if (payload.applied === 0) break;
    }

    setPhase(totals.finished ? "done" : "error");
    if (!totals.finished) {
      setError(tr("Importazione interrotta: alcune righe non sono state applicate."));
    }
  }

  async function cancel() {
    if (analysis) {
      await fetch("/api/admin/catalogue/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: analysis.runId }),
      }).catch(() => undefined);
    }
    reset();
  }

  const busy = phase === "uploading" || phase === "analyzing" || phase === "committing";

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
          {tr("1. Scegli il file")}
        </h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="catalogue-supplier" className="block text-sm font-semibold text-ink">
              {tr("Fornitore")}
            </label>
            <select
              id="catalogue-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              disabled={busy || phase === "previewed"}
              className="mt-1 min-h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:bg-surface-soft"
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="catalogue-file" className="block text-sm font-semibold text-ink">
              {tr("File catalogo (.xlsx)")}
            </label>
            <input
              ref={fileRef}
              id="catalogue-file"
              type="file"
              accept=".xlsx"
              disabled={busy || phase === "previewed"}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-ink-soft file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-lg file:border-0 file:bg-surface-soft file:px-4 file:text-sm file:font-semibold file:text-ink hover:file:bg-ink/10"
            />
          </div>
        </div>

        {/* The one setting that can remove data, so it says exactly what it
            does rather than hiding behind a word like "full sync". */}
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-ink">{tr("Tipo di file")}</legend>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "partial"}
                onChange={() => setImportMode("partial")}
                disabled={busy || phase === "previewed"}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">{tr("Aggiornamento parziale")}</span>
                <span className="block text-xs text-ink-soft">
                  {tr("Aggiunge e aggiorna. Non disattiva mai nulla.")}
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="radio"
                name="import-mode"
                checked={importMode === "complete"}
                onChange={() => setImportMode("complete")}
                disabled={busy || phase === "previewed"}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">{tr("Catalogo completo")}</span>
                <span className="block text-xs text-ink-soft">
                  {tr(
                    "Il file contiene l'intero catalogo del fornitore. Gli articoli assenti verranno proposti per la disattivazione."
                  )}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {phase !== "previewed" && phase !== "done" && (
          <button
            type="button"
            onClick={startAnalysis}
            disabled={!file || !supplierId || busy}
            className="mt-5 min-h-11 rounded-lg bg-accent px-6 text-sm font-bold text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {phase === "uploading"
              ? tr("Caricamento…")
              : phase === "analyzing"
                ? tr("Analisi in corso…")
                : tr("Analizza")}
          </button>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">{tr("Importazione non riuscita")}</p>
          <p className="mt-1 break-words font-mono text-xs text-ink">{error}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 min-h-11 rounded-lg border border-ink/15 px-4 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          >
            {tr("Ricomincia")}
          </button>
        </div>
      )}

      {analysis && analysis.duplicateOfRunId && (
        <div className="rounded-xl border border-state-warning/40 bg-state-warning-soft p-4">
          <p className="text-sm font-bold text-ink">{tr("File già importato")}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {tr(
              "Questo identico file è già stato importato per questo fornitore. Non è stato fatto nulla."
            )}
          </p>
        </div>
      )}

      {analysis &&
        !analysis.duplicateOfRunId &&
        (phase === "previewed" || phase === "committing" || phase === "done") && (
          <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
              {tr("2. Anteprima")}
            </h2>

            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={tr("Righe nel file")} value={analysis.summary.sourceRows} />
              <Stat label={tr("Nuovi prodotti")} value={analysis.summary.newProducts} tone="accent" />
              <Stat label={tr("Nuovi articoli fornitore")} value={analysis.summary.newListings} />
              <Stat label={tr("Articoli aggiornati")} value={analysis.summary.updatedListings} />
              <Stat label={tr("Invariati")} value={analysis.summary.unchangedListings} />
              <Stat label={tr("Nuovi codici a barre")} value={analysis.summary.newEans} />
              <Stat label={tr("Nuovi pesi")} value={analysis.summary.newWeights} />
              <Stat
                label={tr("Conflitti")}
                value={analysis.summary.conflicts}
                tone={analysis.summary.conflicts > 0 ? "warning" : undefined}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={tr("EAN mancanti")} value={analysis.summary.missingEans} muted />
              <Stat label={tr("EAN non validi")} value={analysis.summary.invalidEans} muted />
              <Stat label={tr("Pesi mancanti")} value={analysis.summary.missingWeights} muted />
              <Stat label={tr("Righe scartate")} value={analysis.summary.rejected} muted />
            </div>

            {analysis.summary.proposedDeactivations > 0 && (
              <p className="mt-4 rounded-lg border border-state-warning/40 bg-state-warning-soft p-3 text-sm text-ink">
                {tr("Articoli proposti per la disattivazione:")}{" "}
                <span className="font-bold tabular-nums">
                  {analysis.summary.proposedDeactivations}
                </span>
              </p>
            )}

            {analysis.errors.length > 0 && (
              <details className="mt-4 rounded-lg border border-ink/10 bg-surface-soft p-3">
                <summary className="cursor-pointer text-sm font-semibold text-ink">
                  {tr("Righe con errori")} ({analysis.errors.length})
                </summary>
                <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-ink-soft">
                  {analysis.errors.slice(0, 50).map((row) => (
                    <li key={row.sourceRow}>
                      {tr("Riga")} {row.sourceRow}: {row.messages.join(", ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {phase === "previewed" && (
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={commit}
                  className="min-h-11 rounded-lg bg-accent px-6 text-sm font-bold text-white transition-colors hover:bg-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
                >
                  {tr("Conferma e importa")}
                </button>
                <button
                  type="button"
                  onClick={cancel}
                  className="min-h-11 rounded-lg border border-ink/15 px-6 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
                >
                  {tr("Annulla")}
                </button>
              </div>
            )}
          </section>
        )}

      {(phase === "committing" || phase === "done") && progress && analysis && (
        <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">
            {phase === "done" ? tr("3. Importazione completata") : tr("3. Importazione in corso…")}
          </h2>

          <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-soft">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{
                width: `${Math.min(100, Math.round((progress.applied / Math.max(1, analysis.summary.sourceRows)) * 100))}%`,
              }}
            />
          </div>

          <p className="mt-2 text-sm tabular-nums text-ink-soft">
            {progress.applied} / {analysis.summary.sourceRows} {tr("righe applicate")}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={tr("Nuovi prodotti")} value={progress.newProducts} tone="accent" />
            <Stat label={tr("Nuovi articoli fornitore")} value={progress.insertedListings} />
            <Stat label={tr("Aggiornati")} value={progress.updatedListings} />
            <Stat
              label={tr("Conflitti")}
              value={progress.conflicts}
              tone={progress.conflicts > 0 ? "warning" : undefined}
            />
          </div>

          {phase === "done" && (
            <button
              type="button"
              onClick={reset}
              className="mt-5 min-h-11 rounded-lg border border-ink/15 px-6 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
            >
              {tr("Importa un altro file")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  muted,
}: {
  label: string;
  value: number;
  tone?: "accent" | "warning";
  muted?: boolean;
}) {
  const valueClass =
    tone === "accent" ? "text-accent" : tone === "warning" ? "text-state-warning" : "text-ink";
  return (
    <div
      className={`rounded-lg border border-ink/10 px-3 py-2 ${muted ? "bg-surface-soft/60" : "bg-white"}`}
    >
      <div className={`text-xl font-black tabular-nums ${muted ? "text-ink-soft" : valueClass}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[11px] font-medium uppercase leading-tight tracking-wide text-ink-soft">
        {label}
      </div>
    </div>
  );
}
