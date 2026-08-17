"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button";
import { errorMessage, t } from "@/lib/i18n/logistics";
import type { CustomerLocationRow, CustomerRow } from "@/lib/types/logistics";

/**
 * Company + delivery locations editor.
 *
 * A company can have many branches (Vicenza / Padova / Verona). Editing one
 * location never touches another, and nothing here is driven by document
 * import — this is the deliberate, human-controlled path for master data.
 */

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

interface LocationDraft {
  location_name: string;
  recipient_name: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  province: string;
  phone: string;
  email: string;
  delivery_notes: string;
}

function toDraft(location: CustomerLocationRow): LocationDraft {
  return {
    location_name: location.location_name ?? "",
    recipient_name: location.recipient_name ?? "",
    address_line1: location.address_line1 ?? "",
    address_line2: location.address_line2 ?? "",
    postal_code: location.postal_code ?? "",
    city: location.city ?? "",
    province: location.province ?? "",
    phone: location.phone ?? "",
    email: location.email ?? "",
    delivery_notes: location.delivery_notes ?? "",
  };
}

const EMPTY_DRAFT: LocationDraft = {
  location_name: "",
  recipient_name: "",
  address_line1: "",
  address_line2: "",
  postal_code: "",
  city: "",
  province: "",
  phone: "",
  email: "",
  delivery_notes: "",
};

export function CustomerEditor({
  customer,
  locations,
}: {
  customer: CustomerRow;
  locations: CustomerLocationRow[];
}) {
  const router = useRouter();
  const [company, setCompany] = useState({
    name: customer.name,
    legal_name: customer.legal_name ?? "",
    vat_number: customer.vat_number ?? "",
    fiscal_code: customer.fiscal_code ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    notes: customer.notes ?? "",
  });
  const [drafts, setDrafts] = useState<Record<string, LocationDraft>>(() =>
    Object.fromEntries(locations.map((location) => [location.id, toDraft(location)]))
  );
  const [newLocation, setNewLocation] = useState<LocationDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send(url: string, method: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { ok: boolean; code?: string };
      if (!payload.ok) {
        setError(errorMessage(payload.code));
        return false;
      }
      setNotice("Salvat.");
      router.refresh();
      return true;
    } catch {
      setError(errorMessage("SAVE_FAILED"));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function nullable(value: string) {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }

  function locationBody(draft: LocationDraft) {
    return {
      location_name: nullable(draft.location_name),
      recipient_name: nullable(draft.recipient_name),
      address_line1: nullable(draft.address_line1),
      address_line2: nullable(draft.address_line2),
      postal_code: nullable(draft.postal_code),
      city: nullable(draft.city),
      province: nullable(draft.province),
      phone: nullable(draft.phone),
      email: nullable(draft.email),
      delivery_notes: nullable(draft.delivery_notes),
    };
  }

  function LocationFields({
    draft,
    onChange,
  }: {
    draft: LocationDraft;
    onChange: (patch: Partial<LocationDraft>) => void;
  }) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className={labelClass}>Denumire locație</label>
          <input className={inputClass} value={draft.location_name}
            onChange={(event) => onChange({ location_name: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Destinatar</label>
          <input className={inputClass} value={draft.recipient_name}
            onChange={(event) => onChange({ recipient_name: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>{t("address")}</label>
          <input className={inputClass} value={draft.address_line1}
            onChange={(event) => onChange({ address_line1: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>{t("postalCode")}</label>
          <input className={inputClass} value={draft.postal_code}
            onChange={(event) => onChange({ postal_code: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>{t("city")}</label>
          <input className={inputClass} value={draft.city}
            onChange={(event) => onChange({ city: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>{t("province")}</label>
          <input className={inputClass} value={draft.province}
            onChange={(event) => onChange({ province: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Telefon</label>
          <input className={inputClass} value={draft.phone}
            onChange={(event) => onChange({ phone: event.target.value })} />
        </div>
        <div>
          <label className={labelClass}>Email</label>
          <input className={inputClass} value={draft.email}
            onChange={(event) => onChange({ email: event.target.value })} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className={labelClass}>{t("deliveryNotes")}</label>
          <input className={inputClass} value={draft.delivery_notes}
            onChange={(event) => onChange({ delivery_notes: event.target.value })} />
        </div>
      </div>
    );
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
        <h2 className="text-base font-bold text-ink">Date firmă</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>{t("companyName")}</label>
            <input className={inputClass} value={company.name}
              onChange={(event) => setCompany({ ...company, name: event.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Denumire legală</label>
            <input className={inputClass} value={company.legal_name}
              onChange={(event) => setCompany({ ...company, legal_name: event.target.value })} />
          </div>
          <div>
            <label className={labelClass}>{t("vatNumber")}</label>
            <input className={inputClass} value={company.vat_number}
              onChange={(event) => setCompany({ ...company, vat_number: event.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Cod fiscal</label>
            <input className={inputClass} value={company.fiscal_code}
              onChange={(event) => setCompany({ ...company, fiscal_code: event.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input className={inputClass} value={company.email}
              onChange={(event) => setCompany({ ...company, email: event.target.value })} />
          </div>
          <div>
            <label className={labelClass}>Telefon</label>
            <input className={inputClass} value={company.phone}
              onChange={(event) => setCompany({ ...company, phone: event.target.value })} />
          </div>
        </div>

        <Button
          className="mt-4"
          disabled={busy === "company"}
          onClick={() =>
            send(`/api/admin/customers/${customer.id}`, "PATCH", {
              name: company.name.trim(),
              legal_name: nullable(company.legal_name),
              vat_number: nullable(company.vat_number),
              fiscal_code: nullable(company.fiscal_code),
              email: nullable(company.email),
              phone: nullable(company.phone),
              notes: nullable(company.notes),
            }, "company")
          }
        >
          {busy === "company" ? t("loading") : t("save")}
        </Button>
      </section>

      <section className="rounded-xl border border-ink/10 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-ink">{t("locations")}</h2>
          <Button
            variant="secondary"
            onClick={() => setNewLocation(newLocation ? null : { ...EMPTY_DRAFT })}
          >
            {newLocation ? t("cancel") : `+ ${t("addLocation")}`}
          </Button>
        </div>

        {newLocation && (
          <div className="mt-4 rounded-lg border-2 border-accent/30 bg-accent-light/30 p-4">
            <h3 className="mb-3 text-sm font-bold text-accent-dark">{t("addLocation")}</h3>
            <LocationFields
              draft={newLocation}
              onChange={(patch) => setNewLocation({ ...newLocation, ...patch })}
            />
            <Button
              className="mt-3"
              disabled={busy === "new" || !newLocation.address_line1.trim() || !newLocation.city.trim()}
              onClick={async () => {
                const created = await send(
                  `/api/admin/customers/${customer.id}/locations`,
                  "POST",
                  locationBody(newLocation),
                  "new"
                );
                if (created) setNewLocation(null);
              }}
            >
              {t("save")}
            </Button>
            {/* address_line1 and city are NOT NULL in the database. */}
            <p className="mt-2 text-xs text-ink-soft">Adresa și orașul sunt obligatorii.</p>
          </div>
        )}

        <div className="mt-4 space-y-4">
          {locations.length === 0 && !newLocation && (
            <p className="text-sm text-ink-soft">Nicio locație de livrare înregistrată.</p>
          )}

          {locations.map((location) => {
            const draft = drafts[location.id] ?? toDraft(location);
            return (
              <div key={location.id} className="rounded-lg border border-ink/10 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-bold text-ink">
                    {location.location_name || location.city}
                  </span>
                  {location.is_primary && (
                    <span className="rounded bg-accent-light px-2 py-0.5 text-xs font-semibold text-accent-dark">
                      Principală
                    </span>
                  )}
                </div>

                <LocationFields
                  draft={draft}
                  onChange={(patch) =>
                    setDrafts({ ...drafts, [location.id]: { ...draft, ...patch } })
                  }
                />

                <Button
                  variant="secondary"
                  className="mt-3"
                  disabled={busy === location.id}
                  onClick={() =>
                    send(
                      `/api/admin/customer-locations/${location.id}`,
                      "PATCH",
                      locationBody(draft),
                      location.id
                    )
                  }
                >
                  {busy === location.id ? t("loading") : t("save")}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
