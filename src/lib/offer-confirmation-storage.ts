import type { OfferRequestSummary } from "./types/offer-request";

export const OFFER_CONFIRMATION_STORAGE_KEY = "gommarush:offer-confirmation";

export type StoredOfferConfirmation = {
  requestNumber: string;
  emailSent: boolean;
  summary: OfferRequestSummary;
};

/**
 * Reads and immediately clears the confirmation summary from
 * sessionStorage. One-shot by design: refreshing /request-confirmation
 * after reading it should show the "no recent request" fallback, not
 * stale data from a previous submission.
 */
export function readAndClearOfferConfirmation(): StoredOfferConfirmation | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(OFFER_CONFIRMATION_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(OFFER_CONFIRMATION_STORAGE_KEY);
    return JSON.parse(raw) as StoredOfferConfirmation;
  } catch {
    return null;
  }
}
