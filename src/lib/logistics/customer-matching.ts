// Customer / delivery-location matching for document import.
//
// The governing rule: customer master data is NEVER silently overwritten.
// A newly scanned document that disagrees with what we already know produces a
// decision for a human, not an UPDATE.
//
// Three outcomes, as specified:
//   match_confirmed  company AND location match confidently
//   possible_match   company looks familiar but details/address differ -> review
//   new_customer     no safe existing match -> offer to create
//   new_location     company is certain, address is not one we hold -> offer
//                    "this order only" / "add location" / "update location"
//
// Pure and dependency-free so it is directly testable.

import type { CustomerLocationRow, CustomerRow } from "@/lib/types/logistics";

export interface ExtractedCustomer {
  companyName?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  /** The code the supplier uses for this customer, if printed on the document. */
  supplierCustomerCode?: string | null;
}

export interface ExtractedLocation {
  recipientName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export type CustomerMatchKind =
  | "match_confirmed"
  | "possible_match"
  | "new_customer"
  | "new_location";

/** What the Admin may do about a location that differs from our records. */
export type LocationResolution =
  | "use_existing"
  | "use_for_this_order_only"
  | "add_as_new_location"
  | "update_existing_location";

export interface CustomerCandidate {
  customer: CustomerRow;
  /** 0–1. 1 means an exact identifier match (VAT / supplier code). */
  score: number;
  reasons: string[];
}

export interface LocationCandidate {
  location: CustomerLocationRow;
  score: number;
  /** Fields that disagree between the document and this stored location. */
  differences: string[];
}

export interface CustomerMatchResult {
  kind: CustomerMatchKind;
  customer: CustomerRow | null;
  location: CustomerLocationRow | null;
  customerCandidates: CustomerCandidate[];
  locationCandidates: LocationCandidate[];
  /** Fields the Admin should look at before saving. */
  differences: string[];
  /** Resolutions the UI should offer for the delivery location. */
  allowedResolutions: LocationResolution[];
  /** True when a human must look at this before the order can be saved. */
  requiresReview: boolean;
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Lowercase, strip accents, collapse whitespace. */
export function normaliseText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const COMPANY_SUFFIXES = [
  "srl",
  "s r l",
  "spa",
  "s p a",
  "snc",
  "s n c",
  "sas",
  "s a s",
  "sarl",
  "srls",
  "ltd",
  "gmbh",
  "bv",
  "nv",
  "sa",
  "ag",
  "kg",
  "oy",
  "ab",
  "as",
  "aps",
  "plc",
  "inc",
  "llc",
  "co",
  "sl",
  "sro",
];

/**
 * Company-name key for comparison: accents, punctuation, and legal-form
 * suffixes removed. "Rossi Gomme S.r.l." and "ROSSI GOMME SRL" collapse to the
 * same key, which is what makes an exact-name match trustworthy.
 */
export function companyKey(name: string | null | undefined): string {
  const base = normaliseText(name)
    .replace(/[.,'`&\/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";

  const words = base.split(" ").filter(Boolean);

  // Strip trailing legal forms, longest phrase first. This has to consider
  // multi-word tails because punctuation removal turns "S.r.l." into three
  // separate letters — and "Rossi Gomme S.r.l." must key the same as
  // "ROSSI GOMME SRL", or the same company gets duplicated on every import.
  let stripped = true;
  while (stripped && words.length > 1) {
    stripped = false;
    for (let take = Math.min(3, words.length - 1); take >= 1; take -= 1) {
      const tail = words.slice(-take).join(" ");
      if (COMPANY_SUFFIXES.includes(tail)) {
        words.splice(-take, take);
        stripped = true;
        break;
      }
    }
  }

  return words.join(" ");
}

/** VAT/fiscal identifiers: uppercase alphanumerics only. */
export function identifierKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Italian VAT numbers are frequently written both with and without the country
 * prefix ("IT01234567890" vs "01234567890"). Compare on the digits so the same
 * company isn't duplicated over a formatting difference.
 */
function identifiersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = identifierKey(a);
  const kb = identifierKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const digitsA = ka.replace(/^[A-Z]{2}/, "");
  const digitsB = kb.replace(/^[A-Z]{2}/, "");
  return digitsA.length >= 8 && digitsA === digitsB;
}

export function postalKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Street-address key: accents/punctuation gone, common street words dropped. */
export function streetKey(value: string | null | undefined): string {
  const base = normaliseText(value).replace(/[.,'`\-\/\\]/g, " ");
  return base
    .split(" ")
    .filter((word) => word && !["via", "viale", "v", "str", "strada", "piazza", "p", "corso", "n", "nr", "no"].includes(word))
    .join(" ")
    .trim();
}

/** Token overlap, 0–1. Cheap stand-in for a real similarity metric. */
function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let shared = 0;
  for (const token of tokensA) if (tokensB.has(token)) shared += 1;
  return shared / Math.max(tokensA.size, tokensB.size);
}

// ---------------------------------------------------------------------------
// Company matching
// ---------------------------------------------------------------------------

/** Above this, a name-only match is treated as the same company. */
const NAME_MATCH_THRESHOLD = 0.99;
/** Above this, worth showing as a possible match for human review. */
const NAME_REVIEW_THRESHOLD = 0.5;

export function rankCustomerCandidates(
  extracted: ExtractedCustomer,
  customers: readonly CustomerRow[],
  options: { supplierRefCustomerId?: string | null } = {}
): CustomerCandidate[] {
  const key = companyKey(extracted.companyName);
  const candidates: CustomerCandidate[] = [];

  for (const customer of customers) {
    const reasons: string[] = [];
    let score = 0;

    // An identifier match is decisive: VAT codes are unique by law.
    if (identifiersMatch(extracted.vatNumber, customer.vat_number)) {
      score = 1;
      reasons.push("vat_number");
    } else if (identifiersMatch(extracted.fiscalCode, customer.fiscal_code)) {
      score = 1;
      reasons.push("fiscal_code");
    }

    // So is the supplier's own customer code, once we've learned it.
    if (options.supplierRefCustomerId && options.supplierRefCustomerId === customer.id) {
      score = Math.max(score, 1);
      reasons.push("supplier_customer_code");
    }

    const nameScore = tokenSimilarity(key, companyKey(customer.name));
    if (nameScore > 0) {
      if (nameScore >= NAME_MATCH_THRESHOLD) reasons.push("name_exact");
      else reasons.push("name_partial");
      score = Math.max(score, nameScore);
    }

    if (score > 0) candidates.push({ customer, score, reasons });
  }

  return candidates.sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name));
}

// ---------------------------------------------------------------------------
// Location matching
// ---------------------------------------------------------------------------

/** Which stored fields disagree with the document. */
export function locationDifferences(
  extracted: ExtractedLocation,
  location: CustomerLocationRow
): string[] {
  const differences: string[] = [];
  const compare = (field: string, a: string, b: string) => {
    if (a && b && a !== b) differences.push(field);
  };

  compare("address_line1", streetKey(extracted.addressLine1), streetKey(location.address_line1));
  compare("city", normaliseText(extracted.city), normaliseText(location.city));
  compare("postal_code", postalKey(extracted.postalCode), postalKey(location.postal_code));
  compare("province", normaliseText(extracted.province), normaliseText(location.province));
  return differences;
}

export function rankLocationCandidates(
  extracted: ExtractedLocation,
  locations: readonly CustomerLocationRow[]
): LocationCandidate[] {
  const candidates: LocationCandidate[] = [];

  for (const location of locations) {
    let score = 0;
    const streetMatch = tokenSimilarity(
      streetKey(extracted.addressLine1),
      streetKey(location.address_line1)
    );
    const cityMatch = tokenSimilarity(normaliseText(extracted.city), normaliseText(location.city));
    const postalMatch =
      postalKey(extracted.postalCode) && postalKey(extracted.postalCode) === postalKey(location.postal_code)
        ? 1
        : 0;

    // Postcode + street is the strongest signal; city alone is weak, because a
    // company can easily have two branches in the same city.
    score = postalMatch * 0.4 + streetMatch * 0.4 + cityMatch * 0.2;

    if (score > 0) {
      candidates.push({ location, score, differences: locationDifferences(extracted, location) });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}

/** Above this, the document's address is considered the same physical place. */
const LOCATION_MATCH_THRESHOLD = 0.75;

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export interface MatchCustomerInput {
  extractedCustomer: ExtractedCustomer;
  extractedLocation: ExtractedLocation;
  customers: readonly CustomerRow[];
  /** All known locations for the candidate customers, in any order. */
  locations: readonly CustomerLocationRow[];
  /** Customer id already associated with this supplier's customer code. */
  supplierRefCustomerId?: string | null;
}

export function matchCustomer(input: MatchCustomerInput): CustomerMatchResult {
  const customerCandidates = rankCustomerCandidates(input.extractedCustomer, input.customers, {
    supplierRefCustomerId: input.supplierRefCustomerId,
  });

  const best = customerCandidates[0];

  // --- No safe company match at all -> new customer -----------------------
  if (!best || best.score < NAME_REVIEW_THRESHOLD) {
    return {
      kind: "new_customer",
      customer: null,
      location: null,
      customerCandidates,
      locationCandidates: [],
      differences: [],
      allowedResolutions: ["add_as_new_location"],
      requiresReview: true,
    };
  }

  const customerLocations = input.locations.filter((loc) => loc.customer_id === best.customer.id);
  const locationCandidates = rankLocationCandidates(input.extractedLocation, customerLocations);
  const bestLocation = locationCandidates[0];

  const identifierConfirmed =
    best.reasons.includes("vat_number") ||
    best.reasons.includes("fiscal_code") ||
    best.reasons.includes("supplier_customer_code");

  const companyConfirmed = identifierConfirmed || best.score >= NAME_MATCH_THRESHOLD;

  // --- Company only *resembles* something we hold -> human review ---------
  if (!companyConfirmed) {
    return {
      kind: "possible_match",
      customer: best.customer,
      location: bestLocation?.location ?? null,
      customerCandidates,
      locationCandidates,
      differences: bestLocation?.differences ?? [],
      allowedResolutions: [
        "use_for_this_order_only",
        "add_as_new_location",
        "update_existing_location",
      ],
      requiresReview: true,
    };
  }

  // --- Company certain, and the address matches a stored location ---------
  if (bestLocation && bestLocation.score >= LOCATION_MATCH_THRESHOLD && bestLocation.differences.length === 0) {
    return {
      kind: "match_confirmed",
      customer: best.customer,
      location: bestLocation.location,
      customerCandidates,
      locationCandidates,
      differences: [],
      allowedResolutions: ["use_existing"],
      requiresReview: false,
    };
  }

  // --- Company certain, address close but not identical -> review ---------
  // Same place, differing detail. Offering "update" here is what stops the
  // database drifting, but it stays a human decision.
  if (bestLocation && bestLocation.score >= LOCATION_MATCH_THRESHOLD) {
    return {
      kind: "possible_match",
      customer: best.customer,
      location: bestLocation.location,
      customerCandidates,
      locationCandidates,
      differences: bestLocation.differences,
      allowedResolutions: [
        "use_existing",
        "use_for_this_order_only",
        "update_existing_location",
        "add_as_new_location",
      ],
      requiresReview: true,
    };
  }

  // --- Company certain, address genuinely unknown -> new location ---------
  const hasExtractedAddress = Boolean(
    input.extractedLocation.addressLine1 || input.extractedLocation.city || input.extractedLocation.postalCode
  );

  if (!hasExtractedAddress) {
    // Nothing extracted to compare: fall back to the primary location and
    // let the Admin confirm rather than guessing an address.
    const primary = customerLocations.find((loc) => loc.is_primary) ?? customerLocations[0] ?? null;
    return {
      kind: primary ? "match_confirmed" : "new_location",
      customer: best.customer,
      location: primary,
      customerCandidates,
      locationCandidates,
      differences: [],
      allowedResolutions: primary ? ["use_existing"] : ["add_as_new_location"],
      requiresReview: !primary,
    };
  }

  return {
    kind: "new_location",
    customer: best.customer,
    location: null,
    customerCandidates,
    locationCandidates,
    differences: [],
    allowedResolutions: [
      "use_for_this_order_only",
      "add_as_new_location",
      "update_existing_location",
    ],
    requiresReview: true,
  };
}
