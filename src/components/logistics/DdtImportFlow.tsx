"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { uploadDocumentDirect } from "@/lib/client/document-upload";
import {
  DDT_STATUS_LABEL as STATUS_LABEL,
  DDT_STATUS_TONE as STATUS_TONE,
  buildCustomerResolution,
  canAutoConfirmDdtDocument as canAutoConfirm,
} from "@/lib/ddt-import/client-helpers";
import type { ProcessedDocumentWithMatch } from "@/lib/ddt-import/client-helpers";

/**
 * The multi-DDT import screen: upload -> processing summary -> one card per
 * detected document -> confirm the safe ones.
 *
 * The whole analysis happens in a single request/response (see
 * app/api/admin/ddt-import/analyze), so "processing stages" here are a
 * loading state followed by the final result rather than a live stream —
 * still shows the same information the spec asks for (§34), just not
 * incrementally.
 *
 * Shares its status labels/tones and confirm-eligibility logic with the
 * "Comandă nouă" modal's upload step (src/components/logistics/
 * UploadOrderPanel.tsx) via src/lib/ddt-import/client-helpers.ts — one
 * definition of "when is a document safe to auto-confirm", not two.
 */

interface AnalyzeResponse {
  ok: boolean;
  code?: string;
  documentId?: string;
  pageCount?: number | null;
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
  /** AI extraction isn't configured — an expected, disclosed state, never an error. */
  unconfigured?: boolean;
  notes?: string[];
}

export function DdtImportFlow() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [confirming, setConfirming] = useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = useState<Map<number, { orderId: string; orderNumber: string }>>(new Map());
  const [confirmErrors, setConfirmErrors] = useState<Map<number, string>>(new Map());

  async function handleFileSelected(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setConfirmed(new Map());
    setConfirmErrors(new Map());

    try {
      const uploaded = await uploadDocumentDirect(file);
      const response = await fetch("/api/admin/ddt-import/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(uploaded),
      });
      const payload = (await response.json()) as AnalyzeResponse;

      if (!payload.ok) {
        setError(`Analiza a eșuat (${payload.code ?? "eroare necunoscută"}).`);
        return;
      }
      setResult(payload);
    } catch {
      setError("Eroare de rețea. Încearcă din nou.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDocument(index: number) {
    if (!result?.documents || !result.documentId) return;
    const doc = result.documents[index];
    const customerResolution = buildCustomerResolution(doc);
    if (!customerResolution) return;

    setConfirming((current) => new Set(current).add(index));
    setConfirmErrors((current) => {
      const next = new Map(current);
      next.delete(index);
      return next;
    });

    try {
      const response = await fetch("/api/admin/ddt-import/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          processed: doc,
          sourceDocumentId: result.documentId,
          ...customerResolution,
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        code?: string;
        orderId?: string;
        orderNumber?: string;
      };

      if (!payload.ok || !payload.orderId) {
        setConfirmErrors((current) => new Map(current).set(index, payload.code ?? "SAVE_FAILED"));
        return;
      }

      setConfirmed((current) =>
        new Map(current).set(index, { orderId: payload.orderId!, orderNumber: payload.orderNumber! })
      );
    } catch {
      setConfirmErrors((current) => new Map(current).set(index, "NETWORK_ERROR"));
    } finally {
      setConfirming((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    }
  }

  async function confirmAllSafe() {
    if (!result?.documents) return;
    for (let index = 0; index < result.documents.length; index++) {
      const doc = result.documents[index];
      if (canAutoConfirm(doc) && !confirmed.has(index)) {
        await confirmDocument(index);
      }
    }
  }

  const readyCount =
    result?.documents?.filter((doc, index) => canAutoConfirm(doc) && !confirmed.has(index)).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-dashed border-ink/20 bg-white p-6 text-center">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileSelected(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-accent px-6 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Se analizează…" : "Încarcă document"}
        </button>
        <p className="mt-2 text-sm text-ink-soft">PDF sau imagine — poate conține unul sau mai multe DDT-uri.</p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-state-danger-soft px-4 py-3 text-sm font-semibold text-state-danger">
          {error}
        </p>
      )}

      {result?.unconfigured && (
        <div className="rounded-xl border border-state-warning/30 bg-state-warning-soft p-5">
          <h2 className="text-base font-bold text-state-warning">Analiză automată nu este configurată</h2>
          <p className="mt-2 text-sm text-ink">
            Documentul va fi stocat, iar textul va fi citit direct din fișier acolo unde este posibil.
            Datele care nu pot fi citite trebuie completate manual — sistemul nu inventează valori.
          </p>
          <Link
            href="/admin/orders/new"
            className="mt-3 inline-block text-sm font-semibold text-accent hover:underline"
          >
            Completează comanda manual →
          </Link>
        </div>
      )}

      {result && !result.unconfigured && result.notes && result.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-ink-soft">
          {result.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {result?.summary && (
        <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Analiză document</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Pagini" value={result.pageCount ?? "—"} />
            <Stat label="DDT-uri detectate" value={result.summary.documentsFound} />
            <Stat label="Anvelope detectate" value={result.summary.totalTyres} />
            <Stat label="Necesită verificare" value={result.summary.needsReview} tone="warning" />
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-ink-soft">
            <span>{result.summary.ready} pregătite</span>
            <span>{result.summary.readyMissingOptional} pregătite (date opționale lipsă)</span>
            <span>{result.summary.possibleDuplicate} posibil duplicat</span>
            <span>{result.summary.duplicate} deja importate</span>
          </div>

          {readyCount > 1 && (
            <button
              type="button"
              onClick={() => void confirmAllSafe()}
              className="mt-4 h-11 rounded-xl bg-state-success px-5 text-sm font-bold text-white"
            >
              Confirmă toate comenzile pregătite ({readyCount})
            </button>
          )}
        </div>
      )}

      {result?.documents?.map((doc, index) => (
        <DocumentCard
          key={index}
          doc={doc}
          canConfirm={canAutoConfirm(doc)}
          confirming={confirming.has(index)}
          confirmed={confirmed.get(index) ?? null}
          error={confirmErrors.get(index) ?? null}
          onConfirm={() => void confirmDocument(index)}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "warning" }) {
  return (
    <div>
      <div className="text-xs uppercase text-ink-soft">{label}</div>
      <div className={`text-2xl font-black tabular-nums ${tone === "warning" ? "text-state-warning" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function DocumentCard({
  doc,
  canConfirm,
  confirming,
  confirmed,
  error,
  onConfirm,
}: {
  doc: ProcessedDocumentWithMatch;
  canConfirm: boolean;
  confirming: boolean;
  confirmed: { orderId: string; orderNumber: string } | null;
  error: string | null;
  onConfirm: () => void;
}) {
  const { extracted } = doc;

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-bold ${STATUS_TONE[doc.status]}`}>
            {STATUS_LABEL[doc.status]}
          </span>
          <div className="mt-1.5 font-mono text-sm font-bold text-ink">
            {extracted.document.documentNumber ?? "DDT necunoscut"}
          </div>
          <div className="text-base font-bold text-ink">{extracted.customer.companyName ?? "Client necunoscut"}</div>
          <div className="text-xs text-ink-soft">{extracted.supplier.name ?? "Furnizor necunoscut"}</div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-black tabular-nums text-ink">{doc.tyreCount}</div>
          <div className="text-xs uppercase text-ink-soft">anvelope</div>
        </div>
      </div>

      {doc.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
          {doc.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      {doc.duplicateOfOrderId && (
        <Link
          href={`/admin/orders/${doc.duplicateOfOrderId}`}
          className="mt-2 inline-block text-xs font-semibold text-accent hover:underline"
        >
          Vezi comanda existentă →
        </Link>
      )}

      <div className="mt-3 flex items-center gap-3">
        {confirmed ? (
          <Link
            href={`/admin/orders/${confirmed.orderId}`}
            className="text-sm font-bold text-state-success hover:underline"
          >
            ✓ Comandă creată — {formatOrderNumber(confirmed.orderNumber)} →
          </Link>
        ) : canConfirm ? (
          <button
            type="button"
            disabled={confirming}
            onClick={onConfirm}
            className="h-10 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {confirming ? "Se salvează…" : "Confirmă comanda"}
          </button>
        ) : (
          <span className="text-xs text-ink-soft">
            {doc.status === "DUPLICATE" || doc.status === "POSSIBLE_DUPLICATE"
              ? "Necesită decizie manuală înainte de import."
              : "Completează manual din pagina de comandă nouă."}
          </span>
        )}
        {error && <span className="text-xs font-semibold text-state-danger">Eroare: {error}</span>}
      </div>
    </div>
  );
}
