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
import type { OptionRef } from "@/components/logistics/NewOrderFlow";
import type { StandCode } from "@/lib/types/logistics";

/**
 * "Comandă nouă" now opens here first: a choice between manual entry and
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

export function NewOrderModal({
  drivers,
  vehicles,
  availableStands,
  onClose,
}: {
  drivers: OptionRef[];
  vehicles: OptionRef[];
  availableStands: StandCode[];
  onClose: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>("choice");
  const [editingDoc, setEditingDoc] = useState<{
    doc: ProcessedDocumentWithMatch;
    sourceDocumentId: string;
  } | null>(null);

  return (
    <Modal onClose={onClose} size={step === "choice" ? "md" : "xl"} label="Comandă nouă / Nuovo ordine">
      <ModalHeader title="Comandă nouă / Nuovo ordine" onClose={onClose} />
      <div className="p-6">
        {step === "choice" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep("manual")}
              className="rounded-xl border-2 border-ink/10 bg-white px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-light"
            >
              <div className="text-base font-bold text-ink">Adaugă manual</div>
              <div className="mt-0.5 text-sm text-ink-soft">Aggiungi manualmente</div>
            </button>
            <button
              type="button"
              onClick={() => setStep("upload")}
              className="rounded-xl border-2 border-ink/10 bg-white px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-light"
            >
              <div className="text-base font-bold text-ink">Încarcă document</div>
              <div className="mt-0.5 text-sm text-ink-soft">Carica documento</div>
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
            drivers={drivers}
            vehicles={vehicles}
            availableStands={availableStands}
            onBack={() => setStep("choice")}
            onSaved={(orderId) => {
              onClose();
              showToast("Comandă adăugată în Așteaptă asignare.", "success");
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
              onDone={(createdCount) => {
                onClose();
                showToast(
                  createdCount === 1
                    ? "1 comandă adăugată în Așteaptă asignare."
                    : `${createdCount} comenzi adăugate în Așteaptă asignare.`,
                  "success"
                );
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
            drivers={drivers}
            vehicles={vehicles}
            availableStands={availableStands}
            onBack={() => setStep("upload")}
            onSaved={(orderId) => {
              onClose();
              showToast("Comandă adăugată în Așteaptă asignare.", "success");
              router.push(`/admin?created=${orderId}`);
              router.refresh();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
