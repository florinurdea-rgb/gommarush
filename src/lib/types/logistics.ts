// Canonical logistics contract shared between the Supabase schema, the server
// operations in src/lib/server/*, and the UI.
//
// These unions mirror the ACTUAL live schema of project sfvaqextratpnprcamwd,
// including its pre-existing column names — the application adapts to the
// database rather than the other way round. Notable ones to keep straight:
//   inventory_units.qr_token       the printed Code128/QR value ("unit token")
//   inventory_units.unit_sequence  1-based index within its order item
//   inventory_units.unit_type      narrower than order_items.item_type
//   orders.order_number            bigint identity; "GR-001" is a display form
//   orders.delivery_name           the delivery recipient
//   orders.cash_on_delivery        requires payment at delivery
//   order_items.environmental_fee  the PFU charge
//   order_items.vat_percent        the tax rate
//
// Terminology (kept deliberately distinct throughout the codebase):
//   Order          one supplier invoice/document, for one final customer
//   OrderItem      one product line on that document
//   InventoryUnit  one physical object (4 tyres => 4 InventoryUnits)
//
// The A–E "stand" concept (temporary warehouse sorting slot) was removed by
// product decision — the warehouse can hold too many simultaneous orders for
// a 5-slot ceiling to stay useful, and Phase 1 doesn't replace it with any
// other location abstraction (no zones/shelves/bins). `orders.stand_code`
// and the sibling historical columns remain in the schema, deprecated, for
// old records only — no active code reads or writes them. See
// supabase/migrations/<date>_remove_stand_allocation.sql.

/** Physical object kinds. The system must never assume everything is a tyre. */
export const PHYSICAL_ITEM_TYPES = ["tyre", "tube", "wheel", "accessory", "other"] as const;
/** Legitimate order lines that are not physical inventory. */
export const NON_PHYSICAL_ITEM_TYPES = ["service", "fee"] as const;

export const ITEM_TYPES = [...PHYSICAL_ITEM_TYPES, ...NON_PHYSICAL_ITEM_TYPES] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

/** inventory_units.unit_type — no service/fee, since those aren't objects. */
export type UnitType = (typeof PHYSICAL_ITEM_TYPES)[number];

export function isItemType(value: unknown): value is ItemType {
  return typeof value === "string" && (ITEM_TYPES as readonly string[]).includes(value);
}

/**
 * Whether an item type produces inventory_units by default. Fees, PFU,
 * transport and services are real order lines but not physical objects. An
 * explicit `is_physical` on the line always wins — that is the hook for a
 * future "fee that ships as an object".
 */
export function isPhysicalItemType(type: ItemType): boolean {
  return (PHYSICAL_ITEM_TYPES as readonly string[]).includes(type);
}

/** Maps an item type onto the narrower inventory_units.unit_type vocabulary. */
export function toUnitType(type: ItemType): UnitType {
  return (PHYSICAL_ITEM_TYPES as readonly string[]).includes(type) ? (type as UnitType) : "other";
}

/**
 * The live `orders_status_check` vocabulary, with 'on_hold' added by the
 * Phase 1 migration. Richer than the minimum Phase 1 set — the partially_*
 * values are used because they describe reality more precisely.
 */
export const ORDER_STATUSES = [
  "draft",
  "review_required",
  "confirmed",
  "expected",
  "partially_received",
  "received",
  "sorting",
  "stored",
  "ready_for_loading",
  "partially_loaded",
  "loaded",
  "out_for_delivery",
  "partially_delivered",
  "delivered",
  "returned",
  "on_hold",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Statuses that keep an order on the active dashboard ("Livrări").
 * Includes `on_hold` — there is no longer a dedicated "on hold" page (that
 * tab was repurposed into "De pregătit"), so a held order stays visible
 * here instead of disappearing; it surfaces under the "Așteaptă marfa"
 * operational-status bucket (src/lib/logistics/operational-status.ts).
 */
export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  "confirmed",
  "expected",
  "partially_received",
  "received",
  "sorting",
  "stored",
  "ready_for_loading",
  "partially_loaded",
  "loaded",
  "out_for_delivery",
  "partially_delivered",
  "on_hold",
];

export const INVENTORY_UNIT_STATUSES = [
  "expected",
  "received",
  "stored",
  "ready_for_loading",
  "loaded",
  "out_for_delivery",
  "delivered",
  "returned",
  "defective",
  "damaged",
  // 'missing' and 'lost' are deliberately distinct:
  //   missing = expected but temporarily not findable
  //   lost    = loss confirmed after investigation
  "missing",
  "lost",
  "quarantine",
  "disposed",
] as const;
export type InventoryUnitStatus = (typeof INVENTORY_UNIT_STATUSES)[number];

/**
 * The live `inventory_scans_scan_type_check` vocabulary, plus 'manual_loading'
 * added by the Phase 1 migration. Phase 1 uses:
 *   received        supplier label matched to a physical unit
 *   manual_check    a human picked the association
 *   storage         GoRush barcode scanned at storage
 *   loading         GoRush barcode scanned into a van
 *   manual_loading  loading override (damaged label / dead scanner)
 *   inventory_check duplicate or rejected scan, kept as an audit trail
 */
export const SCAN_TYPES = [
  "received",
  "zone_scan",
  "storage",
  "loading",
  "manual_loading",
  "unloading",
  "delivery",
  "return",
  "inventory_check",
  "found",
  "manual_check",
] as const;
export type ScanType = (typeof SCAN_TYPES)[number];

export type ScanResult = "success" | "duplicate" | "rejected";

/** Live vocabulary, plus quarantine/disposed added by the Phase 1 migration. */
export const INCIDENT_TYPES = [
  "return",
  "defect",
  "damage",
  "missing",
  "lost",
  "wrong_item",
  "wrong_delivery",
  "customer_refusal",
  "warranty",
  "quarantine",
  "disposed",
  "other",
] as const;
export type IncidentType = (typeof INCIDENT_TYPES)[number];

export type PrintJobStatus = "pending" | "processing" | "printed" | "failed" | "cancelled";

/** order_documents.extraction_status, plus 'unconfigured' from Phase 1. */
export type DocumentExtractionStatus =
  | "pending"
  | "processing"
  | "review_required"
  | "unconfigured"
  | "confirmed"
  | "failed";

/** orders.source_type / order_documents.source_type. */
export type DocumentSourceType = "pdf" | "image" | "manual" | "email";

// ---------------------------------------------------------------------------
// Row shapes (hand-kept in sync with the live schema; no generated types yet)
// ---------------------------------------------------------------------------

export interface SupplierRow {
  id: string;
  name: string;
  legal_name: string | null;
  vat_number: string | null;
  fiscal_code: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  notes: string | null;
  active: boolean;
}

export interface CustomerRow {
  id: string;
  name: string;
  legal_name: string | null;
  vat_number: string | null;
  fiscal_code: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerLocationRow {
  id: string;
  customer_id: string;
  /** The branch label, e.g. "Filiale Vicenza". */
  location_name: string | null;
  recipient_name: string | null;
  address_line1: string;
  address_line2: string | null;
  postal_code: string | null;
  city: string;
  province: string | null;
  region: string | null;
  country_code: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  delivery_notes: string | null;
  is_primary: boolean;
  active: boolean;
}

export interface DriverRow {
  id: string;
  name: string;
  slug: string | null;
  phone: string | null;
  email: string | null;
  active: boolean;
}

export const VEHICLE_COLOR_KEYS = [
  "blue",
  "purple",
  "teal",
  "indigo",
  "slate",
  "cyan",
  "rose",
  "amber",
] as const;
export type VehicleColorKey = (typeof VEHICLE_COLOR_KEYS)[number];

export interface VehicleRow {
  id: string;
  name: string;
  slug: string | null;
  registration: string | null;
  /** Max physical units it can carry per run. Null = unknown/no limit tracked. */
  capacity_units: number | null;
  active: boolean;
  /** Kanban lane / fleet-list order. Null sorts after every ordered vehicle. */
  display_order: number | null;
  /** Subtle header-accent color only — never a saturated column background. */
  color_key: VehicleColorKey | null;
}

export interface OrderRow {
  id: string;
  /** bigint identity. Display via formatOrderNumber(). */
  order_number: number;
  qr_token: string;
  supplier_id: string;
  supplier_location_id: string | null;
  customer_id: string | null;
  customer_location_id: string | null;
  supplier_document_number: string | null;
  supplier_order_reference: string | null;
  document_type: string | null;
  document_date: string | null;
  source_type: DocumentSourceType;

  /** Delivery address SNAPSHOT, so "this order only" never mutates master data. */
  delivery_name: string | null;
  delivery_address_line1: string | null;
  delivery_address_line2: string | null;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  delivery_province: string | null;
  delivery_region: string | null;
  delivery_country_code: string;
  delivery_notes: string | null;

  payment_method: string | null;
  /** Requires payment at delivery (contrassegno). */
  cash_on_delivery: boolean;
  collection_method: string | null;
  amount_to_collect: number | string | null;
  payment_status: string;
  currency: string;

  planned_delivery_date: string | null;
  expected_at: string | null;
  /** @deprecated Stand allocation was removed. Historical value only — never read/written by active code. */
  stand_code: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  /** Admin's manual delivery ordering within a vehicle's column. Null until the first drag-reorder. */
  delivery_sequence: number | null;
  assigned_zone_id: string | null;
  status: OrderStatus;

  held_at: string | null;
  status_before_hold: OrderStatus | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  source_document_id: string | null;

  received_at: string | null;
  stored_at: string | null;
  ready_at: string | null;
  loaded_at: string | null;
  delivered_at: string | null;
  amount_collected: number | string | null;
  payment_collected_at: string | null;
  delivery_failure_reason: string | null;
  delivery_failed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  line_number: number | null;
  item_type: ItemType;
  /** False for fees/services, which get no inventory units. */
  is_physical: boolean;
  supplier_sku: string | null;
  /** Preserved verbatim from the source document, even after normalisation. */
  raw_description: string | null;
  description: string | null;
  brand: string | null;
  model: string | null;
  width: number | null;
  aspect_ratio: number | null;
  rim_diameter: number | string | null;
  load_index: string | null;
  speed_rating: string | null;
  season: string | null;
  extra_load: boolean | null;
  run_flat: boolean | null;
  quantity: number;
  unit_of_measure: string | null;
  unit_price: number | string | null;
  discount_percent: number | string | null;
  line_subtotal: number | string | null;
  /** The tax rate. */
  vat_percent: number | string | null;
  line_total: number | string | null;
  /** The PFU / environmental charge. */
  environmental_fee: number | string | null;
  logistics_fee: number | string | null;
  notes: string | null;
  needs_review: boolean;
  review_fields: string[];
  confidence: number | string | null;
}

export interface InventoryUnitRow {
  id: string;
  order_id: string;
  order_item_id: string;
  unit_type: UnitType;
  /** 1-based index within its order item. */
  unit_sequence: number;
  /** Source of truth for the printed Code128 / QR. Treat as a bearer token. */
  qr_token: string;
  description: string | null;
  status: InventoryUnitStatus;
  current_zone_id: string | null;
  received_at: string | null;
  stored_at: string | null;
  loaded_at: string | null;
  delivered_at: string | null;
  /** @deprecated Stand allocation was removed. Historical value only. */
  last_stand_code: string | null;
  last_vehicle_id: string | null;
  matched_manually: boolean;
}

export interface InventoryScanRow {
  id: string;
  inventory_unit_id: string;
  order_id: string | null;
  order_item_id: string | null;
  scan_type: ScanType;
  result: ScanResult;
  raw_value: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  operator_session: string | null;
  /** @deprecated Stand allocation was removed. Historical value only. */
  stand_code: string | null;
  warehouse_zone_id: string | null;
  device_type: string | null;
  /** True for overrides. Never let a manual entry look like a real scan. */
  manual: boolean;
  reason: string | null;
  scanned_at: string;
}

export interface PrintJobRow {
  id: string;
  inventory_unit_id: string | null;
  order_id: string | null;
  print_type: string;
  status: PrintJobStatus;
  label_data: LabelData;
  printer_name: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  attempts: number;
  requested_at: string;
  printed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface OrderDocumentRow {
  id: string;
  order_id: string | null;
  supplier_id: string | null;
  source_type: DocumentSourceType;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  extraction_status: DocumentExtractionStatus;
  extraction_confidence: number | string | null;
  raw_extracted_data: unknown;
  analysis_provider: string | null;
  analysis_error: string | null;
  analysed_at: string | null;
  created_at: string;
}

/**
 * Everything the Print Agent needs to render one physical label — and nothing
 * more. NEVER add payment amounts, addresses, keys, or any token beyond the
 * unit token itself: this JSON travels to a workshop PC and lands in agent logs.
 */
export interface LabelData {
  inventory_unit_id: string;
  unit_token: string;
  /** bigint from the database; rendered as "GR-001" on the label. */
  order_number: number | string;
  customer: string;
  product: string;
  brand?: string;
  size?: string;
  load_speed?: string;
  unit_index?: number;
  unit_total?: number;
  item_type?: string;
  /**
   * Deliberate, explicit exception to the "nothing sensitive on a label"
   * rule below — the user was told this data travels to a workshop PC and
   * gets logged, and chose to include it anyway for the preparation/
   * labeling flow (src/components/logistics/PrepareOrderModal.tsx). Not an
   * oversight: assertLabelDataIsSafe() in label.ts intentionally does NOT
   * forbid these two exact key names.
   */
  supplier?: string;
  delivery_address?: string;
}
