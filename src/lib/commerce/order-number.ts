// The human-readable GommaRush order number.
//
// ONE MECHANISM. The number itself comes from `public.sales_order_number_seq`
// and lives in `sales_orders.order_number` — a bigint the database allocates
// once, under a unique constraint. Nothing here generates, derives or reserves
// a number; this file only FORMATS the one the database already issued.
//
// That distinction matters. A second numbering scheme — a prefix computed in
// the application, a per-year counter, a "display id" stored alongside — would
// eventually disagree with the sequence, and the two would be impossible to
// reconcile on an invoice a year later. So the sequence is the number, and this
// is how it is written down.
//
// Pure: no database, no I/O.

/** Where the sequence starts. Below this, padding still applies. */
const PAD_TO = 6;
const PREFIX = "GR-";

/**
 * Formats an allocated order number for a human.
 *
 * Padded so numbers sort and align in a list, and prefixed so a customer
 * quoting "GR-001000" on the phone is unambiguously naming a sales order and
 * not a delivery, an invoice or a quote request.
 */
export function formatSalesOrderNumber(orderNumber: number | bigint | null | undefined): string {
  if (orderNumber === null || orderNumber === undefined) return "";
  const value = typeof orderNumber === "bigint" ? orderNumber : Math.trunc(Number(orderNumber));
  if (!Number.isFinite(Number(value))) return "";
  return `${PREFIX}${String(value).padStart(PAD_TO, "0")}`;
}

/**
 * Reads a formatted number back to its numeric form.
 *
 * Exists so a customer or an operator can paste "GR-001000" into a search box
 * and be understood. Returns null for anything that is not one of ours, rather
 * than guessing.
 */
export function parseSalesOrderNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  const digits = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;
  if (!/^\d+$/.test(digits)) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
