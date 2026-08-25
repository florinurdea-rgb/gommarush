"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OrderReviewForm } from "@/components/logistics/OrderReviewForm";
import { uploadDocumentDirect } from "@/lib/client/document-upload";
import { errorMessage, t } from "@/lib/i18n/logistics";
import type { AnalysisResult } from "@/lib/documents/analyzer";
import type { CustomerMatchResult } from "@/lib/logistics/customer-matching";

/**
 * The import flow, in the order the brief specifies:
 *
 *   1. "Unde adaugi comanda?"  -> today's or tomorrow's deliveries
 *   2. "Carica documento"      -> upload + analyse (manual entry is visible but
 *                                 disabled, marked "În curând")
 *   3. review + confirm        -> the editable review screen
 *
 * No order exists until step 3 is confirmed.
 */

type Step = "day" | "method" | "review";

export interface OptionRef {
  id: string;
  name: string;
}

interface NewOrderFlowProps {
  analysisConfigured: boolean;
}

function isoDateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const ACCEPTED = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,application/pdf,image/*";

export function NewOrderFlow({ analysisConfigured }: NewOrderFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("day");
  const [plannedDate, setPlannedDate] = useState<string>(isoDateOffset(0));
  const [dayLabel, setDayLabel] = useState<string>(t("todaysDeliveries"));

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [customerMatch, setCustomerMatch] = useState<CustomerMatchResult | null>(null);
  const [sourceType, setSourceType] = useState<string>("manual");

  async function upload(file: File) {
    setUploading(true);
    setError(null);

    try {
      const uploaded = await uploadDocumentDirect(file);

      const response = await fetch("/api/admin/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(uploaded),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        code?: string;
        documentId?: string;
        sourceType?: string;
        analysis?: AnalysisResult;
        customerMatch?: CustomerMatchResult | null;
      };

      if (!payload.ok || !payload.analysis) {
        setError(errorMessage(payload.code));
        return;
      }

      setDocumentId(payload.documentId ?? null);
      setSourceType(payload.sourceType ?? "manual");
      setAnalysis(payload.analysis);
      setCustomerMatch(payload.customerMatch ?? null);
      setStep("review");
    } catch {
      setError(errorMessage("UPLOAD_FAILED"));
    } finally {
      setUploading(false);
    }
  }

  // ---------------------------------------------------------------- step 1
  if (step === "day") {
    return (
      <div className="max-w-xl rounded-2xl border border-ink/10 bg-white p-6 shadow-card">
        <h2 className="text-lg font-bold text-ink">{t("whereToAdd")}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Scegli il giorno di consegna previsto per questo ordine.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[
            { label: t("todaysDeliveries"), offset: 0 },
            { label: t("tomorrowsDeliveries"), offset: 1 },
          ].map((option) => (
            <button
              key={option.offset}
              type="button"
              onClick={() => {
                setPlannedDate(isoDateOffset(option.offset));
                setDayLabel(option.label);
                setStep("method");
              }}
              className="rounded-xl border-2 border-ink/10 bg-white px-4 py-6 text-left transition-colors hover:border-accent hover:bg-accent-light"
            >
              <div className="text-base font-bold text-ink">{option.label}</div>
              <div className="mt-1 font-mono text-sm text-ink-soft">
                {isoDateOffset(option.offset)}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- step 2
  if (step === "method") {
    return (
      <div className="max-w-xl rounded-2xl border border-ink/10 bg-white p-6 shadow-card">
        <button
          type="button"
          onClick={() => setStep("day")}
          className="mb-4 text-sm font-semibold text-accent hover:underline"
        >
          ← {t("back")}
        </button>

        <h2 className="text-lg font-bold text-ink">{dayLabel}</h2>
        <p className="mt-1 font-mono text-sm text-ink-soft">{plannedDate}</p>

        {!analysisConfigured && (
          <div className="mt-4 rounded-lg bg-state-waiting-soft p-3 text-sm text-state-waiting">
            <strong className="font-bold">{t("analysisNotConfigured")}</strong>
            <p className="mt-1 leading-relaxed">
              Il documento verrà salvato e il testo verrà letto direttamente dal file
              acolo unde este posibil. Datele care nu pot fi citite trebuie
              inseriti manualmente — il sistema non inventa valori.
            </p>
          </div>
        )}

        <div className="mt-5 space-y-3">
          <label
            className={`block cursor-pointer rounded-xl border-2 border-dashed border-accent/40 bg-accent-light/40 px-4 py-8 text-center transition-colors hover:border-accent ${
              uploading ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <input
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <span className="block text-base font-bold text-accent-dark">
              {uploading ? "Analisi del documento…" : t("uploadDocument")}
            </span>
            <span className="mt-1 block text-xs text-ink-soft">
              PDF, JPG, PNG, WEBP, HEIC, DOCX — max. 25 MB
            </span>
          </label>

          {/* Manual entry is architected for but not built in Phase 1. Shown
              disabled rather than hidden, so the path is discoverable. */}
          <div className="rounded-xl border border-ink/10 bg-surface-soft px-4 py-4 text-center">
            <span className="text-base font-semibold text-ink/40">{t("manualEntry")}</span>
            <span className="ml-2 rounded-md bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink/50">
              {t("comingSoon")}
            </span>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-state-danger-soft p-3 text-sm font-medium text-state-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------- step 3
  return (
    <OrderReviewForm
      analysis={analysis!}
      customerMatch={customerMatch}
      documentId={documentId}
      sourceType={sourceType}
      plannedDate={plannedDate}
      onBack={() => setStep("method")}
      onSaved={(orderId) => {
        router.push(`/admin?created=${orderId}`);
        router.refresh();
      }}
    />
  );
}
