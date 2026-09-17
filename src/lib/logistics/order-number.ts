// Order number formatting.
//
// `orders.order_number` is a bigint GENERATED ALWAYS AS IDENTITY in the live
// schema, so the database owns it and the application never writes it. "GR-001"
// is purely a display form, produced here and nowhere else.
//
// Keeping the stored value numeric is what makes the sequence gap-free and
// sortable; padding to three digits is cosmetic and degrades gracefully once
// the business passes order 999 (it simply gets wider: GR-1000).

const PREFIX = "GR";
const MIN_DIGITS = 3;

export function formatOrderNumber(orderNumber: number | string | null | undefined): string {
  if (orderNumber === null || orderNumber === undefined || orderNumber === "") return "—";
  const numeric = Number(orderNumber);
  if (!Number.isFinite(numeric)) return String(orderNumber);
  return `${PREFIX}-${String(Math.trunc(numeric)).padStart(MIN_DIGITS, "0")}`;
}

/**
 * Parses a displayed order number back to its numeric form, for search boxes
 * where an operator may type "GR-001", "gr 1", or just "1".
 */
export function parseOrderNumber(input: string): number | null {
  const digits = input.trim().replace(/^gr[\s-]*/i, "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  const numeric = Number(digits);
  return Number.isFinite(numeric) ? numeric : null;
}
