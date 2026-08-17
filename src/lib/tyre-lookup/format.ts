import type { TyreLookupResult, TyreLookupSeason } from "@/lib/tyre-lookup/types";

/**
 * The one-line tyre size (e.g. "225/40 R18 92Y XL"), or null when the
 * dimensions aren't all known — never render a half-built size string.
 */
export function formatTyreSizeLine(
  result: Pick<TyreLookupResult, "width" | "aspectRatio" | "rimDiameter" | "loadIndex" | "speedRating" | "extraLoad">
): string | null {
  const { width, aspectRatio, rimDiameter, loadIndex, speedRating, extraLoad } = result;
  if (width === null || aspectRatio === null || rimDiameter === null) return null;

  let line = `${width}/${aspectRatio} R${rimDiameter}`;
  const indexSpeed = `${loadIndex ?? ""}${speedRating ?? ""}`.trim();
  if (indexSpeed) line += ` ${indexSpeed}`;
  if (extraLoad) line += " XL";
  return line;
}

const SEASON_LABEL: Record<TyreLookupSeason, string> = {
  summer: "Vară",
  winter: "Iarnă",
  "all-season": "All-season",
};

export function seasonLabel(season: TyreLookupSeason | null): string | null {
  return season ? SEASON_LABEL[season] : null;
}

export function yesNo(value: boolean | null): string | null {
  return value === null ? null : value ? "Da" : "Nu";
}
