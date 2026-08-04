export type Season = "estivo" | "invernale" | "quattro-stagioni";

export type Quantity = 1 | 2 | 4;

export interface Tyre {
  id: string;
  width: string;
  profile: string;
  rim: string;
  season: Season | null;
  quantity: Quantity;
  notes: string;
}

export type DeliveryPreference =
  | "qualsiasi"
  | "24h"
  | "48h"
  | "7giorni";

export const SEASON_LABELS: Record<Season, string> = {
  estivo: "Estivo",
  invernale: "Invernale",
  "quattro-stagioni": "Quattro stagioni",
};

export const DELIVERY_LABELS: Record<DeliveryPreference, string> = {
  qualsiasi: "Qualsiasi data disponibile",
  "24h": "Entro 24 ore",
  "48h": "Entro 48 ore",
  "7giorni": "Entro 7 giorni",
};
