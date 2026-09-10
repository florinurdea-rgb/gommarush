import "server-only";
import { normaliseProduct } from "@/lib/logistics/product-normalise";
import type {
  AnalysisResult,
  ExtractedFinalCustomer,
  ExtractedPayment,
  ExtractedProductLine,
  ExtractedSupplier,
} from "@/lib/documents/analyzer";

/**
 * Deterministic parser for supplier documents that already carry a text layer.
 *
 * IMPORTANT DISTINCTION from the "no fabrication" rule: this reads values that
 * are literally present in the document's own text. It never invents one. Every
 * field it cannot find stays null and is named in `notes` / the line's
 * `reviewFields`, so the review screen asks a human instead of guessing.
 *
 * Confidence is deliberately capped below the AI path: layouts vary enormously,
 * so this is a head start for the Admin, not an authority.
 */

const LABELLED_VALUE = (labels: string[]) =>
  new RegExp(
    `(?:${labels.join("|")})\\s*[:.#nr°]*\\s*([A-Za-z0-9][A-Za-z0-9\\-\\/._]{1,30})`,
    "i"
  );

const DOCUMENT_NUMBER_PATTERN = LABELLED_VALUE([
  "fattura\\s*(?:n|nr|numero)?",
  "ddt\\s*(?:n|nr|numero)?",
  "documento\\s*(?:n|nr|numero)?",
  "bolla\\s*(?:n|nr|numero)?",
  "invoice\\s*(?:no|number)?",
  "factura\\s*(?:nr)?",
]);

const ORDER_REFERENCE_PATTERN = LABELLED_VALUE([
  "ordine\\s*(?:n|nr|numero)?",
  "vs\\.?\\s*ordine",
  "vostro\\s*ordine",
  "order\\s*(?:no|number|ref)?",
  "rif\\.?\\s*ordine",
  "comanda",
]);

const CUSTOMER_CODE_PATTERN = LABELLED_VALUE([
  "codice\\s*cliente",
  "cod\\.?\\s*cli",
  "cliente\\s*(?:n|nr|cod)",
  "customer\\s*(?:code|no)",
]);

/** dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, and ISO yyyy-mm-dd. */
const DATE_PATTERNS = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/,
  /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2})\b/,
];

const VAT_PATTERN =
  /(?:p\.?\s*iva|partita\s*iva|vat(?:\s*(?:no|number|id))?|c\.?f\.?|codice\s*fiscale|cui|cif)\s*[:.]?\s*([A-Z]{0,2}\s?[0-9]{8,13})/gi;

/** Italian-style amount: 1.234,56 or 1234.56 */
const AMOUNT_PATTERN = /(\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|\d+[.,]\d{2})/;

const COD_LABELS = [
  "contrassegno",
  "contanti alla consegna",
  "cash on delivery",
  "c/assegno",
  "ramburs",
];

const POSTAL_CITY_PATTERN = /\b(\d{5})\s+([A-Za-zÀ-ÿ'` .-]{2,40}?)\s*(?:\(([A-Za-z]{2})\))?\s*$/;

function toIsoDate(match: RegExpMatchArray): string | null {
  // Guarded because a "13/14/2026" style mis-read must produce null, not a
  // silently wrong date.
  let year: number, month: number, day: number;
  if (match[1].length === 4) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
    if (year < 100) year += 2000;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(text: string): number | null {
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return null;
  const raw = match[1].replace(/[.\s]/g, (char) => (char === "," ? "," : "")).replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match ? match[1].trim() : null;
}

/**
 * Company-ish lines: contain a legal form, or are mostly uppercase words. Used
 * to spot supplier/customer names without a fixed layout.
 */
function looksLikeCompanyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (/\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|gmbh|ltd|b\.?v\.?|sarl|srl)\b/i.test(trimmed)) {
    return true;
  }
  const words = trimmed.split(/\s+/).filter((w) => w.length > 1);
  if (words.length < 2 || words.length > 6) return false;
  const upper = words.filter((w) => w === w.toUpperCase() && /[A-Za-zÀ-ÿ]/.test(w)).length;
  return upper >= words.length - 1;
}

const DELIVERY_MARKERS = [
  "destinatario",
  "luogo di consegna",
  "indirizzo di consegna",
  "consegna presso",
  "spett.le",
  "spett le",
  "ship to",
  "deliver to",
  "delivery address",
  "livrare la",
];

/**
 * Extracts the delivery block: the lines after a "ship to"-style marker. Only
 * the first plausible block is used — grabbing every address on the page would
 * be worse than grabbing none.
 */
function extractDeliveryBlock(lines: string[]): {
  companyName: string | null;
  addressLine1: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
} {
  const empty = {
    companyName: null,
    addressLine1: null,
    postalCode: null,
    city: null,
    province: null,
  };

  const markerIndex = lines.findIndex((line) =>
    DELIVERY_MARKERS.some((marker) => line.toLowerCase().includes(marker))
  );
  if (markerIndex === -1) return empty;

  const block = lines.slice(markerIndex, markerIndex + 7).map((l) => l.trim()).filter(Boolean);

  let companyName: string | null = null;
  let addressLine1: string | null = null;
  let postalCode: string | null = null;
  let city: string | null = null;
  let province: string | null = null;

  for (const line of block) {
    const stripped = line
      .replace(new RegExp(`^(${DELIVERY_MARKERS.join("|")})\\s*[:.-]*\\s*`, "i"), "")
      .trim();
    if (!stripped) continue;

    if (!companyName && looksLikeCompanyLine(stripped)) {
      companyName = stripped;
      continue;
    }
    if (!addressLine1 && /\b(via|viale|piazza|corso|str|strada|localit|loc\.|km)\b/i.test(stripped)) {
      addressLine1 = stripped;
      continue;
    }
    const postal = POSTAL_CITY_PATTERN.exec(stripped);
    if (postal && !postalCode) {
      postalCode = postal[1];
      city = postal[2].trim();
      province = postal[3] ? postal[3].toUpperCase() : null;
    }
  }

  return { companyName, addressLine1, postalCode, city, province };
}

/**
 * Product lines: any line carrying a recognisable tyre size, plus lines that
 * clearly read as a fee. `normaliseProduct` then classifies each one and flags
 * what it could not read.
 */
function extractProductLines(lines: string[]): ExtractedProductLine[] {
  const products: ExtractedProductLine[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 6 || trimmed.length > 200) continue;

    const normalised = normaliseProduct(trimmed);
    const isProductish =
      normalised.width !== null ||
      normalised.itemType === "tube" ||
      normalised.itemType === "wheel" ||
      normalised.itemType === "fee";

    if (!isProductish) continue;

    // Quantity: a small standalone integer, or an explicit "qt/pz" label.
    const quantityMatch =
      /(?:q\.?t[àa]?|qty|pz|pezzi|buc)\s*[:.]?\s*(\d{1,3})\b/i.exec(trimmed) ??
      /^\s*(\d{1,3})\s+[A-Za-z]/.exec(trimmed);
    const quantity = quantityMatch ? Number(quantityMatch[1]) : null;

    const price = parseAmount(trimmed);

    const reviewFields = [...normalised.reviewFields];
    if (quantity === null) reviewFields.push("quantity");

    products.push({
      rawDescription: trimmed,
      itemType: normalised.itemType,
      brand: normalised.brand,
      model: normalised.model,
      width: normalised.width,
      aspectRatio: normalised.aspectRatio,
      rimDiameter: normalised.rimDiameter,
      loadIndex: normalised.loadIndex,
      speedRating: normalised.speedRating,
      extraLoad: normalised.extraLoad,
      runFlat: normalised.runFlat,
      quantity,
      unitPrice: price,
      reviewFields,
      // Capped: a regex over an unknown layout is a starting point, not truth.
      confidence: Math.min(normalised.confidence, 0.6),
    });
  }

  return products;
}

export function parseInvoiceText(text: string, provider: string): AnalysisResult {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const notes: string[] = [];
  const fieldConfidence: Record<string, number> = {};

  // --- Supplier ---------------------------------------------------------
  const documentNumber = firstMatch(text, DOCUMENT_NUMBER_PATTERN);
  const orderReference = firstMatch(text, ORDER_REFERENCE_PATTERN);

  let documentDate: string | null = null;
  for (const pattern of DATE_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      documentDate = toIsoDate(match);
      if (documentDate) break;
    }
  }

  // The supplier's own header is almost always in the first few lines.
  const supplierName = lines.slice(0, 8).find(looksLikeCompanyLine) ?? null;

  const vatNumbers: string[] = [];
  let vatMatch: RegExpExecArray | null;
  const vatPattern = new RegExp(VAT_PATTERN.source, VAT_PATTERN.flags);
  while ((vatMatch = vatPattern.exec(text)) !== null) {
    const value = vatMatch[1].replace(/\s/g, "");
    if (!vatNumbers.includes(value)) vatNumbers.push(value);
  }

  const supplier: ExtractedSupplier = {
    name: supplierName,
    // First VAT on the page belongs to the issuer far more often than not; the
    // second, when present, is the customer's.
    vatNumber: vatNumbers[0] ?? null,
    documentNumber,
    documentDate,
    orderReference,
  };

  if (supplierName) fieldConfidence["supplier.name"] = 0.45;
  else notes.push("Furnizorul nu a putut fi identificat automat.");
  if (documentNumber) fieldConfidence["supplier.documentNumber"] = 0.6;
  else notes.push("Numero del documento non trovato.");

  // --- Customer ---------------------------------------------------------
  const delivery = extractDeliveryBlock(lines);
  const customer: ExtractedFinalCustomer = {
    companyName: delivery.companyName,
    supplierCustomerCode: firstMatch(text, CUSTOMER_CODE_PATTERN),
    vatNumber: vatNumbers[1] ?? null,
    deliveryRecipient: delivery.companyName,
    addressLine1: delivery.addressLine1,
    postalCode: delivery.postalCode,
    city: delivery.city,
    province: delivery.province,
    country: null,
  };

  if (delivery.companyName) fieldConfidence["customer.companyName"] = 0.4;
  else notes.push("Il cliente finale non è stato identificato automaticamente — inseriscilo manualmente.");
  if (!delivery.addressLine1 && !delivery.city) {
    notes.push("L'indirizzo di consegna non è stato trovato nel documento.");
  }

  // --- Payment ----------------------------------------------------------
  const lowerText = text.toLowerCase();
  const codLine = lines.find((line) => COD_LABELS.some((label) => line.toLowerCase().includes(label)));
  const cashOnDelivery = COD_LABELS.some((label) => lowerText.includes(label));

  const payment: ExtractedPayment = {
    cashOnDelivery: cashOnDelivery ? true : null,
    amountToCollect: codLine ? parseAmount(codLine) : null,
    paymentMethod: cashOnDelivery ? "contrassegno" : null,
    collectionMethod: null,
    currency: /€|eur/i.test(text) ? "EUR" : null,
  };

  if (cashOnDelivery && payment.amountToCollect === null) {
    notes.push("Il pagamento alla consegna è stato rilevato, ma l'importo non è leggibile.");
  }

  // --- Products ---------------------------------------------------------
  const products = extractProductLines(lines);
  if (products.length === 0) {
    notes.push("Nessuna riga prodotto estratta — aggiungi i prodotti manualmente.");
  } else {
    fieldConfidence["products"] = 0.5;
    notes.push(
      `${products.length} righe prodotto estratte automaticamente — controlla quantità e misure.`
    );
  }

  return {
    status: "analysed",
    provider,
    supplier,
    customer,
    payment,
    products,
    fieldConfidence,
    notes,
    extractedText: text.slice(0, 20000),
    error: null,
  };
}
