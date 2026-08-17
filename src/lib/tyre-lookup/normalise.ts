/**
 * Barcode input handling — no "server-only" here, the client component
 * normalises optimistically too so the status line echoes exactly what will
 * be searched.
 */

export function normaliseBarcode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

/**
 * Cheap sanity check before spending a real (paid, several-second) web
 * search + LLM call: rejects empty input, scanner noise, and anything that
 * doesn't look like a barcode at all. Deliberately permissive on charset —
 * EAN/UPC/GTIN are numeric, but manufacturer article codes are often
 * alphanumeric with hyphens.
 */
export function isPlausibleBarcode(value: string): boolean {
  return value.length >= 4 && value.length <= 64 && /^[A-Za-z0-9-]+$/.test(value);
}
