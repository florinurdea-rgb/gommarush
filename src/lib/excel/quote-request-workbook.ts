import "server-only";
import ExcelJS from "exceljs";
import {
  DELIVERY_LABELS,
  SEASON_LABELS,
  formatTyreSize,
  type QuoteRequestDetail,
  type QuoteRequestItemRow,
} from "@/lib/types/quote-request";
import { safeFileName } from "@/lib/excel/file-name";
import { sanitizeCellText } from "@/lib/excel/sanitize";

export { safeFileName, sanitizeCellText };

/**
 * Builds the operator's pricing worksheet for one quote request.
 *
 * The whole design goal: the operator opens this, types unit prices into one
 * column, and everything else is already done. So row totals and the grand
 * total are LIVE EXCEL FORMULAS, not values computed here — a pre-computed
 * total would read 0 and stay 0 once prices are entered.
 *
 * Built from trusted server-side data (loaded from Supabase by the caller),
 * never from anything the client sends.
 */

const EURO_FORMAT = '#,##0.00 "€"';

/** Row 1 is the title, so the table starts far enough down for the header block. */
const HEADER_ROW = 7;

function describeProduct(item: QuoteRequestItemRow): string {
  if (item.product_type === "tyre") return "Pneumatico";
  // For 'other' the description IS the product — never lose it.
  return sanitizeCellText(item.description?.trim() || "Altro prodotto");
}

function describePreference(item: QuoteRequestItemRow): string {
  if (item.preference_type === "specific_brand") {
    return sanitizeCellText(item.preferred_brand?.trim() || "Marca specifica");
  }
  return "Miglior prezzo";
}

export async function buildQuoteRequestWorkbook(detail: QuoteRequestDetail): Promise<Buffer> {
  const { request, items } = detail;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GommaRush";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Offerta", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
  });

  sheet.columns = [
    { key: "product", width: 34 },
    { key: "size", width: 18 },
    { key: "index", width: 12 },
    { key: "season", width: 16 },
    { key: "brand", width: 22 },
    { key: "delivery", width: 14 },
    { key: "quantity", width: 10 },
    { key: "unitPrice", width: 16 },
    { key: "total", width: 16 },
    // The three columns the operator fills in besides price.
    { key: "availability", width: 18 },
    { key: "itemNotes", width: 30 },
  ];

  // ---- header block ----------------------------------------------------
  const title = sheet.getCell("A1");
  title.value = sanitizeCellText(`OFFERTA PER: ${request.company_name}`);
  title.font = { bold: true, size: 15 };
  sheet.mergeCells("A1:D1");

  const submitted = new Date(request.created_at);
  sheet.getCell("A2").value = "Data:";
  sheet.getCell("B2").value = Number.isNaN(submitted.getTime()) ? "—" : submitted;
  sheet.getCell("B2").numFmt = "dd/mm/yyyy";

  sheet.getCell("A3").value = "Riferimento:";
  sheet.getCell("B3").value = request.public_reference;
  sheet.getCell("B3").font = { bold: true };

  sheet.getCell("A4").value = "Email:";
  sheet.getCell("B4").value = sanitizeCellText(request.contact_email);

  if (request.whatsapp) {
    sheet.getCell("A5").value = "WhatsApp:";
    sheet.getCell("B5").value = sanitizeCellText(request.whatsapp);
  }

  for (const address of ["A2", "A3", "A4", "A5"]) {
    sheet.getCell(address).font = { color: { argb: "FF6B7280" } };
  }

  // ---- table header ----------------------------------------------------
  const header = sheet.getRow(HEADER_ROW);
  header.values = [
    "Prodotto",
    "Dimensione",
    "Indice",
    "Stagione",
    "Marca / preferenza",
    "Consegna",
    "Quantità",
    "Prezzo unitario",
    "Totale",
    "Disponibilità",
    "Note",
  ];
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
  });

  // ---- item rows -------------------------------------------------------
  const firstDataRow = HEADER_ROW + 1;

  items.forEach((item, index) => {
    const rowNumber = firstDataRow + index;
    const row = sheet.getRow(rowNumber);

    row.getCell("product").value = describeProduct(item);
    row.getCell("size").value = formatTyreSize(item.width, item.profile, item.rim) ?? "—";
    row.getCell("index").value = sanitizeCellText(item.load_speed_index ?? "—");
    row.getCell("season").value = item.season ? SEASON_LABELS[item.season] : "—";
    row.getCell("brand").value = describePreference(item);
    row.getCell("delivery").value = DELIVERY_LABELS[item.delivery_speed] ?? item.delivery_speed;
    row.getCell("quantity").value = item.quantity;

    const unitPrice = row.getCell("unitPrice");
    // Deliberately EMPTY — this is the one column the operator fills in.
    unitPrice.value = null;
    unitPrice.numFmt = EURO_FORMAT;

    const total = row.getCell("total");
    // Live formula: shows nothing until a price is typed, then computes.
    // Columns shifted by the new Stagione column: quantity is now G and
    // unit price H, so the total is column I.
    total.value = { formula: `IF(H${rowNumber}="","",G${rowNumber}*H${rowNumber})` };
    total.numFmt = EURO_FORMAT;

    // Deliberately empty — the operator's two free-text quotation fields.
    row.getCell("availability").value = null;
    row.getCell("itemNotes").value = null;
  });

  const lastDataRow = firstDataRow + Math.max(items.length, 1) - 1;

  // ---- grand total -----------------------------------------------------
  const totalRowNumber = lastDataRow + 2;
  const totalRow = sheet.getRow(totalRowNumber);
  totalRow.getCell("unitPrice").value = "Totale offerta";
  totalRow.getCell("unitPrice").font = { bold: true };

  const grandTotal = totalRow.getCell("total");
  grandTotal.value = { formula: `SUM(I${firstDataRow}:I${lastDataRow})` };
  grandTotal.numFmt = EURO_FORMAT;
  grandTotal.font = { bold: true };
  grandTotal.border = { top: { style: "thin", color: { argb: "FFD1D5DB" } } };

  // ---- customer notes --------------------------------------------------
  if (request.notes) {
    const notesRow = totalRowNumber + 2;
    const label = sheet.getCell(`A${notesRow}`);
    label.value = "Note del cliente";
    label.font = { bold: true };

    const body = sheet.getCell(`A${notesRow + 1}`);
    body.value = sanitizeCellText(request.notes);
    body.alignment = { wrapText: true, vertical: "top" };
    sheet.mergeCells(`A${notesRow + 1}:E${notesRow + 3}`);
  }

  // exceljs types this as a generic Buffer-like; the Node build returns a real Buffer.
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
