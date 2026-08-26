/**
 * Neutralises spreadsheet formula injection.
 *
 * A company name or product description is customer-controlled text. If it
 * begins with =, +, -, @ or a control character, a spreadsheet application
 * can treat the cell as a formula — the classic vector being =HYPERLINK(...)
 * or a DDE payload that runs when the file is opened. Prefixing an
 * apostrophe forces the cell to be read as literal text; the apostrophe is
 * not part of the stored value and is not displayed.
 *
 * Applied to every cell derived from customer input, never to our own labels
 * or to the deliberate pricing formulas.
 *
 * Kept in its own module with no `server-only` marker so it can be unit
 * tested directly.
 */
export function sanitizeCellText(value: string): string {
  if (value.length === 0) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
