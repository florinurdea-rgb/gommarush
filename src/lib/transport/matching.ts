import {
  addressKey,
  cityKey,
  companyNameKey,
  postalKey,
  supplierCustomerCodeKey,
  vatDigits,
} from "@/lib/documents/pipeline/party-mapping";
import { isValidItalianTaxCode, isValidItalianVat } from "@/lib/transport/validate";

/**
 * Distributor and recipient matching.
 *
 * Two rules govern this module, and they pull in opposite directions on
 * purpose.
 *
 * First: a match strong enough to be certain is applied automatically, because
 * making an operator re-select EMMECI GOMME every time Zuin sends code 034932
 * is the kind of friction that gets a system abandoned. A saved
 * distributor-specific mapping, a valid VAT number or a valid codice fiscale
 * identify a legal entity; they are not resemblances.
 *
 * Second: a match that merely resembles is never applied. Names collide --
 * "GOMME VICENZA SRL" and "GOMME VICENZA SNC" are different companies, and
 * delivering four tyres to the wrong one costs a van run and a customer.
 * Anything short of an identifier requires an operator to say yes.
 *
 * And in every case the matched party is DISPLAYED. Automatic does not mean
 * invisible: the operator sees who the goods are going to before confirming,
 * even when the system is certain.
 *
 * Nothing here creates a customer. Creating a recipient is an explicit
 * operator action taken on the review screen, never a side effect of an
 * extraction being confident.
 */

export type MatchStrength =
  /** An identifier or a saved mapping. Applied automatically, still shown. */
  | "IDENTIFIER"
  /** Name and address agree exactly. Plausible, not proof. Needs confirmation. */
  | "EXACT_NAME_ADDRESS"
  /** A saved delivery branch or an approved alias. Needs confirmation. */
  | "SAVED_BRANCH"
  /** Resemblance only. Needs confirmation and is never preselected. */
  | "FUZZY"
  /** Nothing matched. */
  | "NONE";

/** Which rule produced the match, in the spec's precedence order. */
export type MatchRule =
  | "DISTRIBUTOR_CUSTOMER_CODE"
  | "VAT_NUMBER"
  | "TAX_CODE"
  | "NAME_AND_ADDRESS"
  | "SAVED_BRANCH"
  | "APPROVED_ALIAS"
  | "NAME_SIMILARITY";

export interface MatchedParty {
  id: string;
  locationId: string | null;
  name: string;
  vatNumber: string | null;
  /** Address summary, so the operator can eyeball it without another query. */
  addressSummary: string | null;
}

export interface PartyMatch {
  strength: MatchStrength;
  rule: MatchRule | null;
  party: MatchedParty | null;
  /** True when an operator must positively confirm before an order is created. */
  requiresConfirmation: boolean;
  /** Italian, for the review screen. */
  explanation: string;
  /** Other plausible parties, when the match was ambiguous. */
  alternatives: MatchedParty[];
}

// ---------------------------------------------------------------------------
// Candidate shapes (already fetched by the caller)
// ---------------------------------------------------------------------------

export interface DistributorCandidate {
  id: string;
  name: string;
  vatNumber: string | null;
  /** Approved alternative names an operator has confirmed in the past. */
  aliases?: readonly string[];
}

export interface RecipientCandidate {
  id: string;
  name: string;
  vatNumber: string | null;
  taxCode: string | null;
  locations: readonly {
    id: string;
    locationName: string | null;
    addressLine1: string | null;
    city: string | null;
    postalCode: string | null;
    province: string | null;
  }[];
}

/** A saved (distributor, customer code) -> customer mapping, from supplier_customer_refs. */
export interface SavedCustomerRef {
  distributorId: string;
  customerCode: string;
  customerId: string;
  customerLocationId: string | null;
  /** The name the distributor printed when the mapping was saved. */
  distributorCustomerName: string | null;
}

export interface IncomingParty {
  companyName: string | null;
  vatNumber: string | null;
  taxCode: string | null;
  customerCode: string | null;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  province: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summariseLocation(location: RecipientCandidate["locations"][number] | null): string | null {
  if (!location) return null;
  return [location.addressLine1, location.postalCode, location.city, location.province]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(", ");
}

function toParty(candidate: RecipientCandidate, locationId: string | null): MatchedParty {
  const location = candidate.locations.find((entry) => entry.id === locationId) ?? null;
  return {
    id: candidate.id,
    locationId,
    name: candidate.name,
    vatNumber: candidate.vatNumber,
    addressSummary: summariseLocation(location),
  };
}

function noMatch(explanation: string, alternatives: MatchedParty[] = []): PartyMatch {
  return {
    strength: "NONE",
    rule: null,
    party: null,
    requiresConfirmation: true,
    explanation,
    alternatives,
  };
}

/**
 * Picks the delivery branch that best fits the address on the document.
 *
 * Returns null rather than guessing when nothing lines up: a customer with
 * three depots and a document naming none of them is exactly the case where
 * an operator has to choose.
 */
function matchLocation(
  candidate: RecipientCandidate,
  incoming: IncomingParty
): { locationId: string | null; exact: boolean } {
  const incomingAddress = addressKey({
    addressLine1: incoming.addressLine,
    city: incoming.city,
    postalCode: incoming.postalCode,
  });

  if (incomingAddress) {
    const exact = candidate.locations.find(
      (location) =>
        addressKey({
          addressLine1: location.addressLine1,
          city: location.city,
          postalCode: location.postalCode,
        }) === incomingAddress
    );
    if (exact) return { locationId: exact.id, exact: true };
  }

  // Fall back to town plus postcode: the street may be abbreviated
  // differently ("STRADA" vs "STR.") while still being the same depot.
  const town = cityKey(incoming.city);
  const cap = postalKey(incoming.postalCode);
  if (town || cap) {
    const nearby = candidate.locations.filter(
      (location) =>
        (town && cityKey(location.city) === town) || (cap && postalKey(location.postalCode) === cap)
    );
    if (nearby.length === 1) return { locationId: nearby[0].id, exact: false };
  }

  if (candidate.locations.length === 1) return { locationId: candidate.locations[0].id, exact: false };

  return { locationId: null, exact: false };
}

// ---------------------------------------------------------------------------
// Distributor matching
// ---------------------------------------------------------------------------

/**
 * Matches the distributor that issued the document.
 *
 * Precedence: VAT number, then exact normalised name, then an approved alias,
 * then operator confirmation. Only the VAT number is an identifier, so only
 * it is applied automatically.
 */
export function matchDistributor(input: {
  incoming: { name: string | null; vatNumber: string | null };
  candidates: readonly DistributorCandidate[];
}): PartyMatch {
  const { incoming, candidates } = input;

  const incomingVat = vatDigits(incoming.vatNumber);
  if (incomingVat && isValidItalianVat(incoming.vatNumber)) {
    const byVat = candidates.filter((candidate) => vatDigits(candidate.vatNumber) === incomingVat);
    if (byVat.length === 1) {
      const found = byVat[0];
      return {
        strength: "IDENTIFIER",
        rule: "VAT_NUMBER",
        party: { id: found.id, locationId: null, name: found.name, vatNumber: found.vatNumber, addressSummary: null },
        requiresConfirmation: false,
        explanation: `Distributore riconosciuto dalla partita IVA ${incoming.vatNumber}.`,
        alternatives: [],
      };
    }
  }

  const incomingName = companyNameKey(incoming.name);
  if (incomingName) {
    const byName = candidates.filter((candidate) => companyNameKey(candidate.name) === incomingName);
    if (byName.length === 1) {
      const found = byName[0];
      return {
        strength: "EXACT_NAME_ADDRESS",
        rule: "NAME_AND_ADDRESS",
        party: { id: found.id, locationId: null, name: found.name, vatNumber: found.vatNumber, addressSummary: null },
        // A name alone is not an identity. Confirm.
        requiresConfirmation: true,
        explanation: `Nome corrispondente a "${found.name}": confermare che sia il distributore corretto.`,
        alternatives: [],
      };
    }

    const byAlias = candidates.filter((candidate) =>
      (candidate.aliases ?? []).some((alias) => companyNameKey(alias) === incomingName)
    );
    if (byAlias.length === 1) {
      const found = byAlias[0];
      return {
        strength: "SAVED_BRANCH",
        rule: "APPROVED_ALIAS",
        party: { id: found.id, locationId: null, name: found.name, vatNumber: found.vatNumber, addressSummary: null },
        requiresConfirmation: true,
        explanation: `Alias approvato di "${found.name}": confermare.`,
        alternatives: [],
      };
    }
  }

  return noMatch(
    incoming.name
      ? `Distributore "${incoming.name}" non presente in anagrafica: selezionarlo o crearlo.`
      : "Distributore non identificato: selezionarlo manualmente."
  );
}

// ---------------------------------------------------------------------------
// Recipient matching
// ---------------------------------------------------------------------------

/**
 * Matches the end customer the goods are being delivered to.
 *
 * Precedence, exactly as specified:
 *   1. distributor + distributor-specific customer code   (saved mapping)
 *   2. VAT number
 *   3. codice fiscale
 *   4. exact normalised company name AND delivery address
 *   5. existing saved branch
 *   6. approved alias
 *   7. operator selection
 *
 * The first three are identifiers and apply automatically. Everything below
 * requires confirmation, and nothing creates a customer.
 */
export function matchRecipient(input: {
  incoming: IncomingParty;
  distributorId: string | null;
  candidates: readonly RecipientCandidate[];
  savedRefs: readonly SavedCustomerRef[];
}): PartyMatch {
  const { incoming, distributorId, candidates, savedRefs } = input;

  // --- 1. Saved distributor-specific mapping ------------------------------
  // The Zuin "034932 -> EMMECI GOMME" case. An operator confirmed this once;
  // asking again on every document would be friction with no safety benefit.
  const incomingCode = supplierCustomerCodeKey(incoming.customerCode);
  if (distributorId && incomingCode) {
    const ref = savedRefs.find(
      (entry) =>
        entry.distributorId === distributorId && supplierCustomerCodeKey(entry.customerCode) === incomingCode
    );
    if (ref) {
      const candidate = candidates.find((entry) => entry.id === ref.customerId);
      if (candidate) {
        const location = ref.customerLocationId ?? matchLocation(candidate, incoming).locationId;
        return {
          strength: "IDENTIFIER",
          rule: "DISTRIBUTOR_CUSTOMER_CODE",
          party: toParty(candidate, location),
          requiresConfirmation: false,
          explanation: `Codice cliente ${incoming.customerCode} del distributore gia' associato a "${candidate.name}".`,
          alternatives: [],
        };
      }
    }
  }

  // --- 2. VAT number ------------------------------------------------------
  const incomingVat = vatDigits(incoming.vatNumber);
  if (incomingVat && isValidItalianVat(incoming.vatNumber)) {
    const byVat = candidates.filter((candidate) => vatDigits(candidate.vatNumber) === incomingVat);
    if (byVat.length === 1) {
      const candidate = byVat[0];
      return {
        strength: "IDENTIFIER",
        rule: "VAT_NUMBER",
        party: toParty(candidate, matchLocation(candidate, incoming).locationId),
        requiresConfirmation: false,
        explanation: `Destinatario riconosciuto dalla partita IVA ${incoming.vatNumber}.`,
        alternatives: [],
      };
    }
    if (byVat.length > 1) {
      // Two customers sharing a VAT number is a data problem, not a match.
      return noMatch(
        `Piu' clienti con la stessa partita IVA ${incoming.vatNumber}: selezionare quello corretto.`,
        byVat.map((candidate) => toParty(candidate, null))
      );
    }
  }

  // --- 3. Codice fiscale --------------------------------------------------
  const incomingTax = (incoming.taxCode ?? "").replace(/\s/g, "").toUpperCase();
  if (incomingTax && isValidItalianTaxCode(incomingTax)) {
    const byTax = candidates.filter(
      (candidate) => (candidate.taxCode ?? "").replace(/\s/g, "").toUpperCase() === incomingTax
    );
    if (byTax.length === 1) {
      const candidate = byTax[0];
      return {
        strength: "IDENTIFIER",
        rule: "TAX_CODE",
        party: toParty(candidate, matchLocation(candidate, incoming).locationId),
        requiresConfirmation: false,
        explanation: `Destinatario riconosciuto dal codice fiscale ${incoming.taxCode}.`,
        alternatives: [],
      };
    }
  }

  // --- 4. Exact name AND address -----------------------------------------
  const incomingName = companyNameKey(incoming.companyName);
  if (incomingName) {
    const byName = candidates.filter((candidate) => companyNameKey(candidate.name) === incomingName);

    if (byName.length === 1) {
      const candidate = byName[0];
      const location = matchLocation(candidate, incoming);

      if (location.exact) {
        return {
          strength: "EXACT_NAME_ADDRESS",
          rule: "NAME_AND_ADDRESS",
          party: toParty(candidate, location.locationId),
          // Name plus address is a strong resemblance, still not an
          // identifier. "GOMME VICENZA SRL" and "GOMME VICENZA SNC" are
          // different companies.
          requiresConfirmation: true,
          explanation: `Nome e indirizzo corrispondono a "${candidate.name}": confermare.`,
          alternatives: [],
        };
      }

      return {
        strength: "SAVED_BRANCH",
        rule: "SAVED_BRANCH",
        party: toParty(candidate, location.locationId),
        requiresConfirmation: true,
        explanation: location.locationId
          ? `Cliente "${candidate.name}" trovato, ma l'indirizzo non coincide esattamente: verificare la filiale.`
          : `Cliente "${candidate.name}" trovato, ma nessuna filiale corrisponde all'indirizzo: selezionarla.`,
        alternatives: [],
      };
    }

    if (byName.length > 1) {
      return noMatch(
        `Piu' clienti con nome "${incoming.companyName}": selezionare quello corretto.`,
        byName.map((candidate) => toParty(candidate, matchLocation(candidate, incoming).locationId))
      );
    }
  }

  // --- 7. Operator selection ---------------------------------------------
  return noMatch(
    incoming.companyName
      ? `Destinatario "${incoming.companyName}" non trovato: selezionare un cliente esistente o crearne uno nuovo.`
      : "Destinatario non identificato: selezionarlo manualmente."
  );
}

/**
 * Whether a match is good enough to create an order without further input.
 *
 * Note it is not the same question as "did we find someone" -- a confirmed
 * match with no delivery branch selected still cannot produce a job, because
 * there would be nowhere to drive to.
 */
export function matchIsActionable(match: PartyMatch): boolean {
  return match.party !== null && !match.requiresConfirmation;
}

/**
 * The mapping to save after an operator confirms a recipient.
 *
 * Returns null when there is nothing worth remembering: without a
 * distributor-specific code there is no key to look up next time.
 */
export function mappingToSave(input: {
  distributorId: string | null;
  customerCode: string | null;
  customerId: string | null;
  customerLocationId: string | null;
  distributorCustomerName: string | null;
}): SavedCustomerRef | null {
  const code = (input.customerCode ?? "").trim();
  if (!input.distributorId || !input.customerId || !code) return null;

  return {
    distributorId: input.distributorId,
    customerCode: code,
    customerId: input.customerId,
    customerLocationId: input.customerLocationId,
    distributorCustomerName: input.distributorCustomerName,
  };
}
