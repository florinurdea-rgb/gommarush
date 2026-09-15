import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/transport/extraction-schema";
import type { TransportDocumentExtraction } from "@/lib/transport/extraction-schema";

/**
 * The provider is tested entirely against a mocked SDK. No test in this file
 * reaches OpenAI: a suite that needs network access and a funded API key is a
 * suite that stops being run.
 */

const parseMock = vi.fn();

class FakeAPIError extends Error {
  status: number;
  constructor(status: number, message = "api error") {
    super(message);
    this.name = "APIError";
    this.status = status;
  }
}

vi.mock("openai", () => {
  class MockOpenAI {
    responses = { parse: parseMock };
    constructor(_options: unknown) {
      void _options;
    }
    static APIError = FakeAPIError;
  }
  return { default: MockOpenAI, APIError: FakeAPIError };
});

vi.mock("openai/helpers/zod", () => ({
  zodTextFormat: (_schema: unknown, name: string) => ({ type: "json_schema", name, strict: true, schema: {} }),
}));

function validExtraction(overrides: Partial<TransportDocumentExtraction> = {}): TransportDocumentExtraction {
  return {
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
    ...overrides,
  };
}

function okResponse(parsed: unknown, usage = { input_tokens: 1200, output_tokens: 400, total_tokens: 1600 }) {
  return {
    id: "resp_abc123",
    _request_id: "req_xyz789",
    output: [{ content: [{ type: "output_text", text: "{}" }] }],
    output_parsed: parsed,
    usage,
  };
}

const DOC_TEXT = `DDT VENDITA 1A - 050472/VR del 06/08/2026
ZUIN S.p.A. - RIVOLI VERONESE
Destinatario: EMMECI GOMME di Nicetto Federico
STRADA CA' BALBI 1 - 36050 QUINTO VICENTINO VI
185/55R16 83V N FERA PRIMUS RBP  Q.ta 1
Pagamento: RIBA 30 gg FM
TOTALE IMPONIBILE 63,74`;

let extractTransportDocument: typeof import("@/lib/transport/providers/openai-extract").extractTransportDocument;
let criticalFieldCompleteness: typeof import("@/lib/transport/providers/openai-extract").criticalFieldCompleteness;

beforeEach(async () => {
  parseMock.mockReset();
  vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
  vi.stubEnv("OPENAI_TRANSPORT_MODEL", "test-primary");
  vi.stubEnv("OPENAI_TRANSPORT_ESCALATION_MODEL", "test-escalation");
  const mod = await import("@/lib/transport/providers/openai-extract");
  extractTransportDocument = mod.extractTransportDocument;
  criticalFieldCompleteness = mod.criticalFieldCompleteness;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractTransportDocument - happy path", () => {
  it("returns the parsed extraction from the primary model without escalating", async () => {
    parseMock.mockResolvedValueOnce(okResponse(validExtraction()));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-1" });

    expect(result.status).toBe("extracted");
    if (result.status !== "extracted") return;
    expect(result.usedEscalationModel).toBe(false);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].model).toBe("test-primary");
    expect(result.schemaVersion).toBe(EXTRACTION_SCHEMA_VERSION);
    expect(result.extraction.deliveries).toHaveLength(1);
    expect(parseMock).toHaveBeenCalledTimes(1);
  });

  it("records model, request id, token usage and latency", async () => {
    parseMock.mockResolvedValueOnce(okResponse(validExtraction()));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-2" });

    expect(result.attempts[0]).toMatchObject({
      model: "test-primary",
      requestId: "req_xyz789",
      responseId: "resp_abc123",
      inputTokens: 1200,
      outputTokens: 400,
      totalTokens: 1600,
      outcome: "parsed",
    });
    expect(result.attempts[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not ask the API to store the response", async () => {
    parseMock.mockResolvedValueOnce(okResponse(validExtraction()));
    await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-3" });

    expect(parseMock.mock.calls[0][0]).toMatchObject({ store: false });
  });
});

describe("extractTransportDocument - input limits", () => {
  it("refuses text that is too short without calling the API", async () => {
    const result = await extractTransportDocument({ documentText: "DDT", correlationId: "corr-4" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("INPUT_TOO_SHORT");
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("refuses oversized text without calling the API", async () => {
    const result = await extractTransportDocument({
      documentText: "x".repeat(200_001),
      correlationId: "corr-5",
    });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("INPUT_TOO_LARGE");
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("reports unconfigured when no key is set, without calling the API", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const mod = await import("@/lib/transport/providers/openai-extract");

    const result = await mod.extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-6" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("UNCONFIGURED");
    expect(parseMock).not.toHaveBeenCalled();
  });
});

describe("extractTransportDocument - escalation", () => {
  it("escalates once when the primary model refuses", async () => {
    parseMock
      .mockResolvedValueOnce({
        id: "resp_1",
        output: [{ content: [{ type: "refusal", refusal: "no" }] }],
        output_parsed: null,
        usage: null,
      })
      .mockResolvedValueOnce(okResponse(validExtraction()));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-7" });

    expect(result.status).toBe("extracted");
    expect(result.usedEscalationModel).toBe(true);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].outcome).toBe("MODEL_REFUSED");
    expect(result.attempts[1].model).toBe("test-escalation");
    expect(result.attempts[1].escalationReason).toBe("MODEL_REFUSED");
  });

  it("escalates when no parsed output comes back", async () => {
    parseMock
      .mockResolvedValueOnce(okResponse(null))
      .mockResolvedValueOnce(okResponse(validExtraction()));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-8" });

    expect(result.attempts[0].outcome).toBe("NO_PARSED_OUTPUT");
    expect(result.status).toBe("extracted");
  });

  it("escalates when the payload violates the schema", async () => {
    // A missing documentClassification -- the shape of a model that ignored
    // the schema despite strict mode.
    const broken = { ...validExtraction() } as Record<string, unknown>;
    delete broken.documentClassification;

    parseMock
      .mockResolvedValueOnce(okResponse(broken))
      .mockResolvedValueOnce(okResponse(validExtraction()));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-9" });

    expect(result.attempts[0].outcome).toBe("SCHEMA_VALIDATION_FAILED");
    expect(result.status).toBe("extracted");
    expect(result.usedEscalationModel).toBe(true);
  });

  it("escalates when critical fields come back too sparse", async () => {
    const sparse = validExtraction({
      distributor: { name: null, vatNumber: null, warehouseName: null, documentCustomerCode: null },
      deliveries: [
        {
          ...validExtraction().deliveries[0],
          deliveryDocumentNumber: null,
          recipient: {
            ...validExtraction().deliveries[0].recipient,
            companyName: null,
            addressLine: null,
            city: null,
          },
        },
      ],
    });

    parseMock
      .mockResolvedValueOnce(okResponse(sparse))
      .mockResolvedValueOnce(okResponse(validExtraction()));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-10" });

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].escalationReason).toMatch(/LOW_CRITICAL_FIELD_COMPLETENESS/);
    expect(result.status).toBe("extracted");
  });

  it("never escalates more than once", async () => {
    parseMock
      .mockResolvedValueOnce(okResponse(null))
      .mockResolvedValueOnce(okResponse(null));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-11" });

    expect(parseMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("NO_PARSED_OUTPUT");
  });

  it("keeps a sparse-but-valid escalation result rather than failing outright", async () => {
    // Genuinely below the 0.75 completeness threshold, so escalation fires --
    // dropping a single field scores 0.88 and correctly does not escalate.
    const sparse = validExtraction({
      distributor: { name: null, vatNumber: null, warehouseName: null, documentCustomerCode: null },
      deliveries: [
        {
          ...validExtraction().deliveries[0],
          deliveryDocumentNumber: null,
          recipient: {
            ...validExtraction().deliveries[0].recipient,
            companyName: null,
            addressLine: null,
            city: null,
          },
        },
      ],
    });

    parseMock.mockResolvedValueOnce(okResponse(sparse)).mockResolvedValueOnce(okResponse(sparse));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-12" });

    // A pre-filled review screen with gaps beats retyping the document; the
    // validator is what blocks anything genuinely unusable.
    expect(result.status).toBe("extracted");
    expect(result.usedEscalationModel).toBe(true);
  });
});

describe("extractTransportDocument - provider errors", () => {
  it("classifies a 429 as rate limited", async () => {
    parseMock.mockRejectedValue(new FakeAPIError(429));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-13" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("RATE_LIMITED");
  });

  it("classifies a 401 as a provider error without leaking the key", async () => {
    parseMock.mockRejectedValue(new FakeAPIError(401));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-14" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("PROVIDER_ERROR");
    expect(result.message).not.toContain("sk-test-key");
  });

  it("points at the model env var on a 404, the likeliest cause", async () => {
    parseMock.mockRejectedValue(new FakeAPIError(404));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-15" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).toContain("OPENAI_TRANSPORT_MODEL");
  });

  it("classifies a timeout", async () => {
    const abort = new Error("Request timed out");
    abort.name = "AbortError";
    parseMock.mockRejectedValue(abort);

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-16" });

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.code).toBe("TIMEOUT");
  });

  it("never includes the document text in a failure message", async () => {
    parseMock.mockRejectedValue(new FakeAPIError(500));

    const result = await extractTransportDocument({ documentText: DOC_TEXT, correlationId: "corr-17" });

    if (result.status !== "failed") return;
    expect(result.message).not.toContain("EMMECI");
    expect(result.message).not.toContain("050472");
  });
});

describe("criticalFieldCompleteness", () => {
  it("scores a complete extraction at 1", async () => {
    expect(criticalFieldCompleteness(validExtraction()).ratio).toBe(1);
  });

  it("names the fields that are missing", async () => {
    const result = criticalFieldCompleteness(
      validExtraction({ distributor: { name: null, vatNumber: null, warehouseName: null, documentCustomerCode: null } })
    );

    expect(result.missing).toContain("distributor.name");
    expect(result.ratio).toBeLessThan(1);
  });

  it("scores an empty deliveries array as incomplete", async () => {
    const result = criticalFieldCompleteness(validExtraction({ deliveries: [] }));
    expect(result.missing).toContain("deliveries");
    expect(result.ratio).toBeLessThan(ESCALATION_THRESHOLD_FOR_TEST);
  });
});

const ESCALATION_THRESHOLD_FOR_TEST = 0.75;
