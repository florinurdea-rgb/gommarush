/**
 * Pure filename helper, deliberately kept out of the workbook module so it
 * carries no `server-only` marker and can be unit-tested directly.
 */

/**
 * Builds a filesystem- and Content-Disposition-safe download name, e.g.
 * "Offerta_Gomme_Rossi_SRL_2026-08-25.xlsx". Accents are folded rather than
 * dropped so "Città" stays readable as "Citta".
 */
export function safeFileName(companyName: string, createdAt: string): string {
  const company =
    companyName
      .normalize("NFD")
      // Strip combining accent marks (U+0300–U+036F).
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "Cliente";

  const date = new Date(createdAt);
  const iso = Number.isNaN(date.getTime())
    ? new Date().toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);

  return `Offerta_${company}_${iso}.xlsx`;
}
