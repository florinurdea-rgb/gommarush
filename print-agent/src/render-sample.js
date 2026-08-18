import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { renderLabelPdf } from "./label-renderer.js";

/**
 * Renders a sample label to ./output/sample-label.pdf without touching Supabase
 * or a printer. Use it to check the layout and, importantly, to verify that a
 * handheld scanner actually reads the printed Code128 before going live.
 */
const SAMPLE = {
  inventory_unit_id: "00000000-0000-0000-0000-000000000000",
  unit_token: "GRU9F3A21C4B87E0D6A5FC3E11",
  order_number: 1,
  stand_code: "A",
  customer: "Rossi Gomme SRL",
  product: "Michelin Primacy 4",
  brand: "Michelin",
  size: "225/55 R18",
  load_speed: "98V",
  unit_index: 2,
  unit_total: 4,
  item_type: "tyre",
  supplier: "Carlini Gomme Srl",
  delivery_address: "Via Santa Fosca 25, Vicenza",
};

const outputDir = resolve(process.env.OUTPUT_DIR ?? "./output");
await mkdir(outputDir, { recursive: true });

const pdf = await renderLabelPdf(SAMPLE, {
  widthMm: Number(process.env.LABEL_WIDTH_MM ?? 100),
  heightMm: Number(process.env.LABEL_HEIGHT_MM ?? 70),
  marginMm: Number(process.env.LABEL_MARGIN_MM ?? 4),
});

const path = resolve(outputDir, "sample-label.pdf");
await writeFile(path, pdf);
console.log(`Sample label written to ${path} (${pdf.length} bytes)`);
