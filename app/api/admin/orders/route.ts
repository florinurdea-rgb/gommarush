import { NextRequest } from "next/server";
import { createOrderSchema } from "@/lib/validation/logistics";
import { createOrder } from "@/lib/server/orders";
import { resolveCustomerForOrder } from "@/lib/server/customers";
import { findOrCreateSupplier } from "@/lib/server/reference";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";
import type { CreateOrderItemInput } from "@/lib/server/orders";

export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/,(?=\d{1,2}$)/, ".")
    .replace(/[^0-9.+-]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value: unknown): number | null {
  const parsed = numberOrNull(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalised = value.trim().toLowerCase();
    if (["true", "1", "yes", "si", "sì"].includes(normalised)) return true;
    if (["false", "0", "no"].includes(normalised)) return false;
  }
  return null;
}

function dateOrNull(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const european = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(raw);
  if (european) {
    return `${european[3]}-${european[2].padStart(2, "0")}-${european[1].padStart(2, "0")}`;
  }
  return null;
}

const VALID_ITEM_TYPES = new Set(["tyre", "tube", "wheel", "accessory", "service", "fee", "other"]);

/**
 * PDF/vision extraction is intentionally permissive at this boundary. AI and
 * OCR providers may emit "4", "4.0", "22,50", an unknown item type or an
 * Italian date. None of those should make the whole order disappear. We
 * normalise what is safe and mark anything adjusted for human review.
 */
function normaliseImportBody(raw: unknown): JsonRecord {
  const body = record(raw);
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const items = rawItems.flatMap((rawItem) => {
    const item = record(rawItem);
    const rawDescription = text(item.raw_description) ?? text(item.description);
    if (!rawDescription && Object.keys(item).length === 0) return [];

    const reviewFields = new Set(
      Array.isArray(item.review_fields)
        ? item.review_fields.filter((field): field is string => typeof field === "string").slice(0, 30)
        : []
    );

    const rawItemType = text(item.item_type)?.toLowerCase() ?? "other";
    const itemType = VALID_ITEM_TYPES.has(rawItemType) ? rawItemType : "other";
    if (itemType !== rawItemType) reviewFields.add("item_type");

    const rawQuantity = integerOrNull(item.quantity);
    const quantity = rawQuantity && rawQuantity > 0 ? Math.min(rawQuantity, 500) : 1;
    if (rawQuantity == null || rawQuantity < 1 || rawQuantity > 500) reviewFields.add("quantity");

    const width = integerOrNull(item.width);
    const aspectRatio = integerOrNull(item.aspect_ratio);
    const rimDiameter = numberOrNull(item.rim_diameter);

    if (width != null && (width < 50 || width > 600)) reviewFields.add("width");
    if (aspectRatio != null && (aspectRatio < 10 || aspectRatio > 120)) reviewFields.add("aspect_ratio");
    if (rimDiameter != null && (rimDiameter < 5 || rimDiameter > 40)) reviewFields.add("rim_diameter");

    const confidence = numberOrNull(item.confidence);
    const safeConfidence = confidence == null ? null : Math.max(0, Math.min(1, confidence));

    return [
      {
        item_type: itemType,
        is_physical:
          booleanOrNull(item.is_physical) ?? !(itemType === "service" || itemType === "fee"),
        quantity,
        supplier_sku: text(item.supplier_sku),
        raw_description: rawDescription,
        description: text(item.description) ?? rawDescription,
        brand: text(item.brand),
        model: text(item.model),
        width: width != null && width >= 50 && width <= 600 ? width : null,
        aspect_ratio: aspectRatio != null && aspectRatio >= 10 && aspectRatio <= 120 ? aspectRatio : null,
        rim_diameter: rimDiameter != null && rimDiameter >= 5 && rimDiameter <= 40 ? rimDiameter : null,
        load_index: text(item.load_index),
        speed_rating: text(item.speed_rating),
        season: text(item.season),
        extra_load: booleanOrNull(item.extra_load),
        run_flat: booleanOrNull(item.run_flat),
        unit_price: numberOrNull(item.unit_price),
        tax_rate: numberOrNull(item.tax_rate),
        pfu_fee: numberOrNull(item.pfu_fee),
        logistics_fee: numberOrNull(item.logistics_fee),
        notes: text(item.notes),
        needs_review: Boolean(item.needs_review) || reviewFields.size > 0,
        review_fields: [...reviewFields],
        confidence: safeConfidence,
      },
    ];
  });

  // A scanned document can legitimately omit the final customer's company
  // name while still containing a delivery recipient/address. The current
  // order contract requires a customer, so keep the import moving with a very
  // explicit review placeholder rather than throwing the whole import away.
  const newCustomer = record(body.new_customer);
  const hasCustomerId = Boolean(text(body.customer_id));
  const customerName = text(newCustomer.name);
  const recipient = text(record(body.address).recipient_name);
  const fallbackCustomerName = customerName ?? recipient ?? "Client neidentificat — verifică";

  return {
    ...body,
    supplier_name: text(body.supplier_name) ?? (text(body.supplier_id) ? null : "Furnizor neidentificat — verifică"),
    supplier_document_date: dateOrNull(body.supplier_document_date),
    planned_delivery_date: dateOrNull(body.planned_delivery_date),
    amount_to_collect: numberOrNull(body.amount_to_collect),
    source_type: ["pdf", "image", "manual", "email"].includes(String(body.source_type ?? ""))
      ? body.source_type
      : "manual",
    new_customer: hasCustomerId
      ? null
      : {
          ...newCustomer,
          name: fallbackCustomerName,
          vat_number: text(newCustomer.vat_number),
          fiscal_code: text(newCustomer.fiscal_code),
          email: text(newCustomer.email),
          phone: text(newCustomer.phone),
        },
    items,
  };
}

/**
 * POST /api/admin/orders — "Salvează" on the review screen.
 *
 * The import boundary normalises imperfect OCR/AI output first. The database
 * write remains atomic: order + items + inventory units either all succeed or
 * none do.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const normalised = normaliseImportBody(body);
    if (!Array.isArray(normalised.items) || normalised.items.length === 0) {
      return fail(400, "NO_PRODUCTS", [
        "items: documentul nu conține nicio linie de produs utilizabilă; adaugă cel puțin un produs înainte de salvare",
      ]);
    }

    const parsed = createOrderSchema.safeParse(normalised);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));
    const input = parsed.data;

    // 1. Supplier.
    let supplierId = input.supplier_id ?? null;
    if (!supplierId && input.supplier_name) {
      const supplier = await findOrCreateSupplier({
        name: input.supplier_name,
        vatNumber: input.supplier_vat_number ?? null,
      });
      supplierId = supplier.id;
    }
    if (!supplierId) return fail(400, "SUPPLIER_REQUIRED");

    // 2. Customer + location, exactly as the Admin chose.
    const resolved = await resolveCustomerForOrder({
      customerId: input.customer_id ?? null,
      newCustomer: input.new_customer ?? null,
      customerLocationId: input.customer_location_id ?? null,
      resolution: input.location_resolution,
      address: input.address,
      supplierId,
      supplierCustomerCode: input.supplier_customer_code ?? null,
    });

    const items: CreateOrderItemInput[] = input.items.map((item) => ({
      item_type: item.item_type,
      is_physical: item.is_physical,
      quantity: item.quantity,
      supplier_sku: item.supplier_sku ?? null,
      raw_description: item.raw_description ?? null,
      description: item.description ?? null,
      brand: item.brand ?? null,
      model: item.model ?? null,
      width: item.width ?? null,
      aspect_ratio: item.aspect_ratio ?? null,
      rim_diameter: item.rim_diameter ?? null,
      load_index: item.load_index ?? null,
      speed_rating: item.speed_rating ?? null,
      season: item.season ?? null,
      extra_load: item.extra_load ?? null,
      run_flat: item.run_flat ?? null,
      unit_price: item.unit_price ?? null,
      tax_rate: item.tax_rate ?? null,
      pfu_fee: item.pfu_fee ?? null,
      logistics_fee: item.logistics_fee ?? null,
      notes: item.notes ?? null,
      needs_review: item.needs_review ?? false,
      review_fields: item.review_fields ?? [],
      confidence: item.confidence ?? null,
    }));

    // 3. Atomic write.
    const result = await createOrder(
      {
        supplier_id: supplierId,
        supplier_document_number: input.supplier_document_number ?? null,
        supplier_document_date: input.supplier_document_date ?? null,
        supplier_reference: input.supplier_reference ?? null,
        source_type: input.source_type,
        customer_id: resolved.customerId,
        customer_location_id: resolved.customerLocationId,
        delivery_recipient: resolved.addressSnapshot.recipient_name ?? null,
        delivery_address_line1: resolved.addressSnapshot.address_line1 ?? null,
        delivery_address_line2: resolved.addressSnapshot.address_line2 ?? null,
        delivery_city: resolved.addressSnapshot.city ?? null,
        delivery_province: resolved.addressSnapshot.province ?? null,
        delivery_postal_code: resolved.addressSnapshot.postal_code ?? null,
        delivery_country: resolved.addressSnapshot.country_code ?? null,
        delivery_notes: resolved.addressSnapshot.delivery_notes ?? null,
        planned_delivery_date: input.planned_delivery_date ?? null,
        stand_code: input.stand_code ?? null,
        auto_allocate_stand: input.auto_allocate_stand && !input.stand_code,
        driver_id: input.driver_id ?? null,
        vehicle_id: input.vehicle_id ?? null,
        requires_payment_on_delivery: input.requires_payment_on_delivery,
        payment_method: input.payment_method ?? null,
        amount_to_collect: input.amount_to_collect ?? null,
        collection_method: input.collection_method ?? null,
        currency: input.currency,
        notes: input.notes ?? null,
        source_document_id: input.source_document_id ?? null,
        items,
      },
      session.subject
    );

    return ok(
      {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        orderNumberLabel: formatOrderNumber(result.orderNumber),
        standCode: result.standCode,
        standWarning: result.standWarning,
        inventoryUnitCount: result.inventoryUnitCount,
      },
      201
    );
  });
}
