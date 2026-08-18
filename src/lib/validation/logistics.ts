import { z } from "zod";
import { ITEM_TYPES, STAND_CODES } from "@/lib/types/logistics";

/**
 * Server-side validation for every logistics route.
 *
 * These run even where the client already validates: client-side checks are a
 * usability feature, not a security boundary. Anything reaching a route handler
 * is treated as untrusted.
 */

export const standCodeSchema = z.enum(STAND_CODES);
export const itemTypeSchema = z.enum(ITEM_TYPES);

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const shortText = z.string().trim().max(200);
const longText = z.string().trim().max(2000);
const money = z.number().finite().min(0).max(1_000_000);

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------

export const adminLoginSchema = z
  .object({
    email: z.string().trim().email().max(200),
    password: z.string().min(1).max(200),
  })
  .strict();

/**
 * One-time admin-account bootstrap (see app/api/admin/bootstrap-user). Gated
 * by SUPABASE_SERVICE_ROLE_KEY itself, not a separate secret — see that
 * route's comment for why that's an acceptable trust boundary here.
 */
export const bootstrapAdminSchema = z
  .object({
    secret: z.string().min(1),
    email: z.string().trim().email().max(200),
    password: z.string().min(6).max(200),
  })
  .strict();

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export const orderItemInputSchema = z
  .object({
    item_type: itemTypeSchema,
    is_physical: z.boolean().optional(),
    quantity: z.number().int().min(1).max(500),
    supplier_sku: shortText.nullish(),
    raw_description: longText.nullish(),
    description: longText.nullish(),
    brand: shortText.nullish(),
    model: shortText.nullish(),
    width: z.number().int().min(50).max(600).nullish(),
    aspect_ratio: z.number().int().min(10).max(120).nullish(),
    rim_diameter: z.number().min(5).max(40).nullish(),
    load_index: z.string().trim().max(20).nullish(),
    speed_rating: z.string().trim().max(5).nullish(),
    season: z.string().trim().max(20).nullish(),
    extra_load: z.boolean().nullish(),
    run_flat: z.boolean().nullish(),
    unit_price: money.nullish(),
    tax_rate: z.number().min(0).max(100).nullish(),
    pfu_fee: money.nullish(),
    logistics_fee: money.nullish(),
    notes: longText.nullish(),
    needs_review: z.boolean().optional(),
    review_fields: z.array(z.string().max(50)).max(30).optional(),
    confidence: z.number().min(0).max(1).nullish(),
  })
  .strict();

const addressSchema = z
  .object({
    location_name: shortText.nullish(),
    recipient_name: shortText.nullish(),
    address_line1: shortText.nullish(),
    address_line2: shortText.nullish(),
    postal_code: z.string().trim().max(20).nullish(),
    city: shortText.nullish(),
    province: z.string().trim().max(50).nullish(),
    region: z.string().trim().max(50).nullish(),
    country_code: z.string().trim().max(3).nullish(),
    phone: z.string().trim().max(50).nullish(),
    email: z.string().trim().max(200).nullish(),
    contact_name: shortText.nullish(),
    delivery_notes: longText.nullish(),
  })
  .strict();

export const locationResolutionSchema = z.enum([
  "use_existing",
  "use_for_this_order_only",
  "add_as_new_location",
  "update_existing_location",
]);

export const createOrderSchema = z
  .object({
    // Supplier: either an existing id or a name to find-or-create. orders.supplier_id
    // is NOT NULL, so one of the two must be present.
    supplier_id: uuid.nullish(),
    supplier_name: shortText.nullish(),
    supplier_vat_number: z.string().trim().max(30).nullish(),
    supplier_document_number: shortText.nullish(),
    supplier_document_date: isoDate.nullish(),
    supplier_reference: shortText.nullish(),

    // Customer: an existing id, or a new company to create.
    customer_id: uuid.nullish(),
    new_customer: z
      .object({
        name: z.string().trim().min(1).max(200),
        legal_name: shortText.nullish(),
        vat_number: z.string().trim().max(30).nullish(),
        fiscal_code: z.string().trim().max(30).nullish(),
        email: z.string().trim().max(200).nullish(),
        phone: z.string().trim().max(50).nullish(),
      })
      .strict()
      .nullish(),
    supplier_customer_code: shortText.nullish(),

    customer_location_id: uuid.nullish(),
    location_resolution: locationResolutionSchema.default("use_existing"),
    address: addressSchema.default({}),

    planned_delivery_date: isoDate.nullish(),
    stand_code: standCodeSchema.nullish(),
    auto_allocate_stand: z.boolean().default(true),
    driver_id: uuid.nullish(),
    vehicle_id: uuid.nullish(),

    requires_payment_on_delivery: z.boolean().default(false),
    payment_method: shortText.nullish(),
    amount_to_collect: money.nullish(),
    collection_method: shortText.nullish(),
    currency: z.string().trim().max(3).default("EUR"),

    notes: longText.nullish(),
    source_document_id: uuid.nullish(),
    source_type: z.enum(["pdf", "image", "manual", "email"]).default("manual"),

    items: z.array(orderItemInputSchema).min(1).max(200),
  })
  .strict()
  .refine((value) => Boolean(value.supplier_id || value.supplier_name), {
    message: "supplier_id or supplier_name is required",
    path: ["supplier_id"],
  })
  .refine((value) => Boolean(value.customer_id || value.new_customer), {
    message: "customer_id or new_customer is required",
    path: ["customer_id"],
  });

export const updateOrderSchema = z
  .object({
    supplier_document_number: shortText.nullish(),
    document_date: isoDate.nullish(),
    supplier_order_reference: shortText.nullish(),
    planned_delivery_date: isoDate.nullish(),
    driver_id: uuid.nullish(),
    vehicle_id: uuid.nullish(),
    delivery_name: shortText.nullish(),
    delivery_address_line1: shortText.nullish(),
    delivery_address_line2: shortText.nullish(),
    delivery_city: shortText.nullish(),
    delivery_province: z.string().trim().max(50).nullish(),
    delivery_postal_code: z.string().trim().max(20).nullish(),
    delivery_country_code: z.string().trim().max(3).nullish(),
    delivery_notes: longText.nullish(),
    cash_on_delivery: z.boolean().optional(),
    payment_method: shortText.nullish(),
    amount_to_collect: money.nullish(),
    collection_method: shortText.nullish(),
    notes: longText.nullish(),
    customer_location_id: uuid.nullish(),
  })
  .strict();

export const orderActionSchema = z
  .object({
    action: z.enum(["cancel", "hold", "reactivate", "assign_stand", "set_status"]),
    reason: longText.nullish(),
    stand_code: standCodeSchema.nullish(),
    planned_delivery_date: isoDate.nullish(),
    status: z.string().trim().max(40).nullish(),
  })
  .strict();

/** Step 1 of a direct-to-storage upload: ask for a one-time signed upload slot. */
export const documentUploadSlotSchema = z
  .object({
    fileName: shortText.min(1),
    mimeType: shortText.min(1),
  })
  .strict();

/** Step 2: the browser already uploaded the bytes to storagePath — analyse what's there. */
export const analyzeUploadedDocumentSchema = z
  .object({
    storagePath: shortText.min(1),
    fileName: shortText.min(1),
    mimeType: shortText.min(1),
    fileSize: z.number().int().positive(),
  })
  .strict();

/** The vehicle board's drag-reorder: see reorderVehicleColumn in src/lib/server/orders.ts. */
export const reorderOrdersSchema = z
  .object({
    vehicleId: uuid.nullable(),
    orderedOrderIds: z.array(uuid).min(1).max(200),
  })
  .strict();

const vehicleName = z.string().trim().min(1).max(60);

export const createVehicleSchema = z
  .object({
    name: vehicleName,
    registration: z.string().trim().max(30).nullish(),
  })
  .strict();

export const renameVehicleSchema = z.object({ name: vehicleName }).strict();

export const reorderVehiclesSchema = z
  .object({ orderedVehicleIds: z.array(uuid).min(1).max(50) })
  .strict();

/** The "Hartă" route-stops geocoding request — one vehicle's stops, in delivery order. */
export const routeMapSchema = z
  .object({
    stops: z
      .array(z.object({ orderId: uuid, address: shortText.min(1) }))
      .min(1)
      .max(50),
  })
  .strict();

export const updateOrderItemSchema = z
  .object({
    description: longText.nullish(),
    item_type: itemTypeSchema.optional(),
    brand: shortText.nullish(),
    model: shortText.nullish(),
    width: z.number().int().min(50).max(600).nullish(),
    aspect_ratio: z.number().int().min(10).max(120).nullish(),
    rim_diameter: z.number().min(5).max(40).nullish(),
    load_index: z.string().trim().max(20).nullish(),
    speed_rating: z.string().trim().max(5).nullish(),
    unit_price: money.nullish(),
    needs_review: z.boolean().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customerSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    legal_name: shortText.nullish(),
    vat_number: z.string().trim().max(30).nullish(),
    fiscal_code: z.string().trim().max(30).nullish(),
    email: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(50).nullish(),
    notes: longText.nullish(),
  })
  .strict();

export const supplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    legal_name: shortText.nullish(),
    vat_number: z.string().trim().max(30).nullish(),
    fiscal_code: z.string().trim().max(30).nullish(),
    website: z.string().trim().max(200).nullish(),
    email: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(50).nullish(),
    notes: longText.nullish(),
  })
  .strict();

export const customerLocationSchema = addressSchema
  .extend({ is_primary: z.boolean().optional() })
  .strict();

// ---------------------------------------------------------------------------
// Driver session
// ---------------------------------------------------------------------------

export const driverSessionSchema = z
  .object({
    driver_id: uuid,
    vehicle_id: uuid.nullish(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * What a supplier label reader produced. Every field is optional because a
 * blurry label legitimately yields almost nothing — and that must produce an
 * honest "no confident match", not a guess.
 */
export const scannedLabelSchema = z
  .object({
    brand: shortText.nullish(),
    model: shortText.nullish(),
    size: z.string().trim().max(50).nullish(),
    loadIndex: z.string().trim().max(20).nullish(),
    speedRating: z.string().trim().max(5).nullish(),
    supplierSku: shortText.nullish(),
    supplierReference: shortText.nullish(),
    barcode: z.string().trim().max(100).nullish(),
    rawText: z.string().trim().max(5000).nullish(),
  })
  .strict();

export const supplierLabelScanSchema = z
  .object({
    label: scannedLabelSchema,
    /** Required so a double-submitted capture can't consume two units. */
    idempotency_key: z.string().trim().min(8).max(100),
    /** Set once the operator confirms an uncertain match. */
    order_item_id: uuid.nullish(),
    manual: z.boolean().default(false),
    reason: longText.nullish(),
  })
  .strict();

export const manualSearchSchema = z
  .object({ query: z.string().trim().min(1).max(100) })
  .strict();

export const barcodeScanSchema = z
  .object({
    unit_token: z.string().trim().min(4).max(120),
    idempotency_key: z.string().trim().min(8).max(100).nullish(),
    zone_id: uuid.nullish(),
  })
  .strict();

export const manualLoadSchema = z
  .object({
    inventory_unit_id: uuid,
    // Mandatory and non-trivial: a manual override without a real reason is
    // exactly what the audit trail must never contain.
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const deliverOrderSchema = z.object({ order_id: uuid }).strict();

export const printJobActionSchema = z
  .object({ action: z.literal("retry") })
  .strict();
