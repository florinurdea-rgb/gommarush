import "server-only";
import JSZip from "jszip";
import { SaxesParser } from "saxes";

// A deliberately small XLSX reader, built for catalogue imports.
//
// exceljs is already a dependency, but it cannot be used here for two
// independent reasons:
//
//   1. It cannot open the supplier files we actually receive. The ISB
//      workbook is written with namespace-prefixed tags (<x:workbook>,
//      <x:sheet>), which exceljs's SAX handlers never match — it throws
//      "Cannot read properties of undefined (reading 'sheets')" before
//      reading a single row.
//   2. Even where it works, it coerces numeric-looking cells to JavaScript
//      numbers. That destroys every leading-zero barcode in the file, which
//      is precisely the data we are here to protect.
//
// So this reader returns the raw cell text for every cell and never converts
// anything. exceljs stays where it belongs: writing the quote-request export.
//
// It is also the safer parser for untrusted uploads. It reads cell values and
// nothing else: <f> formula bodies are skipped rather than evaluated, and
// external links, macros, defined names and drawings are never visited at all.

/** Bytes accepted. A full supplier catalogue is a few MB; 40 is generous. */
export const MAX_WORKBOOK_BYTES = 40 * 1024 * 1024;
/** Rows accepted per sheet, before the reader stops and reports truncation. */
export const MAX_SHEET_ROWS = 200_000;
/** Longest cell text kept. Anything past this is a payload, not a value. */
export const MAX_CELL_CHARS = 4_000;

export class WorkbookError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = "WorkbookError";
  }
}

export interface SheetRow {
  /** 1-based row number exactly as the spreadsheet numbers it. */
  sourceRow: number;
  /** Header name -> raw cell text. An absent cell is absent, not "". */
  cells: Record<string, string>;
}

export interface ReadSheetResult {
  headers: string[];
  rows: SheetRow[];
  /** True when MAX_SHEET_ROWS stopped the read before the sheet ended. */
  truncated: boolean;
}

/**
 * saxes types an attribute as a plain string when the parser is not in
 * xmlns mode and as an object when it is. Reading both shapes here keeps
 * every call site free of the distinction.
 */
function attributeValue(attribute: unknown): string {
  if (typeof attribute === "string") return attribute;
  if (attribute && typeof attribute === "object" && "value" in attribute) {
    const value = (attribute as { value: unknown }).value;
    return typeof value === "string" ? value : "";
  }
  return "";
}

/** Strips an XML namespace prefix: 'x:worksheet' -> 'worksheet'. */
function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/** 'AB12' -> 27 (1-based column index). Returns 0 for an unparseable ref. */
export function columnIndexFromRef(ref: string): number {
  let index = 0;
  for (let i = 0; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    index = index * 26 + (code - 64);
  }
  return index;
}

/**
 * Excel may store a large number as '1.2345678901E+12'. That only happens for
 * genuinely numeric cells — a text-typed barcode is never in this form — but
 * expanding it here means a numeric column can still be read as the digits it
 * represents rather than as notation.
 */
function expandScientific(value: string): string {
  if (!/^-?\d+(\.\d+)?[eE][+-]?\d+$/.test(value)) return value;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || !Number.isSafeInteger(asNumber)) return value;
  return String(asNumber);
}

/**
 * Leading characters that make a spreadsheet application treat a cell as a
 * formula. We never evaluate anything, but a value shaped like this in a
 * catalogue field means the source is not what it claims to be, and it must
 * not be written into the database unexamined or re-exported unescaped.
 */
export function looksLikeFormula(value: string): boolean {
  return /^[=+\-@\t\r]/.test(value);
}

interface SheetEntry {
  name: string;
  relationshipId: string;
}

async function loadZip(bytes: Buffer): Promise<JSZip> {
  if (bytes.byteLength === 0) throw new WorkbookError("EMPTY_FILE");
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) throw new WorkbookError("FILE_TOO_LARGE");
  // A .xlsx is a zip. Anything else fails here rather than deeper in.
  try {
    return await JSZip.loadAsync(bytes);
  } catch {
    throw new WorkbookError("NOT_A_WORKBOOK");
  }
}

async function readEntry(zip: JSZip, path: string): Promise<string | null> {
  const file = zip.file(path);
  if (!file) return null;
  return file.async("string");
}

/** Runs a saxes parse, turning any XML error into a coded WorkbookError. */
function parseXml(xml: string, configure: (parser: SaxesParser) => void): void {
  const parser = new SaxesParser();
  let failure: Error | null = null;
  parser.on("error", (error) => {
    failure = error instanceof Error ? error : new Error(String(error));
  });
  configure(parser);
  parser.write(xml).close();
  if (failure) throw new WorkbookError("MALFORMED_XML", (failure as Error).message);
}

/** The workbook's sheets, in document order, with their relationship ids. */
async function readSheetEntries(zip: JSZip): Promise<SheetEntry[]> {
  const xml = await readEntry(zip, "xl/workbook.xml");
  if (!xml) throw new WorkbookError("NOT_A_WORKBOOK");

  const sheets: SheetEntry[] = [];
  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (localName(tag.name) !== "sheet") return;
      let name = "";
      let relationshipId = "";
      for (const [key, attribute] of Object.entries(tag.attributes as Record<string, unknown>)) {
        const value = attributeValue(attribute);
        const local = localName(key);
        if (local === "name") name = value;
        else if (local === "id") relationshipId = value;
      }
      if (name) sheets.push({ name, relationshipId });
    });
  });
  return sheets;
}

/** relationship id -> part path, normalised to a zip-relative path. */
async function readRelationships(zip: JSZip): Promise<Map<string, string>> {
  const xml = await readEntry(zip, "xl/_rels/workbook.xml.rels");
  const map = new Map<string, string>();
  if (!xml) return map;

  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (localName(tag.name) !== "Relationship") return;
      let id = "";
      let target = "";
      for (const [key, attribute] of Object.entries(tag.attributes as Record<string, unknown>)) {
        const value = attributeValue(attribute);
        const local = localName(key);
        if (local === "Id") id = value;
        else if (local === "Target") target = value;
      }
      if (!id || !target) return;
      // Targets appear as '/xl/worksheets/sheet1.xml' or 'worksheets/sheet1.xml'.
      const path = target.startsWith("/")
        ? target.slice(1)
        : target.startsWith("xl/")
          ? target
          : `xl/${target.replace(/^\.\//, "")}`;
      map.set(id, path);
    });
  });
  return map;
}

/**
 * The shared string table, if the workbook has one.
 *
 * Rich text splits a single string across several <t> runs, so the runs are
 * concatenated. Phonetic hints (<rPh>) are Japanese furigana, not part of the
 * value, and are skipped — including them would append duplicate text.
 */
async function readSharedStrings(zip: JSZip): Promise<string[]> {
  const xml = await readEntry(zip, "xl/sharedStrings.xml");
  if (!xml) return [];

  const strings: string[] = [];
  let current: string[] = [];
  let inItem = false;
  let inText = false;
  let phoneticDepth = 0;

  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      const name = localName(tag.name);
      if (name === "si") {
        inItem = true;
        current = [];
      } else if (name === "rPh") {
        phoneticDepth++;
      } else if (name === "t" && inItem && phoneticDepth === 0) {
        inText = true;
      }
    });
    parser.on("text", (text) => {
      if (inText) current.push(text);
    });
    parser.on("closetag", (tag) => {
      const name = localName(tag.name);
      if (name === "t") inText = false;
      else if (name === "rPh") phoneticDepth = Math.max(0, phoneticDepth - 1);
      else if (name === "si") {
        strings.push(current.join(""));
        inItem = false;
      }
    });
  });
  return strings;
}

export async function listSheetNames(bytes: Buffer): Promise<string[]> {
  const zip = await loadZip(bytes);
  return (await readSheetEntries(zip)).map((sheet) => sheet.name);
}

export interface ReadSheetOptions {
  /** Stop after this many data rows. Defaults to MAX_SHEET_ROWS. */
  maxRows?: number;
}

/**
 * Reads one sheet into header-keyed rows.
 *
 * The first row containing any non-empty cell is the header. Every value
 * returned is the source text: no coercion, no trimming of significant
 * characters, no interpretation of what the column "means" — that is the
 * supplier adapter's job, and keeping the two apart is what lets a second
 * supplier format be added without touching this file.
 */
export async function readSheet(
  bytes: Buffer,
  sheetName: string,
  options: ReadSheetOptions = {}
): Promise<ReadSheetResult> {
  const maxRows = options.maxRows ?? MAX_SHEET_ROWS;
  const zip = await loadZip(bytes);

  const entries = await readSheetEntries(zip);
  const entry = entries.find((sheet) => sheet.name === sheetName);
  if (!entry) throw new WorkbookError("SHEET_NOT_FOUND", sheetName);

  const relationships = await readRelationships(zip);
  const path = relationships.get(entry.relationshipId);
  const xml = path ? await readEntry(zip, path) : null;
  if (!xml) throw new WorkbookError("SHEET_NOT_FOUND", sheetName);

  const sharedStrings = await readSharedStrings(zip);

  const headers: string[] = [];
  const rows: SheetRow[] = [];
  let truncated = false;

  // Per-row state.
  let rowNumber = 0;
  let rowCells: Map<number, string> = new Map();
  // Per-cell state.
  let cellColumn = 0;
  let cellType = "";
  let valueParts: string[] = [];
  // Only text inside <v> or an inline-string <t> is a value. Text inside <f>
  // is a formula body and is deliberately never collected.
  let capturing = false;
  let inInlineString = false;

  parseXml(xml, (parser) => {
    parser.on("opentag", (tag) => {
      if (truncated) return;
      const name = localName(tag.name);

      if (name === "row") {
        rowCells = new Map();
        rowNumber = 0;
        for (const [key, attribute] of Object.entries(tag.attributes as Record<string, unknown>)) {
          if (localName(key) !== "r") continue;
          const value = attributeValue(attribute);
          rowNumber = Number(value) || 0;
        }
        return;
      }

      if (name === "c") {
        cellColumn = 0;
        cellType = "";
        valueParts = [];
        inInlineString = false;
        for (const [key, attribute] of Object.entries(tag.attributes as Record<string, unknown>)) {
          const value = attributeValue(attribute);
          const local = localName(key);
          if (local === "r") cellColumn = columnIndexFromRef(value);
          else if (local === "t") cellType = value;
        }
        return;
      }

      if (name === "is") inInlineString = true;
      else if (name === "v") capturing = true;
      else if (name === "t" && inInlineString) capturing = true;
    });

    parser.on("text", (text) => {
      if (capturing && valueParts.length < 64) valueParts.push(text);
    });

    parser.on("closetag", (tag) => {
      if (truncated) return;
      const name = localName(tag.name);

      if (name === "v" || (name === "t" && inInlineString)) {
        capturing = false;
        return;
      }
      if (name === "is") {
        inInlineString = false;
        return;
      }

      if (name === "c") {
        if (cellColumn > 0 && valueParts.length > 0) {
          let value = valueParts.join("");
          if (cellType === "s") {
            // Shared string: the value is an index into the table.
            const index = Number(value);
            value = Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
          } else if (cellType === "" || cellType === "n") {
            value = expandScientific(value);
          } else if (cellType === "e") {
            // An error cell (#REF!, #VALUE!) carries no value worth importing.
            value = "";
          }
          if (value.length > MAX_CELL_CHARS) value = value.slice(0, MAX_CELL_CHARS);
          if (value !== "") rowCells.set(cellColumn, value);
        }
        valueParts = [];
        return;
      }

      if (name !== "row") return;

      if (headers.length === 0) {
        if (rowCells.size === 0) return; // leading blank row
        const highest = Math.max(...rowCells.keys());
        for (let column = 1; column <= highest; column++) {
          headers.push((rowCells.get(column) ?? "").trim());
        }
        return;
      }

      if (rowCells.size === 0) return; // blank separator row
      if (rows.length >= maxRows) {
        truncated = true;
        return;
      }

      const cells: Record<string, string> = {};
      for (const [column, value] of rowCells) {
        const header = headers[column - 1];
        if (header) cells[header] = value;
      }
      if (Object.keys(cells).length > 0) {
        rows.push({ sourceRow: rowNumber, cells });
      }
    });
  });

  if (headers.length === 0) throw new WorkbookError("EMPTY_SHEET", sheetName);

  const named = headers.filter((header) => header !== "");
  const duplicates = named.filter((header, index) => named.indexOf(header) !== index);
  if (duplicates.length > 0) {
    throw new WorkbookError("DUPLICATE_COLUMNS", Array.from(new Set(duplicates)).join(", "));
  }

  return { headers, rows, truncated };
}

/** Names the columns a sheet is missing, for an actionable error message. */
export function missingColumns(headers: string[], required: readonly string[]): string[] {
  const present = new Set(headers.map((header) => header.trim()));
  return required.filter((column) => !present.has(column));
}
