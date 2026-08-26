import type { ExtractedDocument, ExtractedLine } from "@/lib/ddt-import/types";

/**
 * Turns a model's raw JSON into validated types — shared by every provider
 * (src/lib/ddt-import/*-provider.ts) so "how do we not trust the model's
 * shape blindly" is answered once, identically, regardless of which AI
 * produced the JSON.
 */

export function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const LEGACY_ITEM_TYPES = new Set(["tyre", "tube", "wheel", "accessory", "other", "service", "fee"]);

function asItemTypeHint(value: unknown): ExtractedLine["itemTypeHint"] {
  return typeof value === "string" && LEGACY_ITEM_TYPES.has(value) ? (value as ExtractedLine["itemTypeHint"]) : null;
}

/** Extracts a JSON object from a model's text response, tolerating a markdown fence or leading/trailing prose. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  let lastFenced: string | null = null;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  for (let match = fenced.exec(trimmed); match; match = fenced.exec(trimmed)) {
    lastFenced = match[1];
  }
  const candidate = lastFenced ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error("Model response was not valid JSON");
  }
}

function coerceLine(raw: unknown): ExtractedLine | null {
  const line = (raw ?? {}) as Record<string, unknown>;
  const rawDescription = asString(line.rawDescription);
  if (!rawDescription) return null;

  return {
    rawDescription,
    itemTypeHint: asItemTypeHint(line.itemTypeHint),
    supplierArticleCode: asString(line.supplierArticleCode),
    manufacturerCode: asString(line.manufacturerCode),
    ean: asString(line.ean),
    brand: asString(line.brand),
    model: asString(line.model),
    width: asNumber(line.width),
    aspectRatio: asNumber(line.aspectRatio),
    rimDiameter: asNumber(line.rimDiameter),
    loadIndex: asString(line.loadIndex),
    speedRating: asString(line.speedRating),
    extraLoad: asBoolean(line.extraLoad),
    runFlat: asBoolean(line.runFlat),
    commercial: asBoolean(line.commercial),
    mudSnow: asBoolean(line.mudSnow),
    threePmsf: asBoolean(line.threePmsf),
    season: asString(line.season),
    quantity: asNumber(line.quantity),
    unitWeight: asNumber(line.unitWeight),
    unitPrice: asNumber(line.unitPrice),
    lineTotal: asNumber(line.lineTotal),
    vatPercent: asNumber(line.vatPercent),
  };
}

export function coerceDocument(raw: unknown): ExtractedDocument {
  const root = (raw ?? {}) as Record<string, unknown>;
  const supplier = (root.supplier ?? {}) as Record<string, unknown>;
  const document = (root.document ?? {}) as Record<string, unknown>;
  const customer = (root.customer ?? {}) as Record<string, unknown>;
  const rawLines = Array.isArray(root.lines) ? root.lines : [];

  return {
    supplier: {
      name: asString(supplier.name),
      vatNumber: asString(supplier.vatNumber),
    },
    document: {
      documentNumber: asString(document.documentNumber),
      documentType: asString(document.documentType),
      documentDate: asString(document.documentDate),
      supplierOrderReference: asString(document.supplierOrderReference),
      trackingNumber: asString(document.trackingNumber),
      giro: asString(document.giro),
      agent: asString(document.agent),
      carrier: asString(document.carrier),
      sourcePageStart: asNumber(document.sourcePageStart),
      sourcePageEnd: asNumber(document.sourcePageEnd),
      colli: asNumber(document.colli),
    },
    customer: {
      companyName: asString(customer.companyName),
      vatNumber: asString(customer.vatNumber),
      fiscalCode: asString(customer.fiscalCode),
      supplierCustomerCode: asString(customer.supplierCustomerCode),
      deliveryRecipient: asString(customer.deliveryRecipient),
      addressLine1: asString(customer.addressLine1),
      addressLine2: asString(customer.addressLine2),
      city: asString(customer.city),
      province: asString(customer.province),
      postalCode: asString(customer.postalCode),
      country: asString(customer.country),
      phone: asString(customer.phone),
    },
    paymentText: asString(root.paymentText),
    lines: rawLines.map(coerceLine).filter((line): line is ExtractedLine => line !== null),
    confidence: asNumber(root.confidence) ?? 0.5,
    warnings: asStringArray(root.warnings),
  };
}

/** Parses the full `{ documents: [...], pageCount }` envelope from a model's JSON text. */
export function coerceExtractionEnvelope(text: string): { documents: ExtractedDocument[]; pageCount: number | null } {
  const parsed = parseModelJson(text) as { documents?: unknown[]; pageCount?: unknown };
  const documents = Array.isArray(parsed.documents) ? parsed.documents.map(coerceDocument) : [];
  return { documents, pageCount: asNumber(parsed.pageCount) };
}
