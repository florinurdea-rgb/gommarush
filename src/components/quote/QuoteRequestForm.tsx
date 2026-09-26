"use client";

import { useRef, useState } from "react";
import { useLocale } from "@/components/site/LocaleProvider";
import { Field, inputClass, inputErrorClass } from "@/components/quote/controls";
import { QuoteItemEditor } from "@/components/quote/QuoteItemEditor";
import { QuoteItemSummary } from "@/components/quote/QuoteItemSummary";
import { SubmissionSuccess } from "@/components/quote/SubmissionSuccess";
import {
  draftToPayload,
  hasErrors,
  newDraftItem,
  validateDraft,
  type DraftErrors,
  type DraftItem,
} from "@/components/quote/item-model";
import type { CreateQuoteRequestResponse } from "@/lib/types/quote-request";

/**
 * The whole customer-facing quote flow.
 *
 * Item model: exactly one item is "open" in the editor at a time; committed
 * items collapse to summaries. Editing an existing item pulls it back into
 * the editor and updates in place rather than appending a duplicate.
 *
 * Submission is guarded three ways against duplicates: the button disables
 * itself, a ref blocks re-entry even if a second event slips through, and a
 * stable idempotency key means the server returns the SAME request if the
 * request is genuinely retried.
 */

type Phase = "editing" | "submitting" | "success";

function makeIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QuoteRequestForm() {
  const { locale, copy } = useLocale();

  const [committed, setCommitted] = useState<DraftItem[]>([]);
  // Start with one open tyre form — never a blank empty list.
  const [draft, setDraft] = useState<DraftItem | null>(() => newDraftItem("tyre"));
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [itemErrors, setItemErrors] = useState<DraftErrors>({});

  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [whatsapp, setWhatsapp] = useState("");
  const [contactErrors, setContactErrors] = useState<{
    companyName?: string;
    email?: string;
    whatsapp?: string;
    items?: string;
  }>({});

  const [phase, setPhase] = useState<Phase>("editing");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<{ reference: string } | null>(null);
  const [undoItem, setUndoItem] = useState<{ item: DraftItem; index: number } | null>(null);

  // Survives re-renders; the idempotency key must stay stable across retries
  // of the SAME logical submission so the server can dedupe it.
  const idempotencyKey = useRef<string>(makeIdempotencyKey());
  const inFlight = useRef(false);

  const itemsSectionRef = useRef<HTMLDivElement>(null);
  const contactSectionRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  function patchDraft(patch: Partial<DraftItem>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    // Clear the errors for whatever the user just touched.
    setItemErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as (keyof DraftItem)[]) delete next[key];
      return next;
    });
  }

  function commitDraft() {
    if (!draft) return;
    const errors = validateDraft(draft, copy);
    setItemErrors(errors);
    if (hasErrors(errors)) {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (editingKey) {
      setCommitted((current) => current.map((item) => (item.key === editingKey ? draft : item)));
      setEditingKey(null);
    } else {
      setCommitted((current) => [...current, draft]);
    }

    setDraft(null);
    setItemErrors({});
    setContactErrors((current) => ({ ...current, items: undefined }));
  }

  function editItem(key: string) {
    const target = committed.find((item) => item.key === key);
    if (!target) return;
    // If something is already open, keep it — commit or cancel first.
    if (draft && !editingKey) return;
    setDraft(target);
    setEditingKey(key);
    setItemErrors({});
    requestAnimationFrame(() =>
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
  }

  function removeItem(key: string) {
    const index = committed.findIndex((item) => item.key === key);
    if (index === -1) return;
    const removed = committed[index];
    setCommitted((current) => current.filter((item) => item.key !== key));
    // Removal is instant but reversible for a few seconds, rather than
    // hidden behind a modal confirmation on every single tap.
    setUndoItem({ item: removed, index });
    window.setTimeout(() => {
      setUndoItem((current) => (current?.item.key === key ? null : current));
    }, 6000);
  }

  function undoRemove() {
    if (!undoItem) return;
    setCommitted((current) => {
      const next = [...current];
      next.splice(Math.min(undoItem.index, next.length), 0, undoItem.item);
      return next;
    });
    setUndoItem(null);
  }

  function startNewItem() {
    setDraft(newDraftItem("tyre"));
    setEditingKey(null);
    setItemErrors({});
    requestAnimationFrame(() =>
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    );
  }

  function validateContact() {
    const errors: typeof contactErrors = {};
    if (!companyName.trim()) errors.companyName = copy.errCompany;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = copy.errEmail;
    if (whatsappOpen && whatsapp.trim()) {
      const cleaned = whatsapp.replace(/[\s().-]/g, "");
      if (!/^\+?\d{7,15}$/.test(cleaned)) errors.whatsapp = copy.errWhatsapp;
    }
    if (committed.length === 0) errors.items = copy.errNoItems;
    // An unfinished open editor is a real ambiguity — resolve it explicitly.
    if (draft) errors.items = copy.errItemIncomplete;
    return errors;
  }

  async function submit() {
    if (inFlight.current) return;

    const errors = validateContact();
    setContactErrors(errors);
    if (Object.keys(errors).length > 0) {
      const target = errors.items ? itemsSectionRef.current : contactSectionRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    inFlight.current = true;
    setPhase("submitting");
    setSubmitError(null);

    try {
      const response = await fetch("/api/quote-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          email: email.trim(),
          whatsapp: whatsappOpen && whatsapp.trim() ? whatsapp.trim() : null,
          notes: notes.trim() || null,
          language: locale,
          items: committed.map(draftToPayload),
          idempotencyKey: idempotencyKey.current,
        }),
      });

      const payload = (await response.json()) as CreateQuoteRequestResponse;

      if (!payload.success) {
        // Everything the customer typed stays exactly where it is.
        setSubmitError(copy.failBody);
        setPhase("editing");
        return;
      }

      setResult({ reference: payload.reference });
      setPhase("success");
    } catch {
      setSubmitError(copy.failBody);
      setPhase("editing");
    } finally {
      inFlight.current = false;
    }
  }

  function resetForAnother() {
    setNotes("");
    setCommitted([]);
    setDraft(newDraftItem("tyre"));
    setEditingKey(null);
    setItemErrors({});
    setCompanyName("");
    setEmail("");
    setWhatsapp("");
    setWhatsappOpen(false);
    setContactErrors({});
    setResult(null);
    setSubmitError(null);
    // A genuinely new request needs a new key, or the server would replay
    // the previous one and hand back the old request number.
    idempotencyKey.current = makeIdempotencyKey();
    setPhase("editing");
  }

  if (phase === "success" && result) {
    return (
      <SubmissionSuccess
        reference={result.reference}
        email={email.trim()}
        whatsapp={whatsappOpen && whatsapp.trim() ? whatsapp.trim() : null}
        onNewRequest={resetForAnother}
      />
    );
  }

  const submitting = phase === "submitting";

  return (
    <div className="space-y-8 pb-8">
      {/* ------------------------------------------------------- products */}
      <section ref={itemsSectionRef} aria-labelledby="quote-items-title">
        <h2 id="quote-items-title" className="sr-only">
          {copy.productType}
        </h2>

        {committed.length > 0 && (
          <ul className="mb-4 space-y-2">
            {committed.map((item) => (
              <QuoteItemSummary
                key={item.key}
                item={item}
                onEdit={() => editItem(item.key)}
                onRemove={() => removeItem(item.key)}
              />
            ))}
          </ul>
        )}

        {undoItem && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-ink/10 bg-ink px-4 py-3 text-sm text-white"
          >
            <span>{copy.itemRemoved}</span>
            <button
              type="button"
              onClick={undoRemove}
              className="min-h-11 font-bold text-white underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {copy.undo}
            </button>
          </div>
        )}

        <div ref={editorRef}>
          {draft ? (
            <QuoteItemEditor
              item={draft}
              errors={itemErrors}
              onChange={patchDraft}
              onCommit={commitDraft}
              isEditing={editingKey !== null}
              onCancel={
                committed.length > 0
                  ? () => {
                      setDraft(null);
                      setEditingKey(null);
                      setItemErrors({});
                    }
                  : undefined
              }
            />
          ) : (
            <button
              type="button"
              onClick={startNewItem}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-dashed border-accent/40 bg-accent-light/30 px-5 text-base font-bold text-accent-dark transition-colors hover:border-accent hover:bg-accent-light focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {copy.addAnother}
            </button>
          )}
        </div>

        {contactErrors.items && (
          <p role="alert" className="mt-3 text-sm font-semibold text-state-danger">
            {contactErrors.items}
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- contact */}
      <section ref={contactSectionRef} aria-labelledby="quote-contact-title">
        <h2 id="quote-contact-title" className="mb-4 text-lg font-bold text-ink">
          {copy.yourDetails}
        </h2>

        <div className="space-y-4 rounded-2xl border border-ink/10 bg-white p-4 sm:p-5">
          <Field label={copy.company} htmlFor="quote-company" error={contactErrors.companyName}>
            <input
              id="quote-company"
              type="text"
              autoComplete="organization"
              placeholder={copy.companyPlaceholder}
              aria-invalid={contactErrors.companyName ? true : undefined}
              aria-describedby={contactErrors.companyName ? "quote-company-error" : undefined}
              value={companyName}
              onChange={(event) => {
                setCompanyName(event.target.value);
                setContactErrors((current) => ({ ...current, companyName: undefined }));
              }}
              className={contactErrors.companyName ? inputErrorClass : inputClass}
            />
          </Field>

          <Field
            label={copy.email}
            htmlFor="quote-email"
            hint={copy.emailHelp}
            error={contactErrors.email}
          >
            <input
              id="quote-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={copy.emailPlaceholder}
              aria-invalid={contactErrors.email ? true : undefined}
              aria-describedby={contactErrors.email ? "quote-email-error" : undefined}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setContactErrors((current) => ({ ...current, email: undefined }));
              }}
              className={contactErrors.email ? inputErrorClass : inputClass}
            />
          </Field>

          {/* WhatsApp is strictly additional — the offer always goes by email. */}
          <div className="border-t border-ink/10 pt-4">
            {!whatsappOpen ? (
              <button
                type="button"
                onClick={() => setWhatsappOpen(true)}
                className="min-h-11 text-sm font-semibold text-accent transition-colors hover:text-accent-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {copy.whatsappAdd}
              </button>
            ) : (
              <>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    {copy.whatsappTitle}
                  </span>
                  <span className="text-xs text-ink-soft">{copy.optional}</span>
                </div>
                <Field label={copy.whatsappLabel} htmlFor="quote-whatsapp" error={contactErrors.whatsapp}>
                  <input
                    id="quote-whatsapp"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+39 333 123 4567"
                    aria-invalid={contactErrors.whatsapp ? true : undefined}
                    aria-describedby={contactErrors.whatsapp ? "quote-whatsapp-error" : undefined}
                    value={whatsapp}
                    onChange={(event) => {
                      setWhatsapp(event.target.value);
                      setContactErrors((current) => ({ ...current, whatsapp: undefined }));
                    }}
                    className={contactErrors.whatsapp ? inputErrorClass : inputClass}
                  />
                </Field>
                <button
                  type="button"
                  onClick={() => {
                    setWhatsappOpen(false);
                    setWhatsapp("");
                    setContactErrors((current) => ({ ...current, whatsapp: undefined }));
                  }}
                  className="mt-2 min-h-11 text-sm font-semibold text-ink-soft transition-colors hover:text-state-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {copy.whatsappRemove}
                </button>
              </>
            )}
          </div>

          {/* Optional and last: a required note field would cost more
              submissions than the note is worth. */}
          <div className="mt-4">
            <Field label={copy.notesLabel} htmlFor="quote-notes" hint={copy.notesHint}>
              <textarea
                id="quote-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={copy.notesPlaceholder}
                className={`${inputClass} min-h-[88px] resize-y py-3 leading-relaxed`}
              />
            </Field>
          </div>
        </div>
      </section>

      {submitError && (
        <div role="alert" className="rounded-xl border border-state-danger/40 bg-state-danger-soft p-4">
          <p className="text-sm font-bold text-state-danger">{copy.failTitle}</p>
          <p className="mt-1 text-sm text-ink">{submitError}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        aria-busy={submitting}
        className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-accent px-8 text-lg font-bold text-white transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        {submitting ? copy.submitting : submitError ? copy.retry : copy.submit}
      </button>
    </div>
  );
}
