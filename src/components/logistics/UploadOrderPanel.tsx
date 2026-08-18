"use client";

import { useRef, useState } from "react";
import {
  DDT_STATUS_LABEL,
  DDT_STATUS_TONE,
  buildCustomerResolution,
  canAutoConfirmDdtDocument,
} from "@/lib/ddt-import/client-helpers";
import type { ProcessedDocumentWithMatch } from "@/lib/ddt-import/client-helpers";

/**
 * The "Încarcă document" step of the "Comandă nouă" modal: upload -> a
 * loading bar while the AI (or text-layer fallback) analyzes it -> every
 * document found, selected by default, expandable for detail -> one
 * "Adaugă comenzi" that imports only what's still checked.
 *
 * Deliberately only pre-selects (and only counts toward the CTA) documents
 * canAutoConfirmDdtDocument() says are actually safe — a checked-but-not-
 * confirmable document (NEEDS_REVIEW / POSSIBLE_DUPLICATE / DUPLICATE) is
 * shown with its checkbox disabled, so "select all" can never mean "import
 * something the deterministic pipeline flagged."
 */

interface AnalyzeResponse {
  ok: boolean;
  code?: string;
  documentId?: string;
  documents?: ProcessedDocumentWithMatch[];
  summary?: {
    documentsFound: number;
    ready: number;
    readyMissingOptional: number;
    needsReview: number;
    possibleDuplicate: number;
    duplicate: number;
    totalTyres: number;
  };
  unconfigured?: boolean;
  notes?: string[];
}

type Phase = "pick" | "analyzing" | "review" | "importing";

export function UploadOrderPanel({ onBack, onDone }: { onBack: () => void; onDone: (createdCount: number) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleFile(file: File) {
    setPhase("analyzing");
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/ddt-import/analyze", { method: "POST", body: formData });
      const payload = (await response.json()) as AnalyzeResponse;

      if (!payload.ok) {
        setError(`Analiza a eșuat (${payload.code ?? "eroare necunoscută"}).`);
        setPhase("pick");
        return;
      }

      setResult(payload);
      // Pre-select every document that's actually safe to auto-confirm.
      const preselected = new Set<number>();
      (payload.documents ?? []).forEach((doc, index) => {
        if (canAutoConfirmDdtDocument(doc)) preselected.add(index);
      });
      setSelected(preselected);
      setPhase(payload.documents && payload.documents.length > 0 ? "review" : "pick");
      if (payload.unconfigured) setPhase("review"); // still show the disclosure message
    } catch {
      setError("Eroare de rețea. Încearcă din nou.");
      setPhase("pick");
    }
  }

  function toggleSelected(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleExpanded(index: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function confirmSelected() {
    if (!result?.documents || !result.documentId) return;
    const indexes = [...selected].filter((index) => canAutoConfirmDdtDocument(result.documents![index]));
    if (indexes.length === 0) return;

    setPhase("importing");
    setImportErrors([]);
    setImportProgress({ done: 0, total: indexes.length });

    let createdCount = 0;
    const errors: string[] = [];

    for (const index of indexes) {
      const doc = result.documents[index];
      const customerResolution = buildCustomerResolution(doc);
      if (!customerResolution) continue;

      try {
        const response = await fetch("/api/admin/ddt-import/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ processed: doc, sourceDocumentId: result.documentId, ...customerResolution }),
        });
        const payload = (await response.json()) as { ok: boolean; code?: string };
        if (payload.ok) createdCount += 1;
        else errors.push(`${doc.extracted.document.documentNumber ?? "DDT necunoscut"}: ${payload.code ?? "eroare"}`);
      } catch {
        errors.push(`${doc.extracted.document.documentNumber ?? "DDT necunoscut"}: eroare de rețea`);
      }

      setImportProgress((current) => (current ? { ...current, done: current.done + 1 } : current));
    }

    if (errors.length > 0) {
      setImportErrors(errors);
      setPhase("review");
      return;
    }

    onDone(createdCount);
  }

  const documents = result?.documents ?? [];
  const selectedConfirmableCount = [...selected].filter(
    (index) => documents[index] && canAutoConfirmDdtDocument(documents[index])
  ).length;

  return (
    <div className="space-y-5">
      {phase === "pick" && (
        <>
          <button type="button" onClick={onBack} className="text-sm font-semibold text-accent hover:underline">
            ← Înapoi
          </button>

          <div className="rounded-xl border border-dashed border-ink/20 bg-white p-8 text-center">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-6 font-semibold text-white"
            >
              Încarcă document
            </button>
            <p className="mt-2 text-sm text-ink-soft">PDF sau imagine — poate conține unul sau mai multe DDT-uri.</p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-state-danger-soft px-4 py-3 text-sm font-semibold text-state-danger">
              {error}
            </p>
          )}
        </>
      )}

      {phase === "analyzing" && (
        <div className="py-10 text-center">
          <p className="text-sm font-semibold text-ink">Se analizează documentul…</p>
          <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-soft">
            <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-accent" />
          </div>
          <style>{`
            @keyframes loading-bar {
              0% { transform: translateX(-100%); }
              100% { transform: translateX(300%); }
            }
          `}</style>
        </div>
      )}

      {(phase === "review" || phase === "importing") && result && (
        <>
          {result.unconfigured && (
            <div className="rounded-xl border border-state-warning/30 bg-state-warning-soft p-5">
              <h3 className="text-base font-bold text-state-warning">Analiză automată nu este configurată</h3>
              <p className="mt-2 text-sm text-ink">
                Documentul va fi stocat, iar textul va fi citit direct din fișier acolo unde este posibil.
                Datele care nu pot fi citite trebuie completate manual — sistemul nu inventează valori.
              </p>
              <button type="button" onClick={onBack} className="mt-3 text-sm font-semibold text-accent hover:underline">
                Completează manual →
              </button>
            </div>
          )}

          {result.summary && result.summary.documentsFound > 0 && (
            <div className="rounded-xl border border-ink/10 bg-white p-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
                <span><strong className="text-ink">{result.summary.documentsFound}</strong> DDT-uri</span>
                <span><strong className="text-ink">{result.summary.totalTyres}</strong> anvelope</span>
                <span>{result.summary.ready + result.summary.readyMissingOptional} pregătite</span>
                {result.summary.needsReview > 0 && (
                  <span className="text-state-warning">{result.summary.needsReview} necesită verificare</span>
                )}
                {result.summary.possibleDuplicate > 0 && (
                  <span className="text-state-warning">{result.summary.possibleDuplicate} posibil duplicat</span>
                )}
                {result.summary.duplicate > 0 && (
                  <span className="text-ink-soft">{result.summary.duplicate} deja importate</span>
                )}
              </div>
            </div>
          )}

          {importErrors.length > 0 && (
            <div className="rounded-lg bg-state-danger-soft p-3 text-sm text-state-danger">
              <p className="font-semibold">Unele comenzi nu au putut fi adăugate:</p>
              <ul className="mt-1 list-inside list-disc">
                {importErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            {documents.map((doc, index) => {
              const confirmable = canAutoConfirmDdtDocument(doc);
              const isExpanded = expanded.has(index);

              return (
                <div key={index} className="rounded-xl border border-ink/10 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={selected.has(index)}
                      disabled={!confirmable || phase === "importing"}
                      onChange={() => toggleSelected(index)}
                    />
                    <button
                      type="button"
                      onClick={() => toggleExpanded(index)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${DDT_STATUS_TONE[doc.status]}`}>
                          {DDT_STATUS_LABEL[doc.status]}
                        </span>
                        <span className="font-mono text-sm font-bold text-ink">
                          {doc.extracted.document.documentNumber ?? "DDT necunoscut"}
                        </span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-ink">
                        {doc.extracted.customer.companyName ?? "Client necunoscut"}
                        <span className="ml-2 font-normal text-ink-soft">
                          {doc.extracted.supplier.name ?? "Furnizor necunoscut"}
                        </span>
                      </div>
                    </button>
                    <div className="flex-none text-right">
                      <div className="text-xl font-black tabular-nums text-ink">{doc.tyreCount}</div>
                      <div className="text-xs uppercase text-ink-soft">anvelope</div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 space-y-2 border-t border-ink/10 pt-3 text-sm">
                      {doc.reasons.length > 0 && (
                        <ul className="list-inside list-disc space-y-0.5 text-xs text-ink-soft">
                          {doc.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                      <div className="text-ink-soft">
                        {doc.extracted.customer.addressLine1 ?? "—"}
                        {doc.extracted.customer.city ? `, ${doc.extracted.customer.city}` : ""}
                      </div>
                      <ul className="space-y-1">
                        {doc.physicalItems.map((item, itemIndex) => (
                          <li key={itemIndex} className="flex items-center justify-between text-xs">
                            <span className="min-w-0 truncate text-ink">{item.raw.rawDescription}</span>
                            <span className="flex-none font-mono text-ink-soft">×{item.raw.quantity ?? "?"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-ink/10 pt-4">
            <button type="button" onClick={onBack} className="text-sm font-semibold text-ink-soft hover:text-ink">
              ← Înapoi
            </button>
            <div className="flex items-center gap-3">
              {importProgress && phase === "importing" && (
                <span className="text-sm text-ink-soft">
                  {importProgress.done}/{importProgress.total}…
                </span>
              )}
              <button
                type="button"
                disabled={selectedConfirmableCount === 0 || phase === "importing"}
                onClick={() => void confirmSelected()}
                className="h-11 rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-50"
              >
                {phase === "importing" ? "Se adaugă…" : `Adaugă comenzi (${selectedConfirmableCount})`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
