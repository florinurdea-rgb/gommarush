import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const originalApiKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe("extractDdtDocuments — unconfigured is disclosed, never a technical failure", () => {
  it("returns status 'unconfigured' with the exact disclosure text when there's no readable text layer either", async () => {
    const { extractDdtDocuments } = await import("@/lib/ddt-import/extractor");

    const result = await extractDdtDocuments({
      bytes: Buffer.from("not a real pdf"),
      fileName: "test.pdf",
      mimeType: "application/pdf",
    });

    expect(result.status).toBe("unconfigured");
    expect(result.documents).toEqual([]);
    expect(result.notes).toContain("Analiza automată nu este configurată.");
    expect(result.notes.join(" ")).toContain("sistemul nu inventează valori");
  });

  it("is configured as false when the API key is absent", async () => {
    const { isDdtExtractionConfigured } = await import("@/lib/ddt-import/extractor");
    expect(isDdtExtractionConfigured()).toBe(false);
  });
});
