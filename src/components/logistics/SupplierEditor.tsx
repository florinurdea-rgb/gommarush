"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import type { SupplierRow } from "@/lib/types/logistics";
import { useTr } from "@/lib/i18n/tr";

/**
 * Supplier profile editor — a flat form (no locations, unlike customers):
 * a supplier ships FROM one place, so there's nothing branch-like to model.
 */

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function SupplierEditor({ supplier }: { supplier: SupplierRow }) {
  const tr = useTr();
  const router = useRouter();
  const [fields, setFields] = useState({
    name: supplier.name,
    legal_name: supplier.legal_name ?? "",
    vat_number: supplier.vat_number ?? "",
    fiscal_code: supplier.fiscal_code ?? "",
    website: supplier.website ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    notes: supplier.notes ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/suppliers/${supplier.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: fields.name.trim(),
          legal_name: nullable(fields.legal_name),
          vat_number: nullable(fields.vat_number),
          fiscal_code: nullable(fields.fiscal_code),
          website: nullable(fields.website),
          email: nullable(fields.email),
          phone: nullable(fields.phone),
          notes: nullable(fields.notes),
        }),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };
      if (payload.ok) {
        setNotice(tr("Fornitore salvato."));
        router.refresh();
      } else {
        setError(`Salvataggio non completato (${payload.code ?? tr("errore sconosciuto")}).`);
      }
    } catch {
      setError(tr("Errore di rete. Riprova."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {(error || notice) && (
        <p
          role="alert"
          className={`rounded-lg p-3 text-sm font-medium ${
            error ? "bg-state-danger-soft text-state-danger" : "bg-state-success-soft text-state-success"
          }`}
        >
          {error ?? notice}
        </p>
      )}

      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
        <h2 className="text-base font-bold text-ink">{tr("Dati fornitore")}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>Denumire</label>
            <input
              className={inputClass}
              value={fields.name}
              onChange={(event) => setFields({ ...fields, name: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{tr("Ragione sociale")}</label>
            <input
              className={inputClass}
              value={fields.legal_name}
              onChange={(event) => setFields({ ...fields, legal_name: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>P.IVA / CIF</label>
            <input
              className={inputClass}
              value={fields.vat_number}
              onChange={(event) => setFields({ ...fields, vat_number: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{tr("Codice fiscale")}</label>
            <input
              className={inputClass}
              value={fields.fiscal_code}
              onChange={(event) => setFields({ ...fields, fiscal_code: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <input
              className={inputClass}
              value={fields.website}
              onChange={(event) => setFields({ ...fields, website: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>{tr("Email")}</label>
            <input
              className={inputClass}
              value={fields.email}
              onChange={(event) => setFields({ ...fields, email: event.target.value })}
            />
          </div>
          <div>
            <label className={labelClass}>Telefon</label>
            <input
              className={inputClass}
              value={fields.phone}
              onChange={(event) => setFields({ ...fields, phone: event.target.value })}
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass}>Note</label>
            <textarea
              className={`${inputClass} h-24 resize-y py-2`}
              value={fields.notes}
              onChange={(event) => setFields({ ...fields, notes: event.target.value })}
            />
          </div>
        </div>

        <Button className="mt-4" disabled={busy} onClick={() => void save()}>
          {busy ? "Salvataggio…" : tr("Salva")}
        </Button>
      </section>
    </div>
  );
}
