// Gateway response parsing.
//
// The wire format, from the manual:
//
//   * "The returned data is tab delimited" (§1.2).
//   * Every response ends with the literal marker `*END*` (§2.1 examples).
//   * On failure the WHOLE body is a two-digit code and a description, with
//     "no other output" (§1.2). There is no HTTP status to go on: an error
//     arrives as a perfectly ordinary 200.
//
// So a response is never assumed to be data. It is classified first, and the
// classification is the security-relevant part: reading an error line as if
// it were a stock row would put a nonsense article into the system.
//
// Pure and dependency-free.

/** §2.1: every well-formed response is terminated by this marker. */
export const END_MARKER = "*END*";

/** §4.1: a successful order entry begins with this fixed field. */
export const ORDER_OK_CODE = "00";

/** §4.2 / Appendix 3: a validated test order returns this, and places nothing. */
export const TEST_OK_CODE = "01";

/** Appendix 3: an unrecognised protocol produces this instead of a code. */
export const INCORRECT_TYPE = "*INCORRECT TYPE*";

export type ResponseOutcome =
  | { status: "data"; rows: string[][]; truncated: boolean }
  | { status: "order_placed"; rows: string[][] }
  | { status: "test_ok" }
  | { status: "error"; code: string; description: string }
  | { status: "malformed"; reason: string };

/**
 * Appendix 3 defines errors as codes above 10; 00 and 01 are successes.
 * Anything else numeric and two digits is an error.
 */
function isErrorCode(token: string): boolean {
  if (!/^\d{2}$/.test(token)) return false;
  return Number(token) > 10;
}

export interface ParseOptions {
  /** Stop after this many data rows. Guards against an unbounded response. */
  maxRows?: number;
}

/**
 * Classifies and parses a raw gateway body.
 *
 * Never throws: a caller must be able to record the raw response and decide,
 * and a parser that throws on malformed supplier output loses the evidence
 * of what the supplier actually said.
 */
export function parseGatewayResponse(
  raw: string,
  options: ParseOptions = {}
): ResponseOutcome {
  const maxRows = options.maxRows ?? 20_000;

  if (typeof raw !== "string" || raw.trim() === "") {
    return { status: "malformed", reason: "EMPTY_RESPONSE" };
  }

  const text = raw.replace(/\r\n/g, "\n");

  if (text.includes(INCORRECT_TYPE)) {
    return { status: "error", code: "INCORRECT_TYPE", description: "unknown command or protocol" };
  }

  // The end marker is the only evidence the response is complete. Without it
  // the body may be a truncated transfer, and a truncated stock list read as
  // complete is how an article silently "goes out of stock".
  const endIndex = text.indexOf(END_MARKER);
  if (endIndex === -1) {
    return { status: "malformed", reason: "MISSING_END_MARKER" };
  }

  const body = text.slice(0, endIndex);
  const lines = body
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) {
    return { status: "malformed", reason: "NO_CONTENT_BEFORE_END_MARKER" };
  }

  // Classifying an error is the delicate part, for two reasons.
  //
  // First, the manual's error examples are SPACE separated, not tab
  // separated: "92 not enough stock", "01 test ok" (§4.2). Splitting on tab
  // alone never finds the code.
  //
  // Second, a leading two-digit number does not by itself mean an error —
  // protocol 15 (§5.6) returns a whole LIST of error numbers as ordinary
  // data, and every one of its rows starts with one.
  //
  // What actually distinguishes them is §1.2: on failure "only an error code
  // with an explanation will be returned (no other output)". An error is
  // therefore the entire body — a single line, carrying no tab-delimited
  // record. That is the test used here.
  const singleLine = lines.length === 1 && !lines[0].includes("\t");
  if (singleLine) {
    const match = /^(\d{2})(?:\s+(.*))?$/.exec(lines[0].trim());
    if (match) {
      const [, code, description = ""] = match;
      if (code === TEST_OK_CODE) return { status: "test_ok" };
      if (isErrorCode(code)) {
        return { status: "error", code, description: description.trim() };
      }
    }
  }

  const rows = lines.slice(0, maxRows).map((line) => line.split("\t").map((f) => f.trim()));

  // §4.1: a successful order entry begins with the fixed field "00".
  if (rows[0][0] === ORDER_OK_CODE) {
    return { status: "order_placed", rows };
  }

  return { status: "data", rows, truncated: lines.length > maxRows };
}

/**
 * Maps a §2.1 stock row onto named fields.
 *
 * Only the fields this integration actually consumes are named. The full row
 * is always kept alongside, because the manual lists ~40 positional columns
 * and naming ones we do not use would be an untested claim about their order.
 */
export interface StockRow {
  articleSystemNumber: string;
  articleCode: string;
  brand: string;
  groupNumber: string;
  description: string;
  currency: string;
  netPrice: string;
  grossPrice: string;
  available: string;
  /** Every field as returned, positionally. */
  fields: string[];
}

export function toStockRow(fields: string[]): StockRow {
  const at = (index: number) => fields[index] ?? "";
  return {
    articleSystemNumber: at(0),
    articleCode: at(1),
    brand: at(2),
    groupNumber: at(3),
    description: at(4),
    currency: at(5),
    netPrice: at(6),
    grossPrice: at(7),
    available: at(8),
    fields,
  };
}
