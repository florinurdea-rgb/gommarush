// Builds the small catalogue test fixtures from the full ISB workbook.
//
// The real file is 1.8 MB / 9,559 rows — too big to commit and far too slow
// to parse in every test run. This picks a couple of dozen rows that between
// them cover every case the importer has to handle, and rewrites them into a
// workbook that keeps the SOURCE FORMAT EXACTLY: namespace-prefixed tags,
// no shared string table, identifiers as text. That format is the whole
// reason we do not use exceljs to read, so a fixture that quietly normalised
// it away would test the wrong thing.
//
// Usage: node scripts/build-catalogue-fixtures.mjs <path-to-full-workbook>

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-catalogue-fixtures.mjs <workbook.xlsx>");
  process.exit(1);
}

const OUT = path.join("tests", "fixtures", "isb-sample.xlsx");
const local = (n) => (n.includes(":") ? n.split(":").pop() : n);

const zip = await JSZip.loadAsync(fs.readFileSync(source));
const sheetXml = await zip.file("xl/worksheets/sheet2.xml").async("string");

// --- read the source rows, keeping the raw XML of each ------------------
const rows = [];
let headers = null;
{
  const parser = new SaxesParser();
  let depth = 0, current = null, cells = null, col = 0, parts = [], capturing = false;
  parser.on("opentag", (tag) => {
    const name = local(tag.name);
    if (name === "row") { current = { r: Number(tag.attributes.r ?? tag.attributes["r"]) , cells: {} }; cells = current.cells; }
    else if (name === "c") {
      col = 0; parts = [];
      const ref = tag.attributes.r ?? "";
      for (let i = 0; i < ref.length; i++) {
        const c = ref.charCodeAt(i);
        if (c < 65 || c > 90) break;
        col = col * 26 + (c - 64);
      }
    } else if (name === "v") capturing = true;
  });
  parser.on("text", (t) => { if (capturing) parts.push(t); });
  parser.on("closetag", (tag) => {
    const name = local(tag.name);
    if (name === "v") { capturing = false; if (col) cells[col] = parts.join(""); }
    else if (name === "row") {
      if (!headers) {
        headers = [];
        const max = Math.max(...Object.keys(cells).map(Number));
        for (let i = 1; i <= max; i++) headers.push(cells[i] ?? "");
      } else {
        const obj = {};
        headers.forEach((h, i) => { if (h && cells[i + 1] !== undefined) obj[h] = cells[i + 1]; });
        if (Object.keys(obj).length) rows.push(obj);
      }
      current = null;
    }
  });
  parser.write(sheetXml).close();
}

// --- pick rows that cover every branch the importer has --------------------
const picked = [];
const seen = new Set();
const take = (label, predicate, count = 2) => {
  let taken = 0;
  for (const row of rows) {
    if (taken >= count) break;
    if (seen.has(row.supplier_listing_key)) continue;
    if (!predicate(row)) continue;
    seen.add(row.supplier_listing_key);
    picked.push(row);
    taken++;
  }
  if (taken === 0) console.warn(`  ! no row matched: ${label}`);
  else console.log(`  ${label}: ${taken}`);
};

// A duplicate-EAN pair has to come as a pair, so it is selected first.
const eanCounts = new Map();
for (const row of rows) if (row.ean) eanCounts.set(row.ean, (eanCounts.get(row.ean) ?? 0) + 1);
const duplicateEan = [...eanCounts].find(([, count]) => count > 1)?.[0];
if (duplicateEan) {
  for (const row of rows.filter((r) => r.ean === duplicateEan)) {
    seen.add(row.supplier_listing_key);
    picked.push(row);
  }
  console.log(`  duplicate EAN pair (${duplicateEan}): 2`);
}

take("valid EAN + supplier weight", (r) => r.ean_status === "valid" && r.weight_status === "supplier_reported", 4);
take("recovered leading zero", (r) => r.ean_status === "recovered_leading_zero", 3);
take("invalid check digit", (r) => r.ean_status === "invalid_check_digit", 1);
take("missing EAN", (r) => r.ean_status === "missing", 2);
take("missing weight", (r) => r.weight_status === "missing_or_zero" && r.ean_status === "valid", 3);
take("old DOT", (r) => r.old_dot === "1", 2);
take("run flat", (r) => r.run_flat === "1", 2);
take("winter", (r) => r.season === "winter", 2);
take("unknown season", (r) => r.season === "unknown", 2);
take("motorcycle class", (r) => r.product_class === "motorcycle", 1);
take("ISB fallback product key", (r) => r.product_key?.startsWith("ISB:"), 2);

picked.sort((a, b) => Number(a.source_row) - Number(b.source_row));
console.log(`\n  total fixture rows: ${picked.length}`);

// --- write them back out in the source's own dialect ------------------------
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colRef = (n) => {
  let ref = "";
  while (n > 0) { const m = (n - 1) % 26; ref = String.fromCharCode(65 + m) + ref; n = Math.floor((n - 1) / 26); }
  return ref;
};

const cellsXml = (values, rowNumber) =>
  values
    .map((value, i) =>
      value === undefined || value === ""
        ? ""
        : `<x:c r="${colRef(i + 1)}${rowNumber}" t="str"><x:v>${esc(value)}</x:v></x:c>`
    )
    .join("");

let body = `<x:row r="1">${cellsXml(headers, 1)}</x:row>`;
picked.forEach((row, index) => {
  const rowNumber = index + 2;
  body += `<x:row r="${rowNumber}">${cellsXml(headers.map((h) => row[h]), rowNumber)}</x:row>`;
});

const out = new JSZip();
out.file(
  "[Content_Types].xml",
  `<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" /><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>`
);
out.file(
  "_rels/.rels",
  `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="RootRel" /></Relationships>`
);
out.file(
  "xl/workbook.xml",
  `<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="Tyre Import" sheetId="1" r:id="RSheet1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>`
);
out.file(
  "xl/_rels/workbook.xml.rels",
  `<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="RSheet1" /></Relationships>`
);
out.file(
  "xl/worksheets/sheet1.xml",
  `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${body}</x:sheetData></x:worksheet>`
);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`\nwrote ${OUT} (${fs.statSync(OUT).size} bytes)`);
