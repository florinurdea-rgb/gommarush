import type {
  DeliverySpeed,
  PreferenceType,
  ProductType,
  QuoteItemInput,
} from "@/lib/types/quote-request";
import type { SiteCopy } from "@/lib/i18n/site-content";

/**
 * The quote builder's local draft model.
 *
 * Dimensions are kept as STRINGS while editing so a half-typed "2" doesn't
 * get coerced to a number and fight the user's next keystroke. They're
 * parsed to real numbers only at validation/submit time, which is also where
 * the same cross-field rules the server enforces are applied.
 */

export interface DraftItem {
  /** Local-only key for React and for edit-in-place; never sent. */
  key: string;
  productType: ProductType;
  width: string;
  profile: string;
  rim: string;
  loadSpeedIndex: string;
  description: string;
  quantity: number;
  preferenceType: PreferenceType;
  preferredBrand: string;
  /** null until the customer picks — the choice is required, never preselected. */
  deliverySpeed: DeliverySpeed | null;
}

export type DraftErrors = Partial<Record<keyof DraftItem, string>>;

let counter = 0;
export function newDraftItem(productType: ProductType = "tyre"): DraftItem {
  counter += 1;
  return {
    key: `item-${Date.now()}-${counter}`,
    productType,
    width: "",
    profile: "",
    rim: "",
    loadSpeedIndex: "",
    description: "",
    // Tyres are almost always bought in pairs; anything else defaults to one.
    quantity: productType === "tyre" ? 2 : 1,
    preferenceType: "best_price",
    preferredBrand: "",
    deliverySpeed: null,
  };
}

function intInRange(raw: string, min: number, max: number): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

/**
 * Mirrors the Zod rules in src/lib/validation/quote-request.ts and the
 * CHECK constraints in the migration. Three layers, one set of rules.
 */
export function validateDraft(item: DraftItem, copy: SiteCopy): DraftErrors {
  const errors: DraftErrors = {};

  if (item.productType === "tyre") {
    if (intInRange(item.width, 100, 500) === null) errors.width = copy.errWidth;
    if (intInRange(item.profile, 20, 100) === null) errors.profile = copy.errProfile;
    if (intInRange(item.rim, 10, 30) === null) errors.rim = copy.errRim;
  } else if (!item.description.trim()) {
    errors.description = copy.errDescription;
  }

  if (!Number.isFinite(item.quantity) || item.quantity < 1) {
    errors.quantity = copy.errQuantity;
  }

  if (item.preferenceType === "specific_brand" && !item.preferredBrand.trim()) {
    errors.preferredBrand = copy.errBrand;
  }

  if (item.deliverySpeed === null) {
    errors.deliverySpeed = copy.errDelivery;
  }

  return errors;
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Draft → API payload. Drops everything that doesn't belong to the chosen
 * product type, so a brand typed under "Marca specifica" is never submitted
 * after the customer switches back to "Miglior prezzo".
 */
export function draftToPayload(item: DraftItem): QuoteItemInput {
  const isTyre = item.productType === "tyre";
  const usesBrand = item.preferenceType === "specific_brand";
  const trimmedBrand = item.preferredBrand.trim();
  const trimmedIndex = item.loadSpeedIndex.trim();

  return {
    productType: item.productType,
    description: isTyre ? null : item.description.trim(),
    width: isTyre ? Number(item.width) : null,
    profile: isTyre ? Number(item.profile) : null,
    rim: isTyre ? Number(item.rim) : null,
    loadSpeedIndex: isTyre && trimmedIndex ? trimmedIndex : null,
    quantity: Math.max(1, Math.trunc(item.quantity)),
    preferenceType: item.preferenceType,
    preferredBrand: usesBrand && trimmedBrand ? trimmedBrand : null,
    // validateDraft guarantees this is set before we ever get here.
    deliverySpeed: item.deliverySpeed as DeliverySpeed,
  };
}

/** "205/55 R16 91V" or the free-text description, for the collapsed summary. */
export function summariseDraft(item: DraftItem): string {
  if (item.productType === "other") return item.description.trim() || "—";
  const size = `${item.width}/${item.profile} R${item.rim}`;
  const index = item.loadSpeedIndex.trim();
  return index ? `${size} ${index}` : size;
}
