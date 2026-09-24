// The commerce quantity rules.
//
// Pure and in their own module for the same reason catalogue-view.ts and
// alternatives.ts are: these are the parts that go wrong, and a rule written
// inside a component is a rule nothing can assert. It is also what lets the
// test suite reach them without rendering anything.

export const QUANTITY_MIN = 1;

/**
 * The ceiling.
 *
 * Deliberately the SAME number validateBasketLines enforces on the server. A
 * box that can compose a line the server will reject is a box that produces an
 * unexplained failure two screens later.
 */
export const QUANTITY_MAX = 100;

export function clampQuantity(value: number): number {
  if (Number.isNaN(value)) return QUANTITY_MIN;
  return Math.min(QUANTITY_MAX, Math.max(QUANTITY_MIN, Math.trunc(value)));
}

/**
 * Parses what is in the box.
 *
 * Empty or junk is NOT zero — it is a box being typed into. Returning 0 here
 * would make clearing the field to type "12" read as a removal between
 * keystrokes, which is exactly the behaviour that makes a controlled numeric
 * input feel broken.
 */
export function parseQuantity(raw: string): number | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits === "") return null;
  return clampQuantity(Number(digits));
}
