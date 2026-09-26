import { splitDelimitedLine } from "@/lib/suppliers/deldo/feed/csv-reader";

// CSV reader for the Inter-Sprint FTP delivery.
//
// Inter-Sprint stated the delivered files are CSV. We have never seen one:
// the two artefacts we hold are XLSX exports of CSVs ('vrd-pcr.csv.xlsx'), and
// this environment has no route to the FTP host. So the delimiter, quoting and
// encoding of the real file are NOT known.
//
// The response to that is detection, not a guess. The COLUMN CONTRACT is
// known and verified — 34 PCR columns and 33 truck columns, read off the
// samples in M8 — so this reader tries each plausible delimiter and keeps only
// the one that reproduces that contract. A file that matches none is refused.
//
// The practical difference: if Inter-Sprint ships semicolons and we had
// hard-coded a comma, a guess would silently yield one giant column per row
// and an importer downstream would reject 9,559 rows for missing a sysnr.
// Detection either finds the real delimiter or says the format changed.
//
// It produces header-keyed rows, which is exactly what the M8 adapter already
// consumes — so the commercial interpretation is NOT duplicated here. This
// file knows about delimiters; it knows nothing about prices.
//
// Pure: no I/O.

/**
 * Delimiters worth trying, most likely first.
 *
 * Semicolon leads because it is what Deldo ships and what European exports
 * produce when the locale uses a comma decimal separator. That ordering is a
 * heuristic for SPEED only — correctness comes from the header check, and a
 * delimiter that does not reproduce the contract is rejected however likely
 * it looked.
 */
export const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"] as const;
export type CandidateDelimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * Columns that must be present for a file to be an Inter-Sprint feed.
 *
 * The same four the M8 adapter requires. Deliberately not the full 34: the
 * truck file legitimately lacks `wcat`, and a supplier adding a descriptive
 * column must not stop a price refresh.
 */
export const REQUIRED_FEED_COLUMNS = ["sysnr", "itemcode", "nett-price", "available"] as const;

/**
 * The full header of the PCR sample, in order, as verified in M8.
 *
 * Used to RECOGNISE the format, not to require it exactly. Four columns in the
 * sample have empty names, which is why a positional equality check would be
 * the wrong test.
 */
export const KNOWN_PCR_HEADER_COLUMNS = 34;
export const KNOWN_TRUCK_HEADER_COLUMNS = 33;

export type CsvFeedErrorKind =
  | "empty_file"
  | "no_delimiter_matched"
  | "missing_required_columns"
  | "duplicate_columns"
  | "no_data_rows";

export class CsvFeedError extends Error {
  readonly kind: CsvFeedErrorKind;
  readonly detail: string;

  constructor(kind: CsvFeedErrorKind, detail: string) {
    super(`${kind}: ${detail}`);
    this.name = "CsvFeedError";
    this.kind = kind;
    this.detail = detail;
  }
}

export interface CsvFeedRow {
  /** 1-based line number in the source file, header included. */
  readonly sourceRow: number;
  readonly cells: Readonly<Record<string, string>>;
}

export interface CsvFeedReadResult {
  readonly delimiter: CandidateDelimiter;
  readonly headers: readonly string[];
  readonly rows: readonly CsvFeedRow[];
  /** Rows whose field count did not match the header. Kept, never guessed at. */
  readonly malformedLines: readonly number[];
  /** Rows skipped as padding: no identity columns at all. */
  readonly paddingLines: number;
}

/**
 * Strips a UTF-8 byte-order mark.
 *
 * A BOM on the first line would make the first header 'sysnr' into '﻿sysnr',
 * which matches nothing and would be reported as a format change. Windows
 * exports produce them routinely.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Splits on CRLF or LF, and drops a trailing empty line. */
function toLines(text: string): string[] {
  const lines = stripBom(text).split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

function normaliseHeaders(fields: readonly string[]): string[] {
  return fields.map((field) => field.trim());
}

/**
 * Scores a candidate delimiter against the known contract.
 *
 * A delimiter only scores if the header it produces contains every required
 * column. Field COUNT is then used to break ties, favouring the counts we have
 * actually seen — but a high count never rescues a header missing `sysnr`.
 */
function scoreDelimiter(headerLine: string, delimiter: string): number | null {
  const headers = normaliseHeaders(splitDelimitedLine(headerLine, delimiter));
  const present = new Set(headers);
  for (const required of REQUIRED_FEED_COLUMNS) {
    if (!present.has(required)) return null;
  }

  let score = 1000;
  if (headers.length === KNOWN_PCR_HEADER_COLUMNS) score += 100;
  else if (headers.length === KNOWN_TRUCK_HEADER_COLUMNS) score += 100;
  return score + headers.length;
}

/**
 * Detects the delimiter of an Inter-Sprint CSV.
 *
 * Returns null when no candidate reproduces the contract, which the caller
 * must treat as "this is not a file we understand" rather than falling back to
 * a default. Falling back is how a format change becomes a silent mis-import.
 */
export function detectDelimiter(headerLine: string): CandidateDelimiter | null {
  let best: { delimiter: CandidateDelimiter; score: number } | null = null;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const score = scoreDelimiter(headerLine, delimiter);
    if (score === null) continue;
    if (!best || score > best.score) best = { delimiter, score };
  }

  return best?.delimiter ?? null;
}

/**
 * Reads an Inter-Sprint CSV into header-keyed rows.
 *
 * Fails closed on anything it cannot prove:
 *
 *   * an empty file
 *   * a header no candidate delimiter can turn into the known contract
 *   * a header missing any required column
 *   * duplicate column names, which would silently shadow one another
 *
 * A line whose field count disagrees with the header is recorded as malformed
 * and NOT imported — padding a short line with empty strings would invent a
 * price of nothing, and truncating a long one would drop data.
 */
export function readIntersprintCsv(text: string): CsvFeedReadResult {
  const lines = toLines(text);
  if (lines.length === 0) {
    throw new CsvFeedError("empty_file", "the file contains no lines");
  }

  const headerLine = lines[0];
  const delimiter = detectDelimiter(headerLine);
  if (!delimiter) {
    throw new CsvFeedError(
      "no_delimiter_matched",
      `no candidate delimiter (${CANDIDATE_DELIMITERS.map((d) => JSON.stringify(d)).join(", ")}) produced a header containing ${REQUIRED_FEED_COLUMNS.join(", ")}`
    );
  }

  const headers = normaliseHeaders(splitDelimitedLine(headerLine, delimiter));

  const named = headers.filter((header) => header !== "");
  const duplicates = [...new Set(named.filter((h, i) => named.indexOf(h) !== i))];
  if (duplicates.length > 0) {
    throw new CsvFeedError("duplicate_columns", duplicates.join(", "));
  }

  const present = new Set(headers);
  const missing = REQUIRED_FEED_COLUMNS.filter((column) => !present.has(column));
  if (missing.length > 0) {
    throw new CsvFeedError("missing_required_columns", missing.join(", "));
  }

  const sysnrIndex = headers.indexOf("sysnr");
  const itemcodeIndex = headers.indexOf("itemcode");

  const rows: CsvFeedRow[] = [];
  const malformedLines: number[] = [];
  let paddingLines = 0;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const sourceRow = index + 1;

    if (line.trim() === "") {
      paddingLines++;
      continue;
    }

    const fields = splitDelimitedLine(line, delimiter);
    if (fields.length !== headers.length) {
      malformedLines.push(sourceRow);
      continue;
    }

    // Identity-less rows are padding, exactly as in the XLSX path. A CSV is
    // less likely to carry Excel's grid padding, but a trailing run of
    // delimiters produces the same shape and the same hazard.
    const hasIdentity =
      (fields[sysnrIndex] ?? "").trim() !== "" || (fields[itemcodeIndex] ?? "").trim() !== "";
    if (!hasIdentity) {
      paddingLines++;
      continue;
    }

    const cells: Record<string, string> = {};
    for (let column = 0; column < headers.length; column++) {
      const header = headers[column];
      if (header) cells[header] = fields[column] ?? "";
    }
    rows.push({ sourceRow, cells });
  }

  if (rows.length === 0) {
    throw new CsvFeedError("no_data_rows", "the header parsed but no data row carried an identity");
  }

  return { delimiter, headers, rows, malformedLines, paddingLines };
}
