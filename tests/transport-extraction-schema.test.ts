import { describe, expect, it } from "vitest";
import { zodTextFormat } from "openai/helpers/zod";
import {
  EXTRACTION_FORMAT_NAME,
  EXTRACTION_SCHEMA_VERSION,
  TransportDocumentExtractionSchema,
} from "@/lib/transport/extraction-schema";

/**
 * OpenAI strict Structured Outputs rejects a schema at request time if any
 * object omits a property from `required`, or allows additional properties.
 * Catching that here costs milliseconds; catching it in production costs a
 * failed extraction on a real document.
 */

type JsonSchemaNode = {
  type?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  anyOf?: JsonSchemaNode[];
  allOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  $defs?: Record<string, JsonSchemaNode>;
};

function collectViolations(root: JsonSchemaNode): string[] {
  const violations: string[] = [];
  const seen = new Set<JsonSchemaNode>();

  function walk(node: JsonSchemaNode | undefined, path: string): void {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (node.type === "object") {
      const props = Object.keys(node.properties ?? {});
      const required = node.required ?? [];
      const missing = props.filter((prop) => !required.includes(prop));
      if (missing.length > 0) {
        violations.push(`${path}: properties not in required -> ${missing.join(", ")}`);
      }
      if (node.additionalProperties !== false) {
        violations.push(`${path}: additionalProperties must be false`);
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        walk(child, `${path}.${key}`);
      }
    }

    walk(node.items, `${path}[]`);
    for (const key of ["anyOf", "allOf", "oneOf"] as const) {
      node[key]?.forEach((child, index) => walk(child, `${path}.${key}[${index}]`));
    }
    for (const [key, child] of Object.entries(node.$defs ?? {})) {
      walk(child, `$defs.${key}`);
    }
  }

  walk(root, "root");
  return violations;
}

describe("transport extraction schema - OpenAI strict mode compatibility", () => {
  const format = zodTextFormat(TransportDocumentExtractionSchema, EXTRACTION_FORMAT_NAME);

  it("produces a json_schema text format with strict enabled", () => {
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe(EXTRACTION_FORMAT_NAME);
    expect(format.strict).toBe(true);
  });

  it("has no strict-mode violations anywhere in the tree", () => {
    const violations = collectViolations(format.schema as JsonSchemaNode);
    expect(violations).toEqual([]);
  });

  it("requires every top-level field", () => {
    const schema = format.schema as JsonSchemaNode;
    expect(schema.required).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "documentClassification",
        "distributor",
        "inboundLogistics",
        "deliveries",
        "transportStart",
        "warnings",
      ])
    );
  });
});

describe("transport extraction schema - business guarantees", () => {
  it("carries no commercial fields", () => {
    // The transport business does not own the tyre sale. The surest way to
    // stop a supplier's price becoming a COD amount is for the extraction
    // never to return one.
    const serialised = JSON.stringify(zodTextFormat(TransportDocumentExtractionSchema, EXTRACTION_FORMAT_NAME));
    for (const forbidden of [
      "unitPrice",
      "unit_price",
      "lineTotal",
      "line_total",
      "discount",
      "vatRate",
      "vat_rate",
      "taxableTotal",
      "pfu",
      "margin",
      "markup",
      "sellingPrice",
    ]) {
      expect(serialised.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("accepts a minimal Zuin-shaped extraction", () => {
    const parsed = TransportDocumentExtractionSchema.safeParse({
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      documentClassification: {
        documentType: "DDT_VENDITA",
        isTransportRelevant: true,
        documentNumber: "1A - 050472/VR",
        documentDate: "2026-08-06",
        pageCountDetected: 1,
      },
      distributor: {
        name: "ZUIN S.p.A.",
        vatNumber: "02627710284",
        warehouseName: "RIVOLI VERONESE",
        documentCustomerCode: null,
      },
      inboundLogistics: {
        method: "UNKNOWN",
        pickupRequired: null,
        pickupCompany: "ZUIN S.p.A.",
        pickupAddress: "VIA DELL'ARTIGIANATO 10, 37010 RIVOLI VERONESE VR",
        requestedPickupDate: null,
        requestedPickupTimeWindow: null,
        sourceCarrier: "GO RUSH TRASPORTI SRLS",
      },
      deliveries: [
        {
          deliveryDocumentNumber: "1A - 050472/VR",
          supplierOrderReference: "0B/17115",
          recipient: {
            companyName: "EMMECI GOMME di Nicetto Federico",
            customerCode: "034932",
            taxCode: "NCTFRC90C06L840X",
            vatNumber: "03824320240",
            contactName: null,
            phone: "0444 420953",
            email: null,
            addressLine: "STRADA CA' BALBI 1",
            postalCode: "36050",
            city: "QUINTO VICENTINO",
            province: "VI",
            country: "IT",
            completeAddress: "STRADA CA' BALBI 1, 36050 QUINTO VICENTINO VI",
          },
          items: [
            {
              supplierProductCode: "NEX16618NX",
              ean: null,
              barcode: null,
              supplierOrderReference: "0B/17115",
              originalDescription: "185/55R16 83V N FERA PRIMUS RBP",
              brand: "NEXEN",
              model: "N FERA PRIMUS",
              width: 185,
              aspectRatio: 55,
              rimDiameter: 16,
              loadIndex: "83",
              speedIndex: "V",
              normalizedSize: "185/55 R16",
              quantity: 1,
            },
          ],
          totalTyres: 1,
          packages: 1,
          weightKg: 7.3,
          payment: {
            printedTerms: "RIBA 30 gg FM",
            operationalStatus: "NO_COLLECTION_REQUIRED",
            mustDriverCollect: false,
            amountToCollect: 0,
            currency: "EUR",
            paymentMethod: "RIBA",
            evidence: "RIBA 30 gg FM",
          },
          deliveryDate: null,
          deliveryTimeWindow: null,
          deliveryInstructions: null,
          documentNotes: null,
          sourcePageStart: 1,
          sourcePageEnd: 1,
        },
      ],
      transportStart: null,
      warnings: [],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects an extraction with a missing key rather than coercing it", () => {
    const parsed = TransportDocumentExtractionSchema.safeParse({
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      // documentClassification omitted entirely
      distributor: { name: null, vatNumber: null, warehouseName: null, documentCustomerCode: null },
      inboundLogistics: {
        method: "UNKNOWN",
        pickupRequired: null,
        pickupCompany: null,
        pickupAddress: null,
        requestedPickupDate: null,
        requestedPickupTimeWindow: null,
        sourceCarrier: null,
      },
      deliveries: [],
      transportStart: null,
      warnings: [],
    });

    expect(parsed.success).toBe(false);
  });
});
