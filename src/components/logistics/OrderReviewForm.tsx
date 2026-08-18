"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { errorMessage, itemTypeLabel, t } from "@/lib/i18n/logistics";
import { ITEM_TYPES, STAND_CODES } from "@/lib/types/logistics";
import { totalUnitCount } from "@/lib/logistics/inventory-units";
import { mergeIdenticalProductLines } from "@/lib/logistics/product-normalise";
import type { AnalysisResult, ExtractedProductLine } from "@/lib/documents/analyzer";
import type { CustomerMatchResult, LocationResolution } from "@/lib/logistics/customer-matching";
import type { ItemType, StandCode } from "@/lib/types/logistics";
import type { OptionRef } from "@/components/logistics/NewOrderFlow";

/**
 * The review screen: everything extracted, fully editable, before anything is
 * written. Sections follow the brief — supplier, customer (with match status),
 * delivery location, payment, assignment, products.
 *
 * Two principles show up throughout:
 *   * a field the extractor could not read is EMPTY and flagged, never filled
 *     with a plausible guess
 *   * the customer/location decision is explicit; nothing overwrites master
 *     data unless the Admin picks "update existing location"
 */

interface EditableLine extends ExtractedProductLine {
  key: string;
  itemTypeValue: ItemType;
  quantityValue: number;
  /** Editor-local normalised text. `rawDescription` stays as extracted. */
  description?: string | null;
}

interface OrderReviewFormProps {
  analysis: AnalysisResult;
  customerMatch: CustomerMatchResult | null;
  documentId: string | null;
  sourceType: string;
  plannedDate: string;
  drivers: OptionRef[];
  vehicles: OptionRef[];
  availableStands: StandCode[];
  onBack: () => void;
  onSaved: (orderId: string) => void;
}

const inputClass =
  "h-11 w-full rounded-lg border border-ink/15 px-3 text-sm text-ink outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft";

function Section({
  title,
  description,
  children,
  tone,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "warning";
}) {
  return (
    <section
      className={`rounded-xl border bg-white p-5 shadow-card ${
        tone === "warning" ? "border-state-warning/40" : "border-ink/10"
      }`}
    >
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function toItemType(value: string | null | undefined): ItemType {
  return (ITEM_TYPES as readonly string[]).includes(value ?? "") ? (value as ItemType) : "other";
}

export function OrderReviewForm({
  analysis,
  customerMatch,
  documentId,
  sourceType,
  plannedDate,
  drivers,
  vehicles,
  availableStands,
  onBack,
  onSaved,
}: OrderReviewFormProps) {
  // --- Supplier ---------------------------------------------------------
  const [supplierName, setSupplierName] = useState(analysis.supplier.name ?? "");
  const [supplierVat, setSupplierVat] = useState(analysis.supplier.vatNumber ?? "");
  const [documentNumber, setDocumentNumber] = useState(analysis.supplier.documentNumber ?? "");
  const [documentDate, setDocumentDate] = useState(analysis.supplier.documentDate ?? "");
  const [supplierReference, setSupplierReference] = useState(
    analysis.supplier.orderReference ?? ""
  );

  // --- Customer ---------------------------------------------------------
  const matchedCustomer = customerMatch?.customer ?? null;
  const [useExistingCustomer, setUseExistingCustomer] = useState(Boolean(matchedCustomer));
  const [customerName, setCustomerName] = useState(
    analysis.customer.companyName ?? matchedCustomer?.name ?? ""
  );
  const [customerVat, setCustomerVat] = useState(analysis.customer.vatNumber ?? "");
  const [supplierCustomerCode, setSupplierCustomerCode] = useState(
    analysis.customer.supplierCustomerCode ?? ""
  );

  // --- Location ---------------------------------------------------------
  const matchedLocation = customerMatch?.location ?? null;
  const [resolution, setResolution] = useState<LocationResolution>(
    customerMatch?.allowedResolutions[0] ?? "add_as_new_location"
  );
  const [recipient, setRecipient] = useState(analysis.customer.deliveryRecipient ?? "");
  const [addressLine1, setAddressLine1] = useState(
    analysis.customer.addressLine1 ?? matchedLocation?.address_line1 ?? ""
  );
  const [city, setCity] = useState(analysis.customer.city ?? matchedLocation?.city ?? "");
  const [province, setProvince] = useState(
    analysis.customer.province ?? matchedLocation?.province ?? ""
  );
  const [postalCode, setPostalCode] = useState(
    analysis.customer.postalCode ?? matchedLocation?.postal_code ?? ""
  );
  const [deliveryNotes, setDeliveryNotes] = useState("");

  // --- Payment ----------------------------------------------------------
  const [requiresPayment, setRequiresPayment] = useState(
    analysis.payment.cashOnDelivery === true
  );
  const [amountToCollect, setAmountToCollect] = useState(
    analysis.payment.amountToCollect != null ? String(analysis.payment.amountToCollect) : ""
  );
  const [collectionMethod, setCollectionMethod] = useState(
    analysis.payment.collectionMethod ?? ""
  );
  const [paymentMethod, setPaymentMethod] = useState(analysis.payment.paymentMethod ?? "");

  // --- Assignment -------------------------------------------------------
  const [deliveryDate, setDeliveryDate] = useState(plannedDate);
  const [standCode, setStandCode] = useState<string>("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");

  // --- Products ---------------------------------------------------------
  const [lines, setLines] = useState<EditableLine[]>(() =>
    mergeIdenticalProductLines(analysis.products).map((product, index) => ({
      ...product,
      key: `line-${index}`,
      itemTypeValue: toItemType(product.itemType),
      quantityValue: product.quantity ?? 1,
    }))
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  const unitCount = useMemo(
    () =>
      totalUnitCount(
        lines.map((line) => ({ item_type: line.itemTypeValue, quantity: line.quantityValue }))
      ),
    [lines]
  );

  function updateLine(key: string, patch: Partial<EditableLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function addLine() {
    setLines((current) => [
      ...current,
      {
        key: `line-${Date.now()}`,
        rawDescription: "",
        itemTypeValue: "tyre",
        quantityValue: 1,
        reviewFields: [],
      } as EditableLine,
    ]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setDetails([]);

    try {
      const payload = {
        supplier_name: supplierName.trim() || "Furnizor necunoscut",
        supplier_vat_number: supplierVat.trim() || null,
        supplier_document_number: documentNumber.trim() || null,
        supplier_document_date: documentDate.trim() || null,
        supplier_reference: supplierReference.trim() || null,
        source_type: sourceType,

        customer_id: useExistingCustomer ? matchedCustomer?.id ?? null : null,
        new_customer: useExistingCustomer
          ? null
          : {
              name: customerName.trim(),
              vat_number: customerVat.trim() || null,
            },
        supplier_customer_code: supplierCustomerCode.trim() || null,

        customer_location_id: matchedLocation?.id ?? null,
        location_resolution: resolution,
        address: {
          recipient_name: recipient.trim() || null,
          address_line1: addressLine1.trim() || null,
          city: city.trim() || null,
          province: province.trim() || null,
          postal_code: postalCode.trim() || null,
          delivery_notes: deliveryNotes.trim() || null,
        },

        planned_delivery_date: deliveryDate || null,
        stand_code: standCode || null,
        auto_allocate_stand: !standCode,
        driver_id: driverId || null,
        vehicle_id: vehicleId || null,

        requires_payment_on_delivery: requiresPayment,
        payment_method: paymentMethod.trim() || null,
        amount_to_collect: amountToCollect ? Number(amountToCollect) : null,
        collection_method: collectionMethod.trim() || null,
        currency: analysis.payment.currency ?? "EUR",

        source_document_id: documentId,
        items: lines
          .filter((line) => line.rawDescription.trim() || line.description?.trim())
          .map((line) => ({
            item_type: line.itemTypeValue,
            quantity: Math.max(1, Math.trunc(line.quantityValue)),
            supplier_sku: line.supplierSku || null,
            // The document's own text is preserved as-is.
            raw_description: line.rawDescription || null,
            description: line.description || line.rawDescription || null,
            brand: line.brand || null,
            model: line.model || null,
            width: line.width ?? null,
            aspect_ratio: line.aspectRatio ?? null,
            rim_diameter: line.rimDiameter ?? null,
            load_index: line.loadIndex || null,
            speed_rating: line.speedRating || null,
            extra_load: line.extraLoad ?? null,
            run_flat: line.runFlat ?? null,
            unit_price: line.unitPrice ?? null,
            tax_rate: line.taxRate ?? null,
            pfu_fee: line.pfuFee ?? null,
            logistics_fee: line.logisticsFee ?? null,
            needs_review: (line.reviewFields ?? []).length > 0,
            review_fields: line.reviewFields ?? [],
            confidence: line.confidence ?? null,
          })),
      };

      const response = await fetch("/api/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        ok: boolean;
        code?: string;
        details?: string[];
        orderId?: string;
        standCode?: string | null;
        standWarning?: string | null;
        inventoryUnitCount?: number;
      };

      if (!result.ok || !result.orderId) {
        setError(errorMessage(result.code));
        setDetails(result.details ?? []);
        return;
      }

      // A stand may not have been available. Say so rather than letting the
      // Admin assume the order got one.
      if (result.standWarning) {
        window.alert(
          `${errorMessage(result.standWarning)}\n\nComanda a fost creată fără stativ. Alocă manual din pagina comenzii.`
        );
      }

      onSaved(result.orderId);
    } catch {
      setError(errorMessage("SAVE_FAILED"));
    } finally {
      setSaving(false);
    }
  }

  const matchTone =
    customerMatch?.kind === "match_confirmed"
      ? "success"
      : customerMatch?.kind === "possible_match"
        ? "warning"
        : "waiting";

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-semibold text-accent hover:underline"
      >
        ← {t("back")}
      </button>

      {/* Analysis status — honest about what was and wasn't read. */}
      {(analysis.status !== "analysed" || analysis.notes.length > 0) && (
        <div
          className={`rounded-xl border p-4 ${
            analysis.status === "analysed"
              ? "border-ink/10 bg-white"
              : "border-state-waiting/40 bg-state-waiting-soft"
          }`}
        >
          <p className="text-sm font-bold text-ink">
            {analysis.status === "unconfigured"
              ? t("analysisNotConfigured")
              : analysis.status === "failed"
                ? errorMessage("ANALYSIS_FAILED")
                : t("reviewBeforeSave")}
          </p>
          {analysis.notes.length > 0 && (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-ink-soft">
              {analysis.notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink-soft">
            Sursă: <span className="font-mono">{analysis.provider}</span>
          </p>
        </div>
      )}

      {/* ---------------------------------------------------------- Supplier */}
      <Section title={t("supplier")} description="Furnizorul și referința documentului.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="supplier-name">Nume furnizor</label>
            <input id="supplier-name" className={inputClass} value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="supplier-vat">P.IVA / Cod fiscal</label>
            <input id="supplier-vat" className={inputClass} value={supplierVat}
              onChange={(event) => setSupplierVat(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="doc-number">{t("documentReference")}</label>
            <input id="doc-number" className={inputClass} value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="doc-date">Data documentului</label>
            <input id="doc-date" type="date" className={inputClass} value={documentDate}
              onChange={(event) => setDocumentDate(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="supplier-ref">Referință comandă furnizor</label>
            <input id="supplier-ref" className={inputClass} value={supplierReference}
              onChange={(event) => setSupplierReference(event.target.value)} />
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- Customer */}
      <Section
        title={t("customer")}
        description="Clientul final al comenzii."
        tone={customerMatch?.requiresReview ? "warning" : undefined}
      >
        {customerMatch && (
          <div
            className={`mb-4 rounded-lg p-3 text-sm font-semibold ${
              matchTone === "success"
                ? "bg-state-success-soft text-state-success"
                : matchTone === "warning"
                  ? "bg-state-warning-soft text-state-warning"
                  : "bg-state-waiting-soft text-state-waiting"
            }`}
          >
            {customerMatch.kind === "match_confirmed" && t("matchConfirmed")}
            {customerMatch.kind === "possible_match" && t("possibleMatch")}
            {customerMatch.kind === "new_customer" && t("newCustomer")}
            {customerMatch.kind === "new_location" && t("newLocation")}
            {matchedCustomer && (
              <span className="ml-2 font-normal">
                → {matchedCustomer.name}
                {matchedCustomer.vat_number ? ` (${matchedCustomer.vat_number})` : ""}
              </span>
            )}
            {customerMatch.differences.length > 0 && (
              <div className="mt-1 font-normal">
                Diferențe: {customerMatch.differences.join(", ")}
              </div>
            )}
          </div>
        )}

        {matchedCustomer && (
          <div className="mb-4 flex flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="radio" checked={useExistingCustomer}
                onChange={() => setUseExistingCustomer(true)} />
              Folosește clientul existent
            </label>
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="radio" checked={!useExistingCustomer}
                onChange={() => setUseExistingCustomer(false)} />
              Creează client nou
            </label>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="customer-name">{t("companyName")}</label>
            <input id="customer-name" className={inputClass} value={customerName}
              disabled={useExistingCustomer}
              onChange={(event) => setCustomerName(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="customer-vat">{t("vatNumber")}</label>
            <input id="customer-vat" className={inputClass} value={customerVat}
              disabled={useExistingCustomer}
              onChange={(event) => setCustomerVat(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="customer-code">Cod client la furnizor</label>
            <input id="customer-code" className={inputClass} value={supplierCustomerCode}
              onChange={(event) => setSupplierCustomerCode(event.target.value)} />
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------- Delivery location */}
      <Section
        title={t("deliveryLocation")}
        description="Adresa la care se livrează această comandă."
      >
        {matchedLocation && (
          <div className="mb-4 rounded-lg border border-ink/10 bg-surface-soft p-3 text-sm">
            <div className="font-semibold text-ink">Locație existentă în baza de date</div>
            <div className="text-ink-soft">
              {matchedLocation.location_name ? `${matchedLocation.location_name} — ` : ""}
              {matchedLocation.address_line1}, {matchedLocation.postal_code} {matchedLocation.city}
              {matchedLocation.province ? ` (${matchedLocation.province})` : ""}
            </div>
          </div>
        )}

        {/* Never silently overwrite master data — this is an explicit choice. */}
        <fieldset className="mb-4">
          <legend className={labelClass}>Ce facem cu adresa din document?</legend>
          <div className="space-y-2">
            {(customerMatch?.allowedResolutions ?? ["add_as_new_location"]).map((option) => (
              <label key={option} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="resolution"
                  className="mt-1"
                  checked={resolution === option}
                  onChange={() => setResolution(option)}
                />
                <span>
                  {option === "use_existing" && "Folosește locația existentă"}
                  {option === "use_for_this_order_only" && t("useAddressForThisOrderOnly")}
                  {option === "add_as_new_location" && t("addAsNewLocation")}
                  {option === "update_existing_location" && t("updateExistingLocation")}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="recipient">Destinatar</label>
            <input id="recipient" className={inputClass} value={recipient}
              onChange={(event) => setRecipient(event.target.value)} />
          </div>
          <div className="lg:col-span-2">
            <label className={labelClass} htmlFor="address1">{t("address")}</label>
            <input id="address1" className={inputClass} value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="postal">{t("postalCode")}</label>
            <input id="postal" className={inputClass} value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="city">{t("city")}</label>
            <input id="city" className={inputClass} value={city}
              onChange={(event) => setCity(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="province">{t("province")}</label>
            <input id="province" className={inputClass} value={province}
              onChange={(event) => setProvince(event.target.value)} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelClass} htmlFor="delivery-notes">{t("deliveryNotes")}</label>
            <input id="delivery-notes" className={inputClass} value={deliveryNotes}
              onChange={(event) => setDeliveryNotes(event.target.value)} />
          </div>
        </div>
      </Section>

      {/* ----------------------------------------------------------- Payment */}
      <Section title={t("payment")}>
        <label className="mb-4 flex items-center gap-2 text-sm font-medium text-ink">
          <input type="checkbox" checked={requiresPayment}
            onChange={(event) => setRequiresPayment(event.target.checked)} />
          {t("requiresPaymentOnDelivery")}
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="amount">{t("amountToCollect")}</label>
            <input id="amount" type="number" step="0.01" min="0" className={inputClass}
              value={amountToCollect} disabled={!requiresPayment}
              onChange={(event) => setAmountToCollect(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="collection">{t("collectionMethod")}</label>
            <input id="collection" className={inputClass} value={collectionMethod}
              disabled={!requiresPayment}
              onChange={(event) => setCollectionMethod(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="payment-method">Metodă de plată</label>
            <input id="payment-method" className={inputClass} value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)} />
          </div>
        </div>
      </Section>

      {/* -------------------------------------------------------- Assignment */}
      <Section title={t("assignment")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="delivery-date">{t("plannedDate")}</label>
            <input id="delivery-date" type="date" className={inputClass} value={deliveryDate}
              onChange={(event) => setDeliveryDate(event.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="stand">{t("stand")}</label>
            <select id="stand" className={inputClass} value={standCode}
              onChange={(event) => setStandCode(event.target.value)}>
              <option value="">Automat (primul liber)</option>
              {STAND_CODES.map((code) => (
                <option key={code} value={code} disabled={!availableStands.includes(code)}>
                  {code}
                  {availableStands.includes(code) ? "" : " — ocupat"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="driver">{t("driver")}</label>
            <select id="driver" className={inputClass} value={driverId}
              onChange={(event) => setDriverId(event.target.value)}>
              <option value="">—</option>
              {drivers.map((driver) => (
                <option key={driver.id} value={driver.id}>{driver.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="vehicle">{t("vehicle")}</label>
            <select id="vehicle" className={inputClass} value={vehicleId}
              onChange={(event) => setVehicleId(event.target.value)}>
              <option value="">—</option>
              {vehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>{vehicle.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      {/* ---------------------------------------------------------- Products */}
      <Section
        title={t("products")}
        description={`${unitCount} obiecte fizice vor fi generate (taxele și serviciile nu produc obiecte).`}
      >
        <div className="space-y-3">
          {lines.map((line) => (
            <div
              key={line.key}
              className={`rounded-lg border p-3 ${
                (line.reviewFields ?? []).length > 0
                  ? "border-state-warning/40 bg-state-warning-soft/30"
                  : "border-ink/10"
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <label className={labelClass}>{t("description")}</label>
                  <input
                    className={inputClass}
                    value={line.description ?? line.rawDescription}
                    onChange={(event) =>
                      updateLine(line.key, {
                        description: event.target.value,
                        // A brand-new line has no source text; use what's typed.
                        rawDescription: line.rawDescription || event.target.value,
                      })
                    }
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className={labelClass}>{t("type")}</label>
                  <select
                    className={inputClass}
                    value={line.itemTypeValue}
                    onChange={(event) =>
                      updateLine(line.key, { itemTypeValue: event.target.value as ItemType })
                    }
                  >
                    {ITEM_TYPES.map((type) => (
                      <option key={type} value={type}>{itemTypeLabel(type)}</option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-2">
                  <label className={labelClass}>{t("brand")}</label>
                  <input className={inputClass} value={line.brand ?? ""}
                    onChange={(event) => updateLine(line.key, { brand: event.target.value })} />
                </div>
                <div className="lg:col-span-1">
                  <label className={labelClass}>Lăț.</label>
                  <input type="number" className={inputClass} value={line.width ?? ""}
                    onChange={(event) =>
                      updateLine(line.key, { width: event.target.value ? Number(event.target.value) : null })
                    } />
                </div>
                <div className="lg:col-span-1">
                  <label className={labelClass}>Prof.</label>
                  <input type="number" className={inputClass} value={line.aspectRatio ?? ""}
                    onChange={(event) =>
                      updateLine(line.key, { aspectRatio: event.target.value ? Number(event.target.value) : null })
                    } />
                </div>
                <div className="lg:col-span-1">
                  <label className={labelClass}>Jantă</label>
                  <input type="number" step="0.5" className={inputClass} value={line.rimDiameter ?? ""}
                    onChange={(event) =>
                      updateLine(line.key, { rimDiameter: event.target.value ? Number(event.target.value) : null })
                    } />
                </div>
                <div className="lg:col-span-1">
                  <label className={labelClass}>{t("quantity")}</label>
                  <input type="number" min="1" className={`${inputClass} font-bold`}
                    value={line.quantityValue}
                    onChange={(event) =>
                      updateLine(line.key, { quantityValue: Number(event.target.value) || 1 })
                    } />
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-ink-soft">
                  {(line.reviewFields ?? []).length > 0 && (
                    <span className="font-semibold text-state-warning">
                      De verificat: {(line.reviewFields ?? []).join(", ")}
                    </span>
                  )}
                  {line.rawDescription && line.description !== line.rawDescription && (
                    <span className="ml-2 font-mono opacity-70">
                      sursă: {line.rawDescription.slice(0, 60)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                  className="text-xs font-semibold text-state-danger hover:underline"
                >
                  {t("removeLine")}
                </button>
              </div>
            </div>
          ))}

          {lines.length === 0 && (
            <p className="rounded-lg border border-dashed border-ink/20 px-4 py-6 text-center text-sm text-ink-soft">
              Nicio linie de produs. Adaugă manual liniile din document.
            </p>
          )}

          <Button type="button" variant="secondary" onClick={addLine}>
            + {t("addLine")}
          </Button>
        </div>
      </Section>

      {error && (
        <div role="alert" className="rounded-xl bg-state-danger-soft p-4 text-sm font-medium text-state-danger">
          {error}
          {details.length > 0 && (
            <ul className="mt-2 list-inside list-disc font-mono text-xs">
              {details.map((detail, index) => (
                <li key={index}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 border-t border-ink/10 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-ink-soft">
            {lines.length} linii · <strong className="text-ink">{unitCount}</strong> obiecte fizice
          </span>
          <Button size="lg" disabled={saving || lines.length === 0} onClick={save}>
            {saving ? t("loading") : t("save")}
          </Button>
        </div>
      </div>
    </div>
  );
}
