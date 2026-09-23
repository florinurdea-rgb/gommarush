// What the customer catalogue is showing, as a decision rather than a chain of
// ternaries inside the component.
//
// Extracted because the ordering of these cases is the part that goes wrong.
// An "empty results" panel rendered while a request is in flight, or a stale
// list left under a filter the customer has already changed, both read as
// answers when they are not. Written here, the precedence is a property that
// can be asserted; written inline, it is four nested conditionals nobody tests.
//
// Pure: no React, no database, no I/O.

export type CatalogueViewState =
  /** No size chosen yet. Nothing has been requested and nothing should be. */
  | "awaiting_dimensions"
  /** A request is in flight, or about to be. Show placeholders. */
  | "loading"
  /** The request failed. */
  | "error"
  /** The selection is too large to order correctly; ask for a narrower one. */
  | "refused"
  /** Real, current results — including a genuine zero. */
  | "results";

export interface CatalogueViewInput {
  readonly widthMm: string | number | null;
  readonly aspectRatio: string | number | null;
  readonly rimInch: string | number | null;
  readonly loading: boolean;
  readonly error: boolean;
  readonly refused: boolean;
}

function chosen(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  return value.trim() !== "";
}

/**
 * True when the customer has given a complete tyre size.
 *
 * The gate for whether a catalogue request may be made at all. The API applies
 * the same rule independently — this is the half that keeps the interface
 * pleasant, not the half that protects the query.
 */
export function hasCompleteDimensions(input: {
  widthMm: string | number | null;
  aspectRatio: string | number | null;
  rimInch: string | number | null;
}): boolean {
  return chosen(input.widthMm) && chosen(input.aspectRatio) && chosen(input.rimInch);
}

/**
 * The single state the view should render.
 *
 * PRECEDENCE, and why it is this way round:
 *
 *  1. `loading` outranks everything except a missing size. A request in flight
 *     must never show the previous selection's results, an error from a
 *     superseded request, or an empty panel.
 *  2. `awaiting_dimensions` outranks `loading`, because with no size there is
 *     nothing to load and a spinner would be a lie.
 *  3. `error` outranks `refused`, because a failed request tells us nothing
 *     about the size of the selection.
 *  4. `results` is last: it is what is left once nothing is pending or wrong,
 *     so an empty list here genuinely means "no tyres match".
 */
export function catalogueViewState(input: CatalogueViewInput): CatalogueViewState {
  if (!hasCompleteDimensions(input)) return "awaiting_dimensions";
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.refused) return "refused";
  return "results";
}

/** Whether a fetch should be issued for this selection. */
export function shouldQueryCatalogue(input: {
  widthMm: string | number | null;
  aspectRatio: string | number | null;
  rimInch: string | number | null;
}): boolean {
  return hasCompleteDimensions(input);
}
