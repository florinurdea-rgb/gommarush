"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalHeader } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { OrderReviewForm } from "@/components/logistics/OrderReviewForm";
import { UploadOrderPanel } from "@/components/logistics/UploadOrderPanel";
import { emptyResult } from "@/lib/documents/analyzer";
import { ddtDocumentToAnalysisResult } from "@/lib/ddt-import/to-analysis-result";
import type { ProcessedDocumentWithMatch } from "@/lib/ddt-import/client-helpers";
import { useTr } from "@/lib/i18n/tr";

/**
 * "Nuovo ordine" now opens here first: a choice between manual entry and
 * document upload, labelled in both Romanian and Italian per the brief
 * (the warehouse floor mixes both). Manual entry reuses OrderReviewForm —
 * it's callback-driven, not navigation-owning, so an empty AnalysisResult
 * turns it into a bare manual-entry form with no code duplicated. Upload
 * reuses the same analyze/confirm pipeline as /admin/orders/import via
 * UploadOrderPanel, just inside a modal with a loading bar instead of a
 * full page.
 */

type Step = "choice" | "manual" | "upload" | "edit";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewOrderModal({ onClose }: { onClose: () => void }) {
  const tr = useTr();
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>("choice");
  const [editingDoc, setEditingDoc] = useState<{
    doc: ProcessedDocumentWithMatch;
    sourceDocumentId: string;
  } | null>(null);

  return (
    <Modal onClose={onClose} size={step === "choice" ? "md" : "xl"} label={tr("Nuovo ordine")}>
      <ModalHeader title={tr("Nuovo ordine")} onClose={onClose} />
      <div className="p-6">
        {step === "choice" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep("manual")}
              className="rounded-xl border-2 border-ink/10 bg-white px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-light"
            >
              <div className="text-base font-bold text-ink">{tr("Aggiungi manualmente")}</div>
              <div className="mt-0.5 text-sm text-ink-soft">{tr("Aggiungi manualmente")}</div>
            </button>
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="rounded-xl border-2 border-ink/10 bg-white px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-light"
            >
              <div className="text-base font-bold text-ink">{tr("Carica documento")}</div>
              <div className="mt-0.5 text-sm text-ink-soft">{tr("Carica documento")}</div>
            </button>
          </div>
        )}

        {step === "manual" && (
          <OrderReviewForm
            analysis={emptyResult("analysed", "manual", [])}
            customerMatch={null}
            documentId={null}
            sourceType="manual"
            plannedDate={todayIso()}
            onBack={() => setStep("choice")}
            onSaved={(orderId) => {
              onClose();
              showToast(tr("Ordine aggiunto in Da assegnare."), "success");
              router.push(`/admin?created=${orderId}`);
              router.refresh();
            }}
          />
        )}

        {/* Kept mounted (just hidden) while "edit" is active, so a detour to
            fix one document never loses the rest of an already-analyzed
            batch — unmounting would reset UploadOrderPanel's own state. */}
        {(step === "upload" || step === "edit") && (
          <div className={step === "upload" ? "" : "hidden"}>
            <UploadOrderPanel
              onBack={() => setStep("choice")}
              onDone={(createdCount, droppedLineCount) => {
                onClose();
                const base =
                  createdCount === 1
                    ? tr("1 ordine aggiunto in Da assegnare.")
                    : `${createdCount} ordini aggiunti in Da assegnare.`;
                const dropped =
                  droppedLineCount > 0
                    ? ` ${droppedLineCount} ${droppedLineCount === 1 ? "riga non aggiunta" : tr("righe non aggiunte")} (quantità non leggibile) — inserisci manualmente.`
                    : "";
                showToast(base + dropped, "success");
                router.refresh();
              }}
              onEditDocument={(doc, sourceDocumentId) => {
                setEditingDoc({ doc, sourceDocumentId });
                setStep("edit");
              }}
            />
          </div>
        )}

        {step === "edit" && editingDoc && (
          <OrderReviewForm
            analysis={ddtDocumentToAnalysisResult(editingDoc.doc)}
            customerMatch={editingDoc.doc.customerMatch}
            documentId={editingDoc.sourceDocumentId}
            sourceType="pdf"
            plannedDate={todayIso()}
            onBack={() => setStep("upload")}
            onSaved={(orderId) => {
              onClose();
              showToast(tr("Ordine aggiunto in Da assegnare."), "success");
              router.push(`/admin?created=${orderId}`);
              router.refresh();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
