import type { DeliveryPreference, RequestedTyre, TyreSeason } from "./offer-request";

export type { TyreSeason, DeliveryPreference };

// Local, in-progress representation of a tyre line while the customer is
// building the request in the modal/list. Numeric fields stay as strings
// here because that's what an <input> gives you; they're parsed to
// numbers only when building the API payload (see toRequestedTyre).
export interface Tyre {
  id: string;
  width: string;
  profile: string;
  rim: string;
  season: TyreSeason | null;
  quantity: number;
  extraLoad: boolean;
  commercial: boolean;
  notes: string;
}

export const SEASON_LABELS: Record<TyreSeason, string> = {
  summer: "Estivo",
  winter: "Invernale",
  all_season: "Quattro stagioni",
};

export const DELIVERY_LABELS: Record<DeliveryPreference, string> = {
  any: "Qualsiasi data disponibile",
  "24_hours": "Entro 24 ore",
  "48_hours": "Entro 48 ore",
  "7_days": "Entro 7 giorni",
};

/**
 * The API's RequestedTyre shape has no room for the XL / Commercial
 * badges (they're a UI-only concept), so fold them into the free-text
 * notes rather than silently dropping them from the submitted request.
 */
export function toRequestedTyre(tyre: Tyre): RequestedTyre {
  const markings = [tyre.extraLoad ? "XL" : null, tyre.commercial ? "C" : null].filter(
    (m): m is string => m !== null
  );
  const notes = [markings.length ? `Marcatura: ${markings.join(" ")}` : null, tyre.notes.trim() || null]
    .filter((part): part is string => Boolean(part))
    .join(" — ");

  if (tyre.season === null) {
    throw new Error("Cannot convert a tyre without a season to a request payload");
  }

  return {
    id: tyre.id,
    width: parseInt(tyre.width, 10),
    profile: parseInt(tyre.profile, 10),
    rim: parseInt(tyre.rim, 10),
    season: tyre.season,
    quantity: tyre.quantity,
    notes: notes || undefined,
  };
}
