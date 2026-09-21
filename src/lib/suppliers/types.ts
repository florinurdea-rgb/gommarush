/**
 * Supplier-neutral domain contract.
 *
 * Every lane — Inter-Sprint (file/FTP), Deldo (file/FTP) and the manual Italian
 * ~48h supplier — produces the SAME shape. Source technology must never dictate
 * the business model (docs/architecture/00_README.md).
 *
 * Adapters return SUPPLIER COMMERCIAL FACTS ONLY. Nothing here computes a
 * customer price, applies markup, or decides tax. Pricing is a separate layer
 * (docs/architecture/03_PRICING_PFU_VAT.md).
 */

/** How an observation reached GommaRush. */
export type SourceType = "file_import" | "ftp_feed" | "api" | "manual";

/**
 * Explicit supplier capabilities. Absence means UNAVAILABLE — never infer a
 * capability from the fact that a lane has an integration
 * (docs/architecture/01_SUPPLIER_ARCHITECTURE.md).
 */
export const CAPABILITIES = [
  "catalogue_feed",
  "price_feed",
  "stock_feed",
  "live_stock_lookup",
  "live_price_lookup",
  "test_ordering",
  "production_ordering",
  "order_status",
  "delivery_documents",
  "invoices",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** How much to trust a stock figure. */
export type StockConfidence =
  | "exact"
  | "approximate"
  | "boolean_only"
  | "stated"
  | "unknown";

export type StockStatus =
  | "in_stock"
  | "low"
  | "out_of_stock"
  | "on_request"
  | "unknown";

export type DeliveryClass = "24h" | "48h" | "5_7d" | "unknown";

/**
 * PFU provenance. If the applicable PFU cannot be determined reliably the
 * answer is TO_CONFIRM — never an invented amount
 * (docs/architecture/03_PRICING_PFU_VAT.md).
 */
export type PfuStatus =
  | "SUPPLIER_EXACT"
  | "RULE_CALCULATED"
  | "MANUAL_CONFIRMED"
  | "TO_CONFIRM";

export interface PfuInformation {
  amount: number | null;
  status: PfuStatus;
  source: string | null;
}

/** EAN validation outcome, mirroring production's `ean_status` domain. */
export type EanStatus =
  | "valid"
  | "recovered_leading_zero"
  | "invalid_check_digit"
  | "missing";

/**
 * Supplier-independent product identity hints carried by an offer. These feed
 * catalogue matching; they are NOT themselves a catalogue product. A supplier
 * listing is not a product (docs/architecture/01_SUPPLIER_ARCHITECTURE.md).
 */
export interface ProductIdentityHints {
  brand?: string | null;
  brandCode?: string | null;
  modelPattern?: string | null;
  description?: string | null;
  productClass?: string | null;
  season?: string | null;
  widthMm?: number | null;
  aspectRatio?: number | null;
  rimInch?: number | null;
  sizeDisplay?: string | null;
  loadSpeedRaw?: string | null;
  loadIndex?: string | null;
  speedRating?: string | null;
  xl?: boolean | null;
  runFlat?: boolean | null;
  oldDot?: boolean | null;
  weightKg?: number | null;
  weightCategory?: string | null;
  eMark?: string | null;
  european?: boolean | null;
  manufacturerProductCode?: string | null;
}

/**
 * One normalized supplier observation. Unknown is always better than invented:
 * a field a supplier does not provide stays null, and callers must treat null
 * as "not supplied", never as zero.
 */
export interface SupplierOffer {
  /** Stable lane code, e.g. "intersprint" / "deldo" / "it_48h". */
  supplierLaneCode: string;
  /** The supplier's own article identifier. Always preserved. */
  supplierArticleId: string;
  /** Supplier's secondary item code, where provided. */
  supplierItemCode?: string | null;
  /** Deterministic listing key, `<LANE_PREFIX>:<articleId>`. */
  supplierListingKey: string;

  ean: string | null;
  eanStatus: EanStatus;
  /** Identity key: `GTIN:<ean>` when trustworthy, else provisional lane key. */
  productKey: string;
  productHints: ProductIdentityHints;

  /** SUPPLIER COST. Never a customer price. null = not supplied. */
  purchasePriceNet: number | null;
  currency: string;

  stockExact: number | null;
  stockStatus: StockStatus;
  stockConfidence: StockConfidence;

  leadTimeDays: number | null;
  deliveryClass: DeliveryClass;

  observedAt: string;
  priceVerifiedAt: string | null;
  stockVerifiedAt: string | null;

  sourceType: SourceType;
  /**
   * Structural guard. Deldo supplied sample files explicitly described as
   * fictional/non-current. Anything derived from them carries true and MUST be
   * excluded from every commercial query.
   */
  isTestData: boolean;

  pfu: PfuInformation;
  dotCode: string | null;

  /** Operator identity for the manual lane. */
  observedBy?: string | null;
  observationNote?: string | null;

  /** Machine-readable reasons this row needs human attention. */
  reviewReasons: string[];
  /** The untouched source row. Never discarded, never overwritten. */
  raw: unknown;
}

/**
 * The supplier adapter interface.
 *
 * NOTE: there is deliberately NO placeOrder / submitOrder / purchase method.
 * Not disabled, not commented out — ABSENT. A method that does not exist cannot
 * be called by mistake, which makes accidental supplier purchasing structurally
 * impossible. Adding one is an OWNER_DECISION (CLAUDE.md section 4).
 */
export interface SupplierAdapter {
  readonly laneCode: string;
  /** Explicit capability set. Absence means unavailable. */
  capabilities(): ReadonlySet<Capability>;
  /** Present only when the lane declares `catalogue_feed`. */
  parseCatalogueRows?(
    rows: unknown[],
    options: { isTestData: boolean; observedAt: string },
  ): SupplierOffer[];
  /** Present only when the lane declares `live_stock_lookup`/`live_price_lookup`. */
  lookupLive?(ean: string): Promise<SupplierOffer[]>;
}

/** Row-level outcome of parsing, so bad rows are rejected rather than guessed. */
export type ParseOutcome =
  | { ok: true; offer: SupplierOffer }
  | { ok: false; sourceRow: number | null; errors: string[]; raw: unknown };
