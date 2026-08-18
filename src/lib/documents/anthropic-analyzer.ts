import "server-only";
import { logError, logEvent } from "@/lib/logger";
import { normaliseProduct } from "@/lib/logistics/product-normalise";
import { emptyResult } from "@/lib/documents/analyzer";
import type {
  AnalysisResult,
  AnalyzableDocument,
  DocumentAnalyzer,
  ExtractedProductLine,
} from "@/lib/documents/analyzer";

/**
 * Vision/OCR analyzer backed by the Anthropic Messages API.
 *
 * Called through plain `fetch` rather than the SDK: this is one request with a
 * fixed shape, and avoiding the dependency keeps the serverless bundle small.
 *
 * Adding a different provider means writing another `DocumentAnalyzer` — no
 * business logic lives here, only extraction.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 90_000;

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * The instruction that carries the honesty rule into the model. "Use null"
 * appears repeatedly and deliberately: a plausible invented VAT number or
 * address is far more damaging here than an empty field, because it would be
 * matched against real customer records.
 */
const SYSTEM_PROMPT = `You extract structured data from tyre-industry supplier documents (invoices, delivery notes, DDT) for a logistics system. Documents may be Italian, Romanian, English or German, with completely different layouts.

Return ONLY a JSON object, no prose, no markdown fences, matching exactly:

{
  "supplier": {"name": string|null, "vatNumber": string|null, "fiscalCode": string|null, "documentNumber": string|null, "documentDate": "YYYY-MM-DD"|null, "orderReference": string|null},
  "customer": {"companyName": string|null, "supplierCustomerCode": string|null, "vatNumber": string|null, "fiscalCode": string|null, "deliveryRecipient": string|null, "addressLine1": string|null, "addressLine2": string|null, "postalCode": string|null, "city": string|null, "province": string|null, "country": string|null},
  "payment": {"paymentMethod": string|null, "cashOnDelivery": boolean|null, "amountToCollect": number|null, "collectionMethod": string|null, "currency": string|null},
  "products": [{"supplierSku": string|null, "rawDescription": string, "itemType": "tyre"|"tube"|"wheel"|"accessory"|"service"|"fee"|"other", "brand": string|null, "model": string|null, "width": number|null, "aspectRatio": number|null, "rimDiameter": number|null, "loadIndex": string|null, "speedRating": string|null, "extraLoad": boolean|null, "runFlat": boolean|null, "quantity": number|null, "unitPrice": number|null, "taxRate": number|null, "pfuFee": number|null, "logisticsFee": number|null, "confidence": number, "reviewFields": string[]}],
  "fieldConfidence": {"<dotted.path>": number},
  "notes": [string]
}

CRITICAL RULES:
- NEVER invent a value. If a field is not clearly readable in the document, use null and add its name to that line's "reviewFields" (or mention it in "notes" for header fields). A wrong-but-plausible value is far worse than null: these are matched against real customer records.
- "rawDescription" MUST be the document's own product text, copied verbatim, never rewritten.
- The CUSTOMER is the final recipient of the goods (look for Destinatario / Luogo di consegna / Spett.le / Ship to), NOT the document issuer. The issuer is the supplier.
- Include EVERY line, including fees: PFU / contributo ambientale / eco-tax => itemType "fee"; trasporto / spedizione / transport => itemType "fee"; montaggio / servizio => itemType "service".
- A tyre size like 225/55 R18 means width 225, aspectRatio 55, rimDiameter 18.
- "cashOnDelivery" is true only when the document actually says contrassegno / cash on delivery / ramburs.
- "confidence" is 0-1 per product line. Be honest: low confidence is useful, false confidence is not.
- Dates are always "YYYY-MM-DD" regardless of the source's own format (31/12/2026, 31.12.2026, 31-dic-2026 all mean 2026-12-31) — convert the format, never the value.
- Numbers use "." as the decimal separator in your output even if the document prints "," (1.234,56 in the source is 1234.56 in your JSON, never 1.234).
- Every text field (names, addresses, descriptions, VAT/fiscal codes) is copied exactly as printed, just trimmed — never translate, reformat, re-case, or re-group it.`;

function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  // Models occasionally wrap JSON in a fence despite instructions.
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    // Last resort: the outermost object in the response.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model response was not valid JSON");
  }
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Coerces the model's JSON into our types. Everything is validated rather than
 * trusted: a model returning `"quantity": "four"` must not reach the database.
 */
function coerceResult(raw: unknown, provider: string): AnalysisResult {
  const root = (raw ?? {}) as Record<string, unknown>;
  const supplier = (root.supplier ?? {}) as Record<string, unknown>;
  const customer = (root.customer ?? {}) as Record<string, unknown>;
  const payment = (root.payment ?? {}) as Record<string, unknown>;
  const rawProducts = Array.isArray(root.products) ? root.products : [];

  const products: ExtractedProductLine[] = rawProducts
    .map((entry): ExtractedProductLine | null => {
      const line = (entry ?? {}) as Record<string, unknown>;
      const rawDescription = asString(line.rawDescription);
      if (!rawDescription) return null;

      // Our own normaliser fills structural gaps the model left null. It only
      // ever adds — it never overwrites something the model actually read.
      const local = normaliseProduct(rawDescription);
      const itemType = asString(line.itemType) ?? local.itemType;
      const width = asNumber(line.width) ?? local.width;
      const aspectRatio = asNumber(line.aspectRatio) ?? local.aspectRatio;
      const rimDiameter = asNumber(line.rimDiameter) ?? local.rimDiameter;

      const reviewFields = new Set(asStringArray(line.reviewFields));
      if (asNumber(line.quantity) === null) reviewFields.add("quantity");
      if (itemType === "tyre" && width === null) reviewFields.add("size");

      return {
        supplierSku: asString(line.supplierSku),
        rawDescription,
        itemType,
        brand: asString(line.brand) ?? local.brand,
        model: asString(line.model) ?? local.model,
        width,
        aspectRatio,
        rimDiameter,
        loadIndex: asString(line.loadIndex) ?? local.loadIndex,
        speedRating: asString(line.speedRating) ?? local.speedRating,
        extraLoad: asBoolean(line.extraLoad) ?? local.extraLoad,
        runFlat: asBoolean(line.runFlat) ?? local.runFlat,
        quantity: asNumber(line.quantity),
        unitPrice: asNumber(line.unitPrice),
        taxRate: asNumber(line.taxRate),
        pfuFee: asNumber(line.pfuFee),
        logisticsFee: asNumber(line.logisticsFee),
        reviewFields: [...reviewFields],
        confidence: asNumber(line.confidence) ?? 0.5,
      };
    })
    .filter((line): line is ExtractedProductLine => line !== null);

  const fieldConfidence: Record<string, number> = {};
  if (root.fieldConfidence && typeof root.fieldConfidence === "object") {
    for (const [key, value] of Object.entries(root.fieldConfidence as Record<string, unknown>)) {
      const numeric = asNumber(value);
      if (numeric !== null) fieldConfidence[key] = numeric;
    }
  }

  return {
    status: "analysed",
    provider,
    supplier: {
      name: asString(supplier.name),
      vatNumber: asString(supplier.vatNumber),
      fiscalCode: asString(supplier.fiscalCode),
      documentNumber: asString(supplier.documentNumber),
      documentDate: asString(supplier.documentDate),
      orderReference: asString(supplier.orderReference),
    },
    customer: {
      companyName: asString(customer.companyName),
      supplierCustomerCode: asString(customer.supplierCustomerCode),
      vatNumber: asString(customer.vatNumber),
      fiscalCode: asString(customer.fiscalCode),
      deliveryRecipient: asString(customer.deliveryRecipient),
      addressLine1: asString(customer.addressLine1),
      addressLine2: asString(customer.addressLine2),
      postalCode: asString(customer.postalCode),
      city: asString(customer.city),
      province: asString(customer.province),
      country: asString(customer.country),
    },
    payment: {
      paymentMethod: asString(payment.paymentMethod),
      cashOnDelivery: asBoolean(payment.cashOnDelivery),
      amountToCollect: asNumber(payment.amountToCollect),
      collectionMethod: asString(payment.collectionMethod),
      currency: asString(payment.currency),
    },
    products,
    fieldConfidence,
    notes: asStringArray(root.notes),
    error: null,
  };
}

export class AnthropicDocumentAnalyzer implements DocumentAnalyzer {
  readonly name = "anthropic";

  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async analyze(document: AnalyzableDocument): Promise<AnalysisResult> {
    // Trimmed: a stray trailing space/newline pasted into Vercel's env var
    // UI would otherwise make every request fail at the network layer
    // instead of just being "missing" — see src/lib/supabase/config.ts.
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      return emptyResult("unconfigured", this.name, ["ANTHROPIC_API_KEY nu este configurat."]);
    }

    const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
    const base64 = document.bytes.toString("base64");

    let contentBlock: Record<string, unknown>;
    if (document.mimeType === "application/pdf") {
      contentBlock = {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      };
    } else if (IMAGE_MIME_TYPES.includes(document.mimeType)) {
      contentBlock = {
        type: "image",
        source: { type: "base64", media_type: document.mimeType, data: base64 },
      };
    } else {
      // HEIC and DOCX aren't accepted as native blocks. The caller handles
      // those via text extraction; reaching here means we genuinely can't.
      return emptyResult(
        "failed",
        this.name,
        [`Formatul ${document.mimeType} nu poate fi analizat automat. Completează manual.`],
        "UNSUPPORTED_FOR_VISION"
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          max_tokens: 8000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                contentBlock,
                {
                  type: "text",
                  text: `Extract the structured data from this supplier document (${document.fileName}). Return only the JSON object.`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        logError("document_analysis_http_error", new Error(`HTTP ${response.status}`), {
          status: response.status,
        });
        return emptyResult(
          "failed",
          this.name,
          ["Analiza automată a eșuat. Completează datele manual."],
          `HTTP_${response.status}: ${detail.slice(0, 200)}`
        );
      }

      const payload = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };
      const text = (payload.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");

      if (!text.trim()) {
        return emptyResult(
          "failed",
          this.name,
          ["Analiza automată nu a returnat date. Completează manual."],
          "EMPTY_RESPONSE"
        );
      }

      const result = coerceResult(parseModelJson(text), this.name);
      logEvent("document_analysed", {
        provider: this.name,
        productCount: result.products.length,
      });
      return result;
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      logError("document_analysis_failed", error, { aborted });
      return emptyResult(
        "failed",
        this.name,
        [
          aborted
            ? "Analiza automată a durat prea mult. Completează datele manual."
            : "Analiza automată a eșuat. Completează datele manual.",
        ],
        error instanceof Error ? error.message : "UNKNOWN"
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
