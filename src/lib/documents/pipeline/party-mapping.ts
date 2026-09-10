// Remembered supplier / delivery-point decisions.
//
// The operator requirement: once I pick the supplier and the delivery point
// for a document from a known issuer, remember it and preselect next time.
//
// The safety requirement that constrains it: a remembered choice must never
// survive contradicting evidence. If the VAT number, postcode, city or street
// number on the new document differs materially from the mapping, the mapping
// is invalidated and a human decides again. History is a shortcut, not an
// authority.
//
// Two rules are load-bearing:
//   * Fuzzy name similarity NEVER auto-confirms. Only an exact identity does.
//   * Nothing is learned from an abandoned analysis, or from "use for this
//     order only". Only a confirmed import or an explicit admin save writes
//     a mapping.
//
// Pure and dependency-free.

import type { OrderType } from "@/lib/documents/pipeline/order-type";

export type MappingRole =
  | "SUPPLIER"
  | "CONTRACTING_COMPANY"
  | "PICKUP_POINT"
  | "DELIVERY_CUSTOMER"
  | "DELIVERY_POINT"
  | "BILLING_CUSTOMER"
  | "ORDER_TYPE";

export type CustomerResolution =
  | "USE_EXISTING"
  | "USE_FOR_THIS_ORDER_ONLY"
  | "ADD_NEW_LOCATION"
  | "UPDATE_EXISTING_LOCATION"
  | "CREATE_NEW_CUSTOMER";

/**
 * Resolutions that are allowed to create or reinforce a mapping.
 *
 * USE_FOR_THIS_ORDER_ONLY is deliberately absent: the operator said "this
 * once", and turning that into a permanent rule is precisely the silent
 * behaviour this model exists to avoid.
 */
const LEARNABLE_RESOLUTIONS = new Set<CustomerResolution>([
  "USE_EXISTING",
  "ADD_NEW_LOCATION",
  "UPDATE_EXISTING_LOCATION",
  "CREATE_NEW_CUSTOMER",
]);

export function resolutionCreatesMapping(resolution: CustomerResolution): boolean {
  return LEARNABLE_RESOLUTIONS.has(resolution);
}

// ---------------------------------------------------------------------------
// Normalisation keys
// ---------------------------------------------------------------------------

/** Uppercased, punctuation-stripped, whitespace-collapsed. */
function baseKey(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const COMPANY_SUFFIXES = new Set([
  "SRL", "S R L", "SPA", "S P A", "SNC", "S N C", "SAS", "S A S",
  "SRLS", "S R L S", "BV", "B V", "NV", "N V", "GMBH", "AG", "LTD",
  "SA", "S A", "SL", "S L", "SARL", "PLC", "INC", "LLC", "OOD", "SC", "SRO",
]);

/** Company identity key, with legal-form noise removed. */
export function companyNameKey(name: string | null | undefined): string {
  const base = baseKey(name);
  if (!base) return "";
  const words = base.split(" ").filter(Boolean);

  let stripped = true;
  while (stripped && words.length > 1) {
    stripped = false;
    for (let take = Math.min(4, words.length - 1); take >= 1; take -= 1) {
      if (COMPANY_SUFFIXES.has(words.slice(-take).join(" "))) {
        words.splice(-take, take);
        stripped = true;
        break;
      }
    }
  }
  return words.join(" ");
}

/**
 * VAT / fiscal identifier key.
 *
 * The country prefix is kept. "IT12345678901" and "12345678901" are the same
 * registration, but stripping the prefix would let an Italian and a Romanian
 * number with the same digits collide, so both forms are produced and the
 * caller compares either.
 */
export function vatKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** The digits of a VAT number, for prefix-insensitive comparison. */
export function vatDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function supplierCustomerCodeKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function postalKey(value: string | null | undefined): string {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function cityKey(value: string | null | undefined): string {
  return baseKey(value);
}

/**
 * The civic number — the part of an address most likely to differ, and so the
 * part most worth comparing exactly.
 *
 * Italian civic numbers carry suffixes in several spellings: "12", "12A",
 * "12/A", "12 bis". All are normalised to a single form ("12/A", "12/BIS"),
 * so the same doorway written two ways compares equal while two genuinely
 * different doorways do not. An earlier version matched only trailing
 * `\d+[A-Za-z]?`, which silently reduced "Via Roma 12/A" to "12" — making it
 * indistinguishable from "Via Roma 12".
 */
export function streetNumber(value: string | null | undefined): string {
  if (!value) return "";
  const cleaned = value.trim();
  const pattern = /(\d+)\s*(?:\/\s*([A-Za-z]{1,4})|([A-Za-z]{1,4})(?![A-Za-z])|\s+(bis|ter|quater))?\s*$/i;
  const match = pattern.exec(cleaned) ?? /(\d+)\s*(?:\/\s*([A-Za-z]{1,4})|([A-Za-z]{1,4})(?![A-Za-z]))?/i.exec(cleaned);
  if (!match) return "";
  const suffix = (match[2] ?? match[3] ?? match[4] ?? "").toUpperCase();
  return suffix ? `${match[1]}/${suffix}` : match[1];
}

/**
 * Structured address key. Street words plus number plus postcode — never a
 * whole free-text line, because a formatting change would break the match and
 * a number change would not.
 */
export function addressKey(input: {
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string {
  const street = baseKey(input.addressLine1);
  return [street, streetNumber(input.addressLine1), postalKey(input.postalCode), cityKey(input.city)]
    .filter(Boolean)
    .join("|");
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface StoredMapping {
  id: string;
  mappingRole: MappingRole;
  documentIssuerSupplierId: string | null;
  rawVatKey: string | null;
  rawSupplierCustomerCodeKey: string | null;
  rawCompanyNameKey: string | null;
  rawAddressKey: string | null;
  rawPostalCode: string | null;
  rawCityKey: string | null;
  resolvedCompanyId: string | null;
  resolvedLocationId: string | null;
  resolvedOrderType: OrderType | null;
  approved: boolean;
  disabled: boolean;
  useCount: number;
}

export interface IncomingParty {
  companyName?: string | null;
  vatNumber?: string | null;
  fiscalCode?: string | null;
  supplierCustomerCode?: string | null;
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

/** Strongest first. Only the top three may preselect without a human. */
export type MappingMatchStrength =
  | "VAT_EXACT"
  | "SUPPLIER_CODE_EXACT"
  | "ADDRESS_EXACT"
  | "NAME_EXACT"
  | "NAME_AND_LOCATION"
  | "NONE";

const AUTO_PRESELECT_STRENGTHS = new Set<MappingMatchStrength>([
  "VAT_EXACT",
  "SUPPLIER_CODE_EXACT",
  "ADDRESS_EXACT",
]);

export interface MappingMatch {
  mapping: StoredMapping;
  strength: MappingMatchStrength;
  /** Whether this may preselect automatically. */
  autoPreselect: boolean;
  /** Italian, operator-facing. Shown verbatim under "Preselezionato perché:". */
  reasons: string[];
  /** Set when the mapping matched but fresh evidence contradicts it. */
  invalidation: { field: string; stored: string; incoming: string } | null;
}

/**
 * Finds the best stored mapping for an incoming party.
 *
 * Precedence is the specification's: validated VAT, then supplier-specific
 * customer code, then an exact approved address, then exact normalized name,
 * then name plus location. Fuzzy similarity is absent by design — it is the
 * one signal that must never auto-confirm a company.
 */
export function matchStoredMapping(
  incoming: IncomingParty,
  role: MappingRole,
  issuerSupplierId: string | null,
  mappings: readonly StoredMapping[]
): MappingMatch | null {
  const candidates = mappings.filter(
    (mapping) =>
      mapping.mappingRole === role &&
      mapping.approved &&
      !mapping.disabled &&
      // A supplier-specific customer code only means anything inside that
      // supplier's own numbering, so issuer scope is enforced, not optional.
      (mapping.documentIssuerSupplierId === null ||
        mapping.documentIssuerSupplierId === issuerSupplierId)
  );
  if (candidates.length === 0) return null;

  const incomingVat = vatKey(incoming.vatNumber ?? incoming.fiscalCode);
  const incomingVatDigits = vatDigits(incoming.vatNumber ?? incoming.fiscalCode);
  const incomingCode = supplierCustomerCodeKey(incoming.supplierCustomerCode);
  const incomingName = companyNameKey(incoming.companyName);
  const incomingAddress = addressKey(incoming);
  const incomingPostal = postalKey(incoming.postalCode);
  const incomingCity = cityKey(incoming.city);
  const incomingStreetNumber = streetNumber(incoming.addressLine1);

  const scored: MappingMatch[] = [];

  for (const mapping of candidates) {
    let strength: MappingMatchStrength = "NONE";
    const reasons: string[] = [];

    if (incomingVat && mapping.rawVatKey && (mapping.rawVatKey === incomingVat || vatDigits(mapping.rawVatKey) === incomingVatDigits)) {
      strength = "VAT_EXACT";
      reasons.push("Partita IVA corrispondente");
    } else if (incomingCode && mapping.rawSupplierCustomerCodeKey === incomingCode) {
      strength = "SUPPLIER_CODE_EXACT";
      reasons.push("Codice cliente del fornitore corrispondente");
    } else if (incomingAddress && mapping.rawAddressKey === incomingAddress) {
      strength = "ADDRESS_EXACT";
      reasons.push("Indirizzo corrispondente");
    } else if (incomingName && mapping.rawCompanyNameKey === incomingName) {
      const sameCity = incomingCity && mapping.rawCityKey === incomingCity;
      const samePostal = incomingPostal && mapping.rawPostalCode === incomingPostal;
      strength = sameCity || samePostal ? "NAME_AND_LOCATION" : "NAME_EXACT";
      reasons.push("Ragione sociale corrispondente");
      if (sameCity) reasons.push("Città corrispondente");
      if (samePostal) reasons.push("CAP corrispondente");
    } else {
      continue;
    }

    if (mapping.useCount > 1) {
      reasons.push(`Selezione confermata in ${mapping.useCount} documenti precedenti`);
    } else if (mapping.useCount === 1) {
      reasons.push("Selezione confermata in un documento precedente");
    }

    // Contradiction check. A mapping matched on one identity can still be
    // invalidated by another field having materially changed — a different
    // VAT number, postcode, city or street number means this is very likely
    // a different party or a moved one, and preselecting would be wrong.
    const invalidation = findInvalidation(mapping, {
      vat: incomingVat,
      vatDigits: incomingVatDigits,
      postal: incomingPostal,
      city: incomingCity,
      streetNumber: incomingStreetNumber,
    });

    scored.push({
      mapping,
      strength,
      autoPreselect: invalidation === null && AUTO_PRESELECT_STRENGTHS.has(strength),
      reasons,
      invalidation,
    });
  }

  if (scored.length === 0) return null;

  const order: MappingMatchStrength[] = [
    "VAT_EXACT",
    "SUPPLIER_CODE_EXACT",
    "ADDRESS_EXACT",
    "NAME_AND_LOCATION",
    "NAME_EXACT",
    "NONE",
  ];
  scored.sort((a, b) => {
    const byStrength = order.indexOf(a.strength) - order.indexOf(b.strength);
    return byStrength !== 0 ? byStrength : b.mapping.useCount - a.mapping.useCount;
  });

  return scored[0];
}

function findInvalidation(
  mapping: StoredMapping,
  incoming: { vat: string; vatDigits: string; postal: string; city: string; streetNumber: string }
): MappingMatch["invalidation"] {
  // Only compare fields BOTH sides actually have. A mapping that never stored
  // a postcode says nothing about the incoming one, and treating absence as a
  // difference would invalidate every mapping on the first sparse document.
  if (
    mapping.rawVatKey &&
    incoming.vat &&
    mapping.rawVatKey !== incoming.vat &&
    vatDigits(mapping.rawVatKey) !== incoming.vatDigits
  ) {
    return { field: "partita IVA", stored: mapping.rawVatKey, incoming: incoming.vat };
  }
  if (mapping.rawPostalCode && incoming.postal && mapping.rawPostalCode !== incoming.postal) {
    return { field: "CAP", stored: mapping.rawPostalCode, incoming: incoming.postal };
  }
  if (mapping.rawCityKey && incoming.city && mapping.rawCityKey !== incoming.city) {
    return { field: "città", stored: mapping.rawCityKey, incoming: incoming.city };
  }
  if (mapping.rawAddressKey && incoming.streetNumber) {
    const storedNumber = mapping.rawAddressKey.split("|")[1] ?? "";
    if (storedNumber && storedNumber !== incoming.streetNumber) {
      return { field: "numero civico", stored: storedNumber, incoming: incoming.streetNumber };
    }
  }
  return null;
}

/** The keys to persist when a confirmed import teaches a new mapping. */
export function buildMappingKeys(incoming: IncomingParty) {
  return {
    raw_vat_key: vatKey(incoming.vatNumber ?? incoming.fiscalCode) || null,
    raw_supplier_customer_code_key: supplierCustomerCodeKey(incoming.supplierCustomerCode) || null,
    raw_company_name_key: companyNameKey(incoming.companyName) || null,
    raw_address_key: addressKey(incoming) || null,
    raw_postal_code: postalKey(incoming.postalCode) || null,
    raw_city_key: cityKey(incoming.city) || null,
  };
}
