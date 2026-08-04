import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { FloatingInput, FloatingTextarea } from "./FloatingField";
import { SeasonSelector } from "./SeasonSelector";
import { QuantitySelector } from "./QuantitySelector";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { isValidTyreDimension } from "../lib/validation";
import { Quantity, Season, Tyre } from "../lib/types";

interface TyreModalProps {
  open: boolean;
  mode: "add" | "edit";
  initialTyre: Tyre | null;
  onClose: () => void;
  onSave: (tyre: Omit<Tyre, "id">) => void;
}

interface DraftState {
  width: string;
  profile: string;
  rim: string;
  season: Season | null;
  quantity: Quantity;
  notes: string;
}

const EMPTY_DRAFT: DraftState = {
  width: "",
  profile: "",
  rim: "",
  season: null,
  quantity: 4,
  notes: "",
};

function onlyDigits(value: string) {
  return value.replace(/[^0-9]/g, "");
}

export function TyreModal({ open, mode, initialTyre, onClose, onSave }: TyreModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const widthRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLInputElement>(null);
  const rimRef = useRef<HTMLInputElement>(null);
  const seasonWrapperRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialTyre) {
      setDraft({
        width: initialTyre.width,
        profile: initialTyre.profile,
        rim: initialTyre.rim,
        season: initialTyre.season,
        quantity: initialTyre.quantity,
        notes: initialTyre.notes,
      });
    } else {
      setDraft(EMPTY_DRAFT);
    }
    setTouched({});
    setAttemptedSubmit(false);
  }, [open, initialTyre]);

  useFocusTrap(dialogRef, open, onClose);
  useBodyScrollLock(open);

  if (!open) return null;

  const widthValid = isValidTyreDimension(draft.width);
  const profileValid = isValidTyreDimension(draft.profile);
  const rimValid = isValidTyreDimension(draft.rim);
  const seasonValid = draft.season !== null;
  const canSubmit = widthValid && profileValid && rimValid && seasonValid;

  const showError = (field: string, valid: boolean) =>
    (touched[field] || attemptedSubmit) && !valid;

  const preview =
    draft.width || draft.profile || draft.rim
      ? `${draft.width || "—"} / ${draft.profile || "—"} R${draft.rim || "—"}`
      : null;

  function handleSubmit() {
    setAttemptedSubmit(true);
    if (!widthValid) {
      widthRef.current?.focus();
      return;
    }
    if (!profileValid) {
      profileRef.current?.focus();
      return;
    }
    if (!rimValid) {
      rimRef.current?.focus();
      return;
    }
    if (!seasonValid) {
      seasonWrapperRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
      return;
    }
    onSave({
      width: draft.width.trim(),
      profile: draft.profile.trim(),
      rim: draft.rim.trim(),
      season: draft.season,
      quantity: draft.quantity,
      notes: draft.notes.trim(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tyre-modal-title"
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-modal outline-none sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-ink/10 px-5 py-4 sm:px-6">
          <h2 id="tyre-modal-title" className="text-lg font-bold text-ink">
            {mode === "add" ? "Aggiungi pneumatico" : "Modifica pneumatico"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-surface-soft"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div>
            <span className="mb-2 block text-sm font-semibold text-ink">
              Misura pneumatico <span className="text-accent">*</span>
            </span>
            <div className="grid grid-cols-3 gap-2.5">
              <FloatingInput
                ref={widthRef}
                label="Larghezza"
                placeholder="225"
                inputMode="numeric"
                required
                value={draft.width}
                error={showError("width", widthValid) ? "Obbligatorio" : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, width: onlyDigits(e.target.value) }))}
                onBlur={() => setTouched((t) => ({ ...t, width: true }))}
              />
              <FloatingInput
                ref={profileRef}
                label="Profilo"
                placeholder="45"
                inputMode="numeric"
                required
                value={draft.profile}
                error={showError("profile", profileValid) ? "Obbligatorio" : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, profile: onlyDigits(e.target.value) }))}
                onBlur={() => setTouched((t) => ({ ...t, profile: true }))}
              />
              <FloatingInput
                ref={rimRef}
                label="Cerchio"
                placeholder="17"
                inputMode="numeric"
                required
                value={draft.rim}
                error={showError("rim", rimValid) ? "Obbligatorio" : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, rim: onlyDigits(e.target.value) }))}
                onBlur={() => setTouched((t) => ({ ...t, rim: true }))}
              />
            </div>
            {preview ? (
              <p className="mt-2.5 text-sm font-medium text-ink-soft">
                Anteprima: <span className="font-semibold text-ink">{preview}</span>
              </p>
            ) : null}
          </div>

          <div className="mt-6" ref={seasonWrapperRef}>
            <SeasonSelector
              value={draft.season}
              onChange={(season) => setDraft((d) => ({ ...d, season }))}
              error={showError("season", seasonValid) ? "Seleziona una stagione" : undefined}
            />
          </div>

          <div className="mt-6">
            <QuantitySelector
              value={draft.quantity}
              onChange={(quantity) => setDraft((d) => ({ ...d, quantity }))}
            />
          </div>

          <div className="mt-6">
            <FloatingTextarea
              label="Note o preferenze"
              placeholder="Marca preferita, Runflat, XL, omologazione specifica…"
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-ink/10 bg-surface-soft px-5 py-4 sm:px-6">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annulla
          </Button>
          <Button type="button" onClick={handleSubmit} visuallyDisabled={!canSubmit}>
            {mode === "add" ? "Aggiungi pneumatico" : "Salva modifiche"}
          </Button>
        </div>
      </div>
    </div>
  );
}
