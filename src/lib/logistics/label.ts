// Label data contract shared by the web app and the GoRush Print Agent.
//
// The web app generates label data; the printer never invents identifiers. The
// unit token in here is the single source of truth for both the Code128 barcode
// and the QR code.
//
// Security rule enforced by `assertLabelDataIsSafe`: label_data travels to a
// workshop PC, gets written to agent logs, and may be re-rendered later. It
// must therefore carry nothing sensitive — no payment amounts, no addresses,
// no keys.

import { formatTyreSize } from "@/lib/logistics/product-normalise";
import type { LabelData, OrderItemRow, StandCode } from "@/lib/types/logistics";

/** Keys that must never appear in label_data. */
const FORBIDDEN_LABEL_KEYS = [
  "amount_to_collect",
  "amount",
  "payment_method",
  "collection_method",
  "price",
  "unit_price",
  "total",
  "vat_number",
  "address",
  "delivery_address_line1",
  "delivery_address_line2",
  "postal_code",
  "phone",
  "email",
  "service_role_key",
  "supabase_key",
  "api_key",
  "token_secret",
  "password",
];

export class UnsafeLabelDataError extends Error {
  constructor(public readonly key: string) {
    super(`label_data must not contain "${key}"`);
    this.name = "UnsafeLabelDataError";
  }
}

/**
 * Fails loudly if a label payload picked up something it shouldn't. Called on
 * every print-job creation path, so a future refactor that widens the payload
 * gets caught at the boundary rather than on a printed label.
 */
export function assertLabelDataIsSafe(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (FORBIDDEN_LABEL_KEYS.includes(key.toLowerCase())) {
      throw new UnsafeLabelDataError(key);
    }
  }
}

export interface BuildLabelDataInput {
  inventoryUnitId: string;
  unitToken: string;
  unitIndex?: number;
  orderNumber: string;
  standCode: StandCode | null;
  customerName: string | null;
  item: Pick<
    OrderItemRow,
    | "item_type"
    | "brand"
    | "description"
    | "raw_description"
    | "width"
    | "aspect_ratio"
    | "rim_diameter"
    | "load_index"
    | "speed_rating"
    | "quantity"
  >;
}

/**
 * Builds the label payload. Mirrors what `gorush_receive_unit` writes in SQL —
 * this TypeScript version is used for previews, tests, and any future path that
 * queues a label outside that RPC.
 */
export function buildLabelData(input: BuildLabelDataInput): LabelData {
  const size = formatTyreSize(input.item.width, input.item.aspect_ratio, input.item.rim_diameter);
  const brand = input.item.brand?.trim() || "";
  const descriptive = input.item.description?.trim() || input.item.raw_description?.trim() || "";

  const product = [brand, descriptive].filter(Boolean).join(" ").trim() || "Produs";

  const data: LabelData = {
    inventory_unit_id: input.inventoryUnitId,
    unit_token: input.unitToken,
    order_number: input.orderNumber,
    stand_code: input.standCode,
    customer: input.customerName?.trim() || "",
    product,
    brand,
    size: size ?? "",
    load_speed: `${input.item.load_index ?? ""}${input.item.speed_rating ?? ""}`,
    unit_index: input.unitIndex,
    unit_total: input.item.quantity,
    item_type: input.item.item_type,
  };

  assertLabelDataIsSafe(data as unknown as Record<string, unknown>);
  return data;
}

/**
 * The URL a phone gets when it scans the QR on a unit label. Gives warehouse
 * staff a read-only fallback when no handheld scanner is to hand.
 */
export function unitQrUrl(baseUrl: string, unitToken: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/u/${encodeURIComponent(unitToken)}`;
}

/** The URL encoded in the PERMANENT sticker on a physical stand. */
export function standQrUrl(baseUrl: string, standCode: StandCode): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/stand/${standCode}`;
}
