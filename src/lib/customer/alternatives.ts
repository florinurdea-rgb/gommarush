// The "see alternatives" link.
//
// A line the customer cannot buy is only half an answer; the other half is
// where to find a tyre they can. That means the catalogue, already filtered to
// the size they were trying to buy — which is a link, not a search they have
// to repeat from memory.
//
// Pure: no React, no router, no I/O, so the rule about WHICH filters carry
// over is a property that can be asserted rather than a detail buried in a
// click handler.

export interface AlternativesTyre {
  readonly widthMm?: number | null;
  readonly aspectRatio?: number | null;
  readonly rimInch?: number | null;
  readonly season?: string | null;
}

export const CATALOGUE_PATH = "/account/catalogue";

function usable(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The catalogue URL that shows what else exists in this tyre's size.
 *
 * SIZE ONLY, deliberately — width, aspect ratio and rim, plus season where the
 * catalogue knows it. Brand and model are exactly what the customer now needs
 * to change, so carrying them over would reproduce the empty result they are
 * trying to escape. Season carries because a summer tyre is not an alternative
 * to a winter one; it is a different purchase.
 *
 * Returns null when the size is incomplete. The catalogue refuses to search on
 * a partial size anyway, so a link that could only land on "choose a size" is
 * worse than no link: it looks like it failed.
 */
export function alternativesHref(tyre: AlternativesTyre | null | undefined): string | null {
  if (!tyre) return null;
  if (!usable(tyre.widthMm) || !usable(tyre.aspectRatio) || !usable(tyre.rimInch)) return null;

  const params = new URLSearchParams({
    width: String(tyre.widthMm),
    aspect: String(tyre.aspectRatio),
    rim: String(tyre.rimInch),
  });
  if (tyre.season) params.set("season", tyre.season);

  return `${CATALOGUE_PATH}?${params.toString()}`;
}
