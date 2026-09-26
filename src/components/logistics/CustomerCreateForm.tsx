"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { useTr } from "@/lib/i18n/tr";

/**
 * Creates a customer company from the customers list.
 *
 * WHY THIS EXISTS. Until now a customer could only come into being as a side
 * effect of the logistics document flow. After production was reset there
 * were no customers at all, so the customer detail page — and the portal
 * access panel on it — could not be reached by any path. This is the direct,
 * human-controlled path for creating master data.
 *
 * Deliberately minimal: the company name is required, the fiscal identifiers
 * and contacts are optional, and the operator lands on the new customer's
 * page to add a delivery location and grant portal access.
 */
const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-base text-ink outline-none focus:border-accent sm:text-sm";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

export function CustomerCreateForm() {
  const tr = useTr();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", legal_name: "", vat_number: "", fiscal_code: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()])
      );
      const r = await fetch("/api/admin/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.customer?.id) throw new Error(j.code || `HTTP ${r.status}`);
      router.push(`/admin/customers/${j.customer.id}`);
      router.refresh();
    } catch (err) {
      setError(`${tr("Creazione non riuscita.")} (${err instanceof Error ? err.message : ""})`);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>{tr("Nuovo cliente")}</Button>
    );
  }

  const fields: [keyof typeof form, string, boolean][] = [
    ["name", "Nome azienda", true],
    ["legal_name", "Ragione sociale", false],
    ["vat_number", "P. IVA", false],
    ["fiscal_code", "Codice fiscale", false],
    ["email", "Email", false],
    ["phone", "Telefono", false],
  ];

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-ink/10 bg-white p-5 shadow-card">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">{tr("Nuovo cliente")}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, required]) => (
          <div key={key}>
            <label className={labelClass} htmlFor={`new-customer-${key}`}>
              {tr(label)}
              {required && <span className="ml-0.5 text-state-danger">*</span>}
            </label>
            <input
              id={`new-customer-${key}`}
              className={inputClass}
              required={required}
              type={key === "email" ? "email" : "text"}
              value={form[key]}
              onChange={set(key)}
            />
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-state-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !form.name.trim()}>
          {busy ? tr("Creazione…") : tr("Crea cliente")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          {tr("Annulla")}
        </Button>
      </div>
    </form>
  );
}
