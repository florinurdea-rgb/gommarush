// Strict delimited-text reader for the Deldo price & stock feed.
//
// Separate from the mapping in parse.ts because they fail for different
// reasons and at different times: this file decides whether the bytes are a
// well-formed table at all, parse.ts decides what the cells mean. A structural
// failure must be reported as one, not as six thousand mysterious row errors.
//
// Verified against the supplier's own sample, 26933TEST.csv (6,729 data rows):
//
//   delimiter    ';'
//   quoting      none present — zero '"' characters in the whole file
//   encoding     pure ASCII, no BOM
//   line ending  LF only, no CR anywhere
//   shape        perfectly rectangular, 35 fields on every one of 6,730 lines
//   empties      a plain empty string between two delimiters
//
// RFC 4180 quoting is still implemented despite the sample containing none.
// The alternative is a reader that splits on every delimiter, which would
// silently mis-split the first field that ever contains a ';' inside quotes —
// and that failure produces a shifted row that still parses, which is far
// worse than an error.

export interface CsvReadOptions {
  readonly delimiter: string;
  /**
   * Expected header names, in order. The read fails unless the file's header
   * matches exactly — same names, same order, same count.
   *
   * Exact rather than "contains the columns we need" on purpose: a supplier
   * who inserts, removes or reorders a column has changed the contract, and
   * every positional assumption downstream is then wrong. Discovering that
   * from a price in the wrong column is discovering it too late.
   */
  readonly expectedHeader: readonly string[];
}

export interface CsvRow {
  /** 1-based line number in the source file, header included. */
  readonly sourceLine: number;
  /** Cells keyed by header name. */
  readonly cells: Readonly<Record<string, string>>;
}

export interface MalformedLine {
  readonly sourceLine: number;
  readonly reason: "field_count_mismatch";
  readonly expectedFields: number;
  readonly actualFields: number;
}

export interface CsvReadResult {
  readonly rows: readonly CsvRow[];
  /**
   * Lines that were structurally wrong and skipped.
   *
   * A malformed row must not corrupt an otherwise valid import, so these are
   * collected and reported rather than thrown. A structurally incompatible
   * FILE is a different matter and throws — see CsvStructureError.
   */
  readonly malformed: readonly MalformedLine[];
  readonly totalDataLines: number;
}

export type CsvStructureErrorKind =
  | "empty_file"
  | "header_mismatch"
  | "wrong_delimiter";

export class CsvStructureError extends Error {
  readonly kind: CsvStructureErrorKind;
  readonly detail: string;

  constructor(kind: CsvStructureErrorKind, message: string, detail = "") {
    super(message);
    this.name = "CsvStructureError";
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * Splits one line into fields, honouring RFC 4180 double-quote escaping.
 *
 * A quote only opens a quoted field at the START of a field; a stray quote in
 * the middle of unquoted text is data. That matters for tyre descriptions,
 * where an inch mark is a legitimate character and must not silently swallow
 * the rest of the line.
 */
export function splitDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let index = 0;
  let inQuotes = false;
  let fieldStart = true;

  while (index < line.length) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && fieldStart) {
      inQuotes = true;
      fieldStart = false;
      index += 1;
      continue;
    }

    if (line.startsWith(delimiter, index)) {
      fields.push(field);
      field = "";
      index += delimiter.length;
      fieldStart = true;
      continue;
    }

    field += char;
    fieldStart = false;
    index += 1;
  }

  fields.push(field);
  return fields;
}

/**
 * Reads the feed into header-keyed rows.
 *
 * Throws CsvStructureError when the FILE cannot be trusted at all. Collects
 * MalformedLine when an individual LINE cannot. The distinction is the whole
 * point of the function: an optimistic reader that interpreted a
 * wrong-shaped file would produce plausible-looking commercial data.
 */
export function readDeldoCsv(
  content: string,
  options: CsvReadOptions
): CsvReadResult {
  // Tolerated on input even though the sample has none: a file that gains CRLF
  // after passing through a Windows FTP client is still the same table, and
  // failing on it would be pedantry rather than safety.
  const lines = content.split(/\r?\n/);

  // A trailing newline is conventional and produces one empty final element.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  if (lines.length === 0) {
    throw new CsvStructureError("empty_file", "Deldo feed is empty");
  }

  const header = splitDelimitedLine(lines[0], options.delimiter);

  // One field from a multi-column header almost always means the delimiter is
  // wrong, and saying so beats reporting 35 missing columns.
  if (header.length === 1 && options.expectedHeader.length > 1) {
    throw new CsvStructureError(
      "wrong_delimiter",
      `Deldo feed header did not split on '${options.delimiter}' — wrong delimiter, or not a delimited file`,
      `header line began: ${lines[0].slice(0, 120)}`
    );
  }

  const expected = options.expectedHeader;
  const matches =
    header.length === expected.length &&
    header.every((name, i) => name.trim() === expected[i]);

  if (!matches) {
    const missing = expected.filter((e) => !header.some((h) => h.trim() === e));
    const unexpected = header
      .map((h) => h.trim())
      .filter((h) => !expected.includes(h));
    throw new CsvStructureError(
      "header_mismatch",
      `Deldo feed header does not match the verified contract (expected ${expected.length} columns, found ${header.length})`,
      [
        missing.length ? `missing: ${missing.join(", ")}` : "",
        unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" | ")
    );
  }

  const rows: CsvRow[] = [];
  const malformed: MalformedLine[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === "") continue;

    const fields = splitDelimitedLine(raw, options.delimiter);
    const sourceLine = i + 1;

    if (fields.length !== expected.length) {
      malformed.push({
        sourceLine,
        reason: "field_count_mismatch",
        expectedFields: expected.length,
        actualFields: fields.length,
      });
      continue;
    }

    const cells: Record<string, string> = {};
    for (let c = 0; c < expected.length; c += 1) cells[expected[c]] = fields[c];
    rows.push({ sourceLine, cells });
  }

  return {
    rows,
    malformed,
    totalDataLines: rows.length + malformed.length,
  };
}
