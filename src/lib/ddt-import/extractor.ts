import "server-only";
import { logError, logEvent } from "@/lib/logger";
import { extractViaTextLayer } from "@/lib/ddt-import/text-fallback";
import type { ExtractedDocument, ExtractedLine, ExtractionResult } from "@/lib/ddt-import/types";

/**
 * Multi-document extraction for the DDT/invoice import pipeline.
 *
 * Sends the whole uploaded PDF as a single native `document` content block
 * (same approach as src/lib/documents/anthropic-analyzer.ts) and asks the
 * model to find and extract EVERY distinct logistics document inside it —
 * a ten-page upload might be one DDT repeated, ten different DDTs, or
 * anything in between; this call is what answers "how many documents are
 * actually in here."
 *
 * What the model is explicitly NOT trusted for (enforced downstream in
 * src/lib/ddt-import/pipeline.ts, using the deterministic src/lib/logistics/
 * ddt-* modules): whether a line is PFU/a fee vs. a real product, the final
 * tyre count, duplicate detection, or payment flags. It only proposes an
 * itemTypeHint per line and copies payment text verbatim — everything
 * safety-critical is decided by code afterward.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 170_000;

const SYSTEM_PROMPT = `You extract structured data from tyre-industry supplier documents (DDT / delivery notes / invoices) for a logistics system. A single uploaded PDF may contain MULTIPLE separate logistics documents — the same DDT repeated across pages, several different DDTs back to back, or one DDT continuing onto a following page. Your first job is to determine document boundaries: how many distinct logistics documents actually exist in this file, and which pages belong to each.

Documents may be Italian, Romanian, English or German, with completely different layouts per supplier. Do not assume any fixed layout.

CRITICAL ANTI-HALLUCINATION RULES:
- Extract ONLY information explicitly visible in the document. Never infer, guess, or complete a missing/partial value (e.g. a tyre size printed as "225/?? R18" must return aspectRatio: null — never fill in a plausible number).
- If a field is not clearly readable, return null. A wrong-but-plausible value is far worse than null: this data is matched against real customer records and billed against.
- "rawDescription" on every line MUST be the document's own text, copied verbatim, never rewritten or normalized.
- Never invent a tyre from a PFU, logistics, transport, discount, or tax line. Classify every line's likely nature via "itemTypeHint", but do not decide finality — a downstream deterministic step makes the real classification. PFU/environmental-levy quantities frequently repeat the tyre quantity on the same document; do not let that make you report a higher tyre count anywhere.
- "quantity" is null (never guessed as 1) if genuinely unreadable.
- "paymentText" must be the payment-related text COPIED VERBATIM from the document (e.g. "CASH AUTISTA", "Ricevuta Bancaria 30 GG") — do not interpret or classify it yourself; a deterministic rule downstream reads this text.
- If uncertain between two interpretations, return the uncertain/null value and add a note to "warnings" — never silently pick one.
- "confidence" (0-1) per document: be honest. Low confidence is useful signal, false confidence is not.

The DDT/document number (supplier_document_number) is the PRIMARY identifier for a logistics document — never confuse it with an unrelated order/reference number that may also appear on the page.

Return ONLY a JSON object, no prose, no markdown fences, matching exactly:

{
  "documents": [
    {
      "supplier": {"name": string|null, "vatNumber": string|null},
      "document": {
        "documentNumber": string|null, "documentType": string|null, "documentDate": "YYYY-MM-DD"|null,
        "supplierOrderReference": string|null, "trackingNumber": string|null, "giro": string|null,
        "agent": string|null, "carrier": string|null,
        "sourcePageStart": number|null, "sourcePageEnd": number|null, "colli": number|null
      },
      "customer": {
        "companyName": string|null, "vatNumber": string|null, "fiscalCode": string|null,
        "supplierCustomerCode": string|null, "deliveryRecipient": string|null,
        "addressLine1": string|null, "addressLine2": string|null, "city": string|null,
        "province": string|null, "postalCode": string|null, "country": string|null, "phone": string|null
      },
      "paymentText": string|null,
      "lines": [
        {
          "rawDescription": string,
          "itemTypeHint": "tyre"|"tube"|"wheel"|"accessory"|"other"|"service"|"fee"|null,
          "supplierArticleCode": string|null, "manufacturerCode": string|null, "ean": string|null,
          "brand": string|null, "model": string|null,
          "width": number|null, "aspectRatio": number|null, "rimDiameter": number|null,
          "loadIndex": string|null, "speedRating": string|null,
          "extraLoad": boolean|null, "runFlat": boolean|null, "commercial": boolean|null,
          "mudSnow": boolean|null, "threePmsf": boolean|null, "season": string|null,
          "quantity": number|null, "unitWeight": number|null, "unitPrice": number|null,
          "lineTotal": number|null, "vatPercent": number|null
        }
      ],
      "confidence": number,
      "warnings": string[]
    }
  ],
  "pageCount": number|null
}`;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

const LEGACY_ITEM_TYPES = new Set(["tyre", "tube", "wheel", "accessory", "other", "service", "fee"]);

function asItemTypeHint(value: unknown): ExtractedLine["itemTypeHint"] {
  return typeof value === "string" && LEGACY_ITEM_TYPES.has(value)
    ? (value as ExtractedLine["itemTypeHint"])
    : null;
}

function parseModelJson(text: string): unknown {
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

function coerceDocument(raw: unknown): ExtractedDocument {
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

export function isDdtExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function extractDdtDocuments(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    // No AI configured: fall back to the existing deterministic text-layer
    // parser rather than just failing — "textul va fi citit direct din
    // fișier acolo unde este posibil." Multi-document splitting still needs
    // AI (there's no reliable way to find DDT boundaries from raw text
    // alone), so a text-only pass always yields at most one document.
    const fallback = await extractViaTextLayer(input);
    const UNCONFIGURED_NOTES = [
      "Analiza automată nu este configurată.",
      "Documentul va fi stocat, iar textul va fi citit direct din fișier acolo unde este posibil. Datele care nu pot fi citite trebuie completate manual — sistemul nu inventează valori.",
    ];

    if (!fallback.foundData || !fallback.document) {
      return {
        status: "unconfigured",
        documents: [],
        pageCount: null,
        error: "UNCONFIGURED",
        notes: UNCONFIGURED_NOTES,
      };
    }

    return {
      status: "analysed",
      documents: [fallback.document],
      pageCount: null,
      error: null,
      notes: [
        ...UNCONFIGURED_NOTES,
        "Un singur document a putut fi citit din text — detectarea automată a mai multor DDT-uri într-un fișier necesită AI configurat.",
      ],
    };
  }

  const isPdf = input.mimeType === "application/pdf" || input.fileName.toLowerCase().endsWith(".pdf");
  const imageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!isPdf && !imageMimeTypes.includes(input.mimeType)) {
    return {
      status: "failed",
      documents: [],
      pageCount: null,
      error: "UNSUPPORTED_FILE_TYPE",
      notes: ["Formatul fișierului nu este acceptat pentru analiză automată."],
    };
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const base64 = input.bytes.toString("base64");
  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: input.mimeType, data: base64 } };

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
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              {
                type: "text",
                text: `Find and extract every distinct logistics document in this file (${input.fileName}). Return only the JSON object.`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      logError("ddt_extraction_http_error", new Error(`HTTP ${response.status}`), { status: response.status });
      return {
        status: "failed",
        documents: [],
        pageCount: null,
        error: `HTTP_${response.status}: ${detail.slice(0, 200)}`,
        notes: ["Analiza automată a eșuat."],
      };
    }

    const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    if (!text.trim()) {
      return { status: "failed", documents: [], pageCount: null, error: "EMPTY_RESPONSE", notes: ["Analiza automată nu a returnat date."] };
    }

    const parsed = parseModelJson(text) as { documents?: unknown[]; pageCount?: unknown };
    const documents = Array.isArray(parsed.documents) ? parsed.documents.map(coerceDocument) : [];

    logEvent("ddt_extraction_completed", { documentCount: documents.length });

    return {
      status: "analysed",
      documents,
      pageCount: asNumber(parsed.pageCount),
      error: null,
      notes: [],
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logError("ddt_extraction_failed", error, { aborted });
    return {
      status: "failed",
      documents: [],
      pageCount: null,
      error: error instanceof Error ? error.message : "UNKNOWN",
      notes: [aborted ? "Analiza a durat prea mult." : "Analiza automată a eșuat."],
    };
  } finally {
    clearTimeout(timeout);
  }
}
