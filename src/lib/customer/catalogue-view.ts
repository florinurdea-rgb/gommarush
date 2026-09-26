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
 *  1. `error` outranks everything, INCLUDING a missing size. This is the
 *     ordering a real failure corrected: the size selectors are filled from
 *     the same request that fetches results, so when that request fails there
 *     are no widths to choose. Ranking `awaiting_dimensions` first told the
 *     customer to "choose a size" next to three empty dropdowns, with the
 *     actual failure shown nowhere. A request that failed must say so.
 *  2. `awaiting_dimensions` outranks `loading`, because with no size there is
 *     nothing to load and a results spinner would be a lie — the selectors
 *     populate on their own as the facets arrive.
 *  3. `loading` outranks the rest. A request in flight must never show the
 *     previous selection's results or an empty panel. It cannot collide with
 *     `error`, because the error is cleared when a fetch starts.
 *  4. `results` is last: it is what is left once nothing is pending or wrong,
 *     so an empty list here genuinely means "no tyres match".
 */
export function catalogueViewState(input: CatalogueViewInput): CatalogueViewState {
  if (input.error) return "error";
  if (!hasCompleteDimensions(input)) return "awaiting_dimensions";
  if (input.loading) return "loading";
  if (input.refused) return "refused";
  return "results";
}

/**
 * Whether the server should run the CATALOGUE READ for this selection.
 *
 * NOT whether to make a request. The request is always made — it is what
 * fetches the facets that fill the size selectors — and this decides only
 * whether the expensive product query runs behind it. The route applies the
 * same rule independently, which is the half that actually protects the query.
 */
export function shouldQueryCatalogue(input: {
  widthMm: string | number | null;
  aspectRatio: string | number | null;
  rimInch: string | number | null;
}): boolean {
  return hasCompleteDimensions(input);
}

/**
 * Whether a freshly fetched list carries the same values as the one on screen.
 *
 * REGRESSION: "the dropdowns reset as I browse through them."
 *
 * Handing React a new array of IDENTICAL values still re-creates every
 * <option>, and a browser rebuilding the options of an OPEN dropdown closes
 * it — so a response that changed nothing at all could still shut the list the
 * customer was scrolling.
 *
 * The size lists no longer come from a response at all (see
 * src/lib/server/catalogue-dimensions.ts), so this now guards the one list
 * that does: the brands available in the chosen size. Keeping the previous
 * array when nothing changed makes that disturbance impossible.
 *
 * Order-sensitive on purpose: the server returns these sorted, so a different
 * order IS a different answer and the customer should see it.
 */
export function sameValues(
  current: readonly (number | string)[],
  incoming: readonly (number | string)[] | null | undefined
): boolean {
  return (
    Array.isArray(incoming) &&
    current.length === incoming.length &&
    current.every((value, i) => value === incoming[i])
  );
}
