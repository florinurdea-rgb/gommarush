"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { LinkButton } from "@/components/LinkButton";
import { Button } from "@/components/Button";
import { FloatingInput, FloatingSelect, FloatingTextarea } from "@/components/FloatingField";
import { TyreModal } from "@/components/TyreModal";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TyreCard } from "@/components/TyreCard";
import { isValidEmailOrPhone } from "@/lib/validation/tyre-form";
import { DELIVERY_LABELS, toRequestedTyre, Tyre } from "@/lib/types/ui";
import type { DeliveryPreference } from "@/lib/types/ui";
import type {
  CreateOfferRequestPayload,
  CreateOfferRequestResponse,
} from "@/lib/types/offer-request";
import { OFFER_CONFIRMATION_STORAGE_KEY } from "@/lib/offer-confirmation-storage";

function createId() {
  return `tyre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function GetOfferPage() {
  const router = useRouter();

  const [companyName, setCompanyName] = useState("");
  const [contact, setContact] = useState("");
  const [deliveryPreference, setDeliveryPreference] = useState<DeliveryPreference>("any");
  const [tyres, setTyres] = useState<Tyre[]>([]);
  const [customerMessage, setCustomerMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot, must stay empty

  const [contactTouched, setContactTouched] = useState(false);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [editingTyreId, setEditingTyreId] = useState<string | null>(null);

  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const contactRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  const contactValid = isValidEmailOrPhone(contact);
  const hasTyres = tyres.length > 0;
  const canSubmit = contactValid && hasTyres;
  const showContactError = (contactTouched || attemptedSubmit) && !contactValid;

  const editingTyre = editingTyreId ? tyres.find((t) => t.id === editingTyreId) ?? null : null;

  function openAddModal() {
    setModalMode("add");
    setEditingTyreId(null);
    setModalOpen(true);
  }

  function openEditModal(id: string) {
    setModalMode("edit");
    setEditingTyreId(id);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingTyreId(null);
  }

  function handleSaveTyre(data: Omit<Tyre, "id">) {
    if (modalMode === "edit" && editingTyreId) {
      setTyres((prev) => prev.map((t) => (t.id === editingTyreId ? { ...data, id: t.id } : t)));
    } else {
      setTyres((prev) => [...prev, { ...data, id: createId() }]);
    }
    setModalOpen(false);
    setEditingTyreId(null);
  }

  function confirmDelete() {
    if (!deleteTargetId) return;
    setTyres((prev) => prev.filter((t) => t.id !== deleteTargetId));
    setDeleteTargetId(null);
  }

  async function handleSubmitRequest() {
    setAttemptedSubmit(true);
    if (!contactValid) {
      contactRef.current?.focus();
      return;
    }
    if (!hasTyres || submitting) {
      return;
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }

    setSubmitting(true);
    setSubmitError(false);

    const payload: CreateOfferRequestPayload = {
      companyName: companyName.trim() || undefined,
      contact: contact.trim(),
      deliveryPreference,
      tyres: tyres.map(toRequestedTyre),
      customerMessage: customerMessage.trim() || undefined,
      idempotencyKey: idempotencyKeyRef.current,
      website,
    };

    try {
      const res = await fetch("/api/offer-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data: CreateOfferRequestResponse = await res.json();

      if (!res.ok || !data.success) {
        throw new Error("REQUEST_FAILED");
      }

      sessionStorage.setItem(
        OFFER_CONFIRMATION_STORAGE_KEY,
        JSON.stringify({
          requestNumber: data.requestNumber,
          emailSent: data.emailSent,
          summary: data.summary,
        })
      );

      // Only clear the form once the server has confirmed the row is saved.
      setCompanyName("");
      setContact("");
      setDeliveryPreference("any");
      setTyres([]);
      setCustomerMessage("");
      setAttemptedSubmit(false);
      idempotencyKeyRef.current = null;

      router.push("/request-confirmation");
    } catch {
      setSubmitting(false);
      setSubmitError(true);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-soft pb-32 sm:pb-28">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex w-full max-w-content flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-4">
            <Logo />
            <span aria-hidden="true" className="hidden h-8 w-px bg-ink/10 sm:block" />
            <h1 className="text-lg font-bold text-ink sm:text-xl">Richiedi un&rsquo;offerta</h1>
          </div>
          <LinkButton href="/" variant="secondary" size="md">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path
                d="M4 10.5l6-6 6 6M6 9v6.5a1 1 0 001 1h1.5v-4h3v4H13a1 1 0 001-1V9"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Home
          </LinkButton>
        </div>
      </header>

      <main className="mx-auto w-full max-w-content flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <p className="max-w-xl text-base text-ink-soft">
          Inserisci i tuoi dati e gli pneumatici che ti servono. Ti ricontatteremo con la
          migliore offerta disponibile.
        </p>

        <section aria-labelledby="contact-section-title" className="mt-8">
          <h2 id="contact-section-title" className="sr-only">
            Dati di contatto
          </h2>
          <div className="flex flex-col gap-4">
            <FloatingInput
              label="Nome dell'azienda"
              placeholder="Autofficina Verona"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={150}
            />
            <FloatingInput
              ref={contactRef}
              label="Email o telefono di contatto"
              required
              value={contact}
              error={
                showContactError
                  ? "Inserisci un indirizzo email o un numero di telefono valido."
                  : undefined
              }
              onChange={(e) => setContact(e.target.value)}
              onBlur={() => setContactTouched(true)}
              maxLength={200}
            />
            <FloatingSelect
              label="Preferenza di consegna"
              value={deliveryPreference}
              onChange={(e) => setDeliveryPreference(e.target.value as DeliveryPreference)}
            >
              {(Object.entries(DELIVERY_LABELS) as [DeliveryPreference, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </FloatingSelect>
          </div>
        </section>

        <section aria-labelledby="tyres-section-title" className="mt-9">
          <h2 id="tyres-section-title" className="sr-only">
            Pneumatici richiesti
          </h2>
          <Button type="button" variant="secondary" size="lg" onClick={openAddModal} className="w-full sm:w-auto">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Aggiungi pneumatico
          </Button>

          {hasTyres ? (
            <div className="mt-7">
              <h3 className="text-base font-bold text-ink">I miei pneumatici</h3>
              <ul className="mt-3 flex flex-col gap-3">
                {tyres.map((tyre) => (
                  <TyreCard
                    key={tyre.id}
                    tyre={tyre}
                    onEdit={() => openEditModal(tyre.id)}
                    onDelete={() => setDeleteTargetId(tyre.id)}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section aria-labelledby="message-section-title" className="mt-9">
          <h2 id="message-section-title" className="sr-only">
            Messaggio
          </h2>
          <FloatingTextarea
            label="Messaggio per il fornitore (opzionale)"
            placeholder="Contattatemi nel pomeriggio, orari di consegna preferiti, ecc."
            value={customerMessage}
            onChange={(e) => setCustomerMessage(e.target.value)}
            maxLength={1000}
          />
        </section>

        {/* Honeypot: real users never see or fill this in. */}
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", top: 0, width: 1, height: 1, overflow: "hidden" }}
        >
          <label htmlFor="website">Lascia questo campo vuoto</label>
          <input
            type="text"
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
      </main>

      <TyreModal
        open={modalOpen}
        mode={modalMode}
        initialTyre={editingTyre}
        onClose={closeModal}
        onSave={handleSaveTyre}
      />

      <ConfirmDialog
        open={deleteTargetId !== null}
        title="Vuoi rimuovere questo pneumatico dalla richiesta?"
        onCancel={() => setDeleteTargetId(null)}
        onConfirm={confirmDelete}
      />

      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {submitError ? (
          <div
            role="alert"
            className="mx-auto flex w-full max-w-content flex-col gap-2 px-4 pt-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <span className="text-red-600">
              Non è stato possibile inviare la richiesta. Controlla i dati e riprova.
            </span>
            <button
              type="button"
              onClick={handleSubmitRequest}
              className="self-start font-semibold text-accent underline decoration-2 underline-offset-2 hover:text-accent-dark sm:self-auto"
            >
              Riprova
            </button>
          </div>
        ) : null}
        <div className="mx-auto w-full max-w-content px-4 py-3 sm:px-6">
          <Button
            type="button"
            size="lg"
            className="w-full"
            visuallyDisabled={!canSubmit || submitting}
            disabled={submitting}
            onClick={handleSubmitRequest}
          >
            {submitting ? "Invio in corso…" : "Invia richiesta di offerta"}
          </Button>
          {attemptedSubmit && !hasTyres ? (
            <p role="alert" className="mt-2 text-center text-sm text-red-600">
              Aggiungi almeno un pneumatico prima di inviare la richiesta.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
