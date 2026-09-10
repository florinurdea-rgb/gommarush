// Order type: transport job vs own sale.
//
// This is the most commercially consequential field on an imported order,
// because the same numbers mean opposite things in the two cases:
//
//   TRANSPORT_JOB (Trasporto per conto terzi) — we move someone else's
//     goods. The document's product totals are NOT our revenue; our revenue
//     is the transport rate. Treating them as sales would invent income.
//
//   OWN_SALE (Vendita GommaRush) — we bought and are selling. The document
//     gives supplier COST, never the customer selling price. Treating cost as
//     the sale price would destroy the margin.
//
// So detection SUGGESTS and a human CONFIRMS. Confidence alone never makes an
// ambiguous document auto-confirmable, however high it is.
//
// Pure and dependency-free.

export type OrderType = "TRANSPORT_JOB" | "OWN_SALE";

export const ORDER_TYPES: readonly OrderType[] = ["TRANSPORT_JOB", "OWN_SALE"];

/** Italian operator-facing labels. */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  TRANSPORT_JOB: "Trasporto per conto terzi",
  OWN_SALE: "Vendita GommaRush",
};

/**
 * Where a suggestion came from, in the specification's precedence order.
 * The source is stored because "why did it pick this" must be answerable
 * months later.
 */
export type OrderTypeDetectionSource =
  | "APPROVED_MAPPING"
  | "DOCUMENT_EVIDENCE"
  | "RELATIONSHIP_CONFIG"
  | "OPERATOR"
  | "LEGACY_UNKNOWN";

export interface OrderTypeSuggestion {
  suggested: OrderType | null;
  source: OrderTypeDetectionSource | null;
  confidence: number;
  /** Human-readable reasons, shown verbatim to the operator. */
  evidence: string[];
  /** True when a human must choose before the order can be created. */
  requiresOperator: boolean;
  /** Set when stored memory and fresh evidence disagree. */
  conflict: { mappingSays: OrderType; evidenceSays: OrderType } | null;
}

/**
 * Document wording that indicates a transport instruction.
 * Narrow on purpose — a broad match here mislabels the commercial nature of
 * the whole order.
 */
const TRANSPORT_EVIDENCE: { pattern: RegExp; why: string }[] = [
  { pattern: /\bconto\s+terzi\b/i, why: "Il documento indica «conto terzi»" },
  { pattern: /\btrasporto\s+per\s+conto\b/i, why: "Il documento indica un trasporto per conto di terzi" },
  { pattern: /\bc\/o\s+terzi\b/i, why: "Il documento indica «c/o terzi»" },
  { pattern: /\bvettore\b/i, why: "Il documento nomina un vettore" },
  { pattern: /\bmittente\b.*\bdestinatario\b/is, why: "Il documento distingue mittente e destinatario" },
];

/** Wording that indicates GommaRush is the seller. */
const OWN_SALE_EVIDENCE: { pattern: RegExp; why: string }[] = [
  { pattern: /\bfattura\s+(?:di\s+)?vendita\b/i, why: "Il documento è una fattura di vendita" },
  { pattern: /\bgommarush\b/i, why: "GommaRush compare come intestatario del documento" },
];

export interface OrderTypeDetectionInput {
  /** An approved mapping for this issuer/document pattern, if one exists. */
  approvedMapping: { orderType: OrderType; useCount: number } | null;
  /** Concatenated document text used only for evidence matching. */
  documentText: string | null;
  /** Explicit configuration on the supplier/customer relationship. */
  relationshipConfig: OrderType | null;
}

/**
 * Applies the precedence the specification fixes:
 *   1. an approved mapping for this supplier/document pattern
 *   2. explicit document evidence
 *   3. relationship configuration
 *   4. otherwise the operator must choose
 *
 * A conflict between a stored mapping and fresh document evidence is never
 * resolved silently: history must not override contradictory evidence, so
 * both are reported and a human decides.
 */
export function detectOrderType(input: OrderTypeDetectionInput): OrderTypeSuggestion {
  const text = input.documentText ?? "";

  const transportHits = TRANSPORT_EVIDENCE.filter((rule) => rule.pattern.test(text));
  const ownSaleHits = OWN_SALE_EVIDENCE.filter((rule) => rule.pattern.test(text));

  // Evidence is only usable when it points one way. Both kinds present means
  // the document is genuinely ambiguous, not that one side wins on count.
  const evidenceType: OrderType | null =
    transportHits.length > 0 && ownSaleHits.length === 0
      ? "TRANSPORT_JOB"
      : ownSaleHits.length > 0 && transportHits.length === 0
        ? "OWN_SALE"
        : null;

  // --- 1. approved mapping -------------------------------------------------
  if (input.approvedMapping) {
    const mapped = input.approvedMapping.orderType;

    if (evidenceType && evidenceType !== mapped) {
      return {
        suggested: null,
        source: null,
        confidence: 0,
        evidence: [
          `Conflitto: le conferme precedenti indicano «${ORDER_TYPE_LABELS[mapped]}», il documento indica «${ORDER_TYPE_LABELS[evidenceType]}».`,
          ...[...transportHits, ...ownSaleHits].map((rule) => rule.why),
        ],
        requiresOperator: true,
        conflict: { mappingSays: mapped, evidenceSays: evidenceType },
      };
    }

    return {
      suggested: mapped,
      source: "APPROVED_MAPPING",
      confidence: 1,
      evidence: [
        input.approvedMapping.useCount > 1
          ? `Confermato in ${input.approvedMapping.useCount} documenti precedenti dello stesso fornitore`
          : "Confermato in un documento precedente dello stesso fornitore",
      ],
      requiresOperator: false,
      conflict: null,
    };
  }

  // --- 2. document evidence ------------------------------------------------
  if (evidenceType) {
    const hits = evidenceType === "TRANSPORT_JOB" ? transportHits : ownSaleHits;
    return {
      suggested: evidenceType,
      source: "DOCUMENT_EVIDENCE",
      confidence: 0.8,
      evidence: hits.map((rule) => rule.why),
      // Evidence is a suggestion, never a confirmation. Wording varies too
      // much between suppliers to bet the commercial classification on it.
      requiresOperator: true,
      conflict: null,
    };
  }

  // --- 3. relationship configuration --------------------------------------
  if (input.relationshipConfig) {
    return {
      suggested: input.relationshipConfig,
      source: "RELATIONSHIP_CONFIG",
      confidence: 0.6,
      evidence: ["Impostazione predefinita della relazione con questo fornitore"],
      requiresOperator: true,
      conflict: null,
    };
  }

  // --- 4. nothing to go on -------------------------------------------------
  if (transportHits.length > 0 && ownSaleHits.length > 0) {
    return {
      suggested: null,
      source: null,
      confidence: 0,
      evidence: [
        "Il documento contiene indizi contrastanti: seleziona il tipo di ordine.",
        ...[...transportHits, ...ownSaleHits].map((rule) => rule.why),
      ],
      requiresOperator: true,
      conflict: null,
    };
  }

  return {
    suggested: null,
    source: null,
    confidence: 0,
    evidence: ["Nessun indizio sufficiente nel documento: seleziona il tipo di ordine."],
    requiresOperator: true,
    conflict: null,
  };
}

/**
 * Whether the confirmed type is usable for order creation.
 * A suggestion is never enough — `confirmed_order_type` has to be set, and
 * the schema additionally requires it to be attributed.
 */
export function isOrderTypeConfirmable(confirmed: OrderType | null): boolean {
  return confirmed !== null && (ORDER_TYPES as readonly string[]).includes(confirmed);
}

export interface RevenueTreatment {
  /** May the document's product totals be recorded as GommaRush revenue? */
  productTotalsAreRevenue: boolean;
  /** Should the document's values be stored as supplier cost? */
  documentValuesAreSupplierCost: boolean;
  /** Is transport revenue computed from the configured rate? */
  transportRevenueFromRate: boolean;
}

/**
 * The commercial consequence of the order type, in one place.
 *
 * Neither type lets a supplier document's prices become a customer selling
 * price. That is the single rule both branches share, and the one whose
 * violation is hardest to notice afterwards.
 */
export function revenueTreatmentFor(orderType: OrderType): RevenueTreatment {
  if (orderType === "TRANSPORT_JOB") {
    return {
      productTotalsAreRevenue: false,
      documentValuesAreSupplierCost: false,
      transportRevenueFromRate: true,
    };
  }
  return {
    productTotalsAreRevenue: false,
    documentValuesAreSupplierCost: true,
    transportRevenueFromRate: false,
  };
}
