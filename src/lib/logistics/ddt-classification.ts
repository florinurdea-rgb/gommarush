/**
 * Line classification for the DDT/invoice import system.
 *
 * This is the one piece of the pipeline the spec is explicit AI must never
 * own: "AI-ul NU este source of truth pentru... identificarea PFU ca
 * produs." Classification here is rule-based and deterministic — an AI
 * extraction pass may propose an item_type, but this function (or a human)
 * makes the final call on which bucket a line falls into, and PFU/fee
 * detection always wins over whatever the AI guessed.
 */

export const CLASSIFIED_LINE_TYPES = [
  "TYRE",
  "TUBE",
  "RIM",
  "OTHER_PHYSICAL_ITEM",
  "PFU",
  "LOGISTICS_FEE",
  "TRANSPORT_FEE",
  "DISCOUNT",
  "VAT",
  "OTHER_FEE",
  "TEXT_NOTE",
  "UNKNOWN",
] as const;

export type ClassifiedLineType = (typeof CLASSIFIED_LINE_TYPES)[number];

const PHYSICAL_LINE_TYPES = new Set<ClassifiedLineType>(["TYRE", "TUBE", "RIM", "OTHER_PHYSICAL_ITEM"]);

export function isPhysicalLine(type: ClassifiedLineType): boolean {
  return PHYSICAL_LINE_TYPES.has(type);
}

/**
 * PFU — pneumatico fuori uso / the tyre environmental levy. Never a
 * product, per spec §9: "PFU NU este produs." Matches the exact codes and
 * phrasings the spec lists, plus the generic "PFU" token.
 */
const PFU_PATTERNS: RegExp[] = [
  /\bPFU\b/i,
  /contr\.?\s*amb\b/i,
  /contributo\s+ambiental/i,
  /eco\s*-?\s*contribut/i,
  /contributo\s+pneumatic/i,
  /\bEPP\d+\b/i,
  /\bCAP\d+\b/i,
  /\bETP\d+\b/i,
  /\bGTP\d+\b/i,
];

const LOGISTICS_FEE_PATTERNS: RegExp[] = [
  /addebito\s+spese\s+logistich/i,
  /spese\s+logistich/i,
  /spese\s+di\s+movimentazione/i,
  /recupero\s+spese\s+trasport/i,
  /\blogistics?\b/i,
];

const TRANSPORT_FEE_PATTERNS: RegExp[] = [
  /spese\s+di\s+trasport/i,
  /\btrasporto\b/i,
  /\bshipping\b/i,
  /\btransport\s*fee\b/i,
  /spese\s+accessori/i,
];

const DISCOUNT_PATTERNS: RegExp[] = [/\bsconto\b/i, /\bdiscount\b/i];

const VAT_PATTERNS: RegExp[] = [/\bIVA\b/, /\bVAT\b/, /\bbolli\b/i];

/** Order matters: PFU is checked first so it can never be shadowed by a broader fee pattern. */
const FEE_RULES: { patterns: RegExp[]; type: ClassifiedLineType }[] = [
  { patterns: PFU_PATTERNS, type: "PFU" },
  { patterns: LOGISTICS_FEE_PATTERNS, type: "LOGISTICS_FEE" },
  { patterns: TRANSPORT_FEE_PATTERNS, type: "TRANSPORT_FEE" },
  { patterns: DISCOUNT_PATTERNS, type: "DISCOUNT" },
  { patterns: VAT_PATTERNS, type: "VAT" },
];

/** The existing app-wide item_type vocabulary (src/lib/types/logistics.ts), for bridging with the rest of the system. */
type LegacyItemType = "tyre" | "tube" | "wheel" | "accessory" | "other" | "service" | "fee";

const LEGACY_TYPE_MAP: Partial<Record<LegacyItemType, ClassifiedLineType>> = {
  tyre: "TYRE",
  tube: "TUBE",
  wheel: "RIM",
  accessory: "OTHER_PHYSICAL_ITEM",
  other: "OTHER_PHYSICAL_ITEM",
  service: "OTHER_FEE",
  fee: "OTHER_FEE",
};

export interface ClassifyLineInput {
  rawDescription: string;
  /** A prior guess (e.g. from AI extraction or the existing item_type column) — text patterns always override this. */
  itemTypeHint?: LegacyItemType | null;
}

/**
 * Classifies one document line. Text patterns are checked first and always
 * win — a line literally captioned "PFU" is PFU even if an upstream
 * extraction pass tagged it "tyre". Falls back to the hint, then UNKNOWN
 * (never guesses a physical type from nothing).
 */
export function classifyLine(input: ClassifyLineInput): ClassifiedLineType {
  const text = input.rawDescription ?? "";

  for (const rule of FEE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.type;
  }

  const hinted = input.itemTypeHint ? LEGACY_TYPE_MAP[input.itemTypeHint] : undefined;
  return hinted ?? "UNKNOWN";
}
