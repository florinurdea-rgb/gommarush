import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalOpenaiKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterEach(() => {
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;

  if (originalOpenaiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenaiKey;
});

describe("extractDdtDocuments — unconfigured is disclosed, never a technical failure", () => {
  it("returns status 'unconfigured' with the exact disclosure text when neither provider key is set and there's no readable text layer", async () => {
    const { extractDdtDocuments } = await import("@/lib/ddt-import/extractor");

    const result = await extractDdtDocuments({
      bytes: Buffer.from("not a real pdf"),
      fileName: "test.pdf",
      mimeType: "application/pdf",
    });

    expect(result.status).toBe("unconfigured");
    expect(result.documents).toEqual([]);
    expect(result.notes).toContain("L'analisi automatica non è configurata.");
    expect(result.notes.join(" ")).toContain("il sistema non inventa valori");
  });

  it("is configured as false when neither API key is present", async () => {
    const { isDdtExtractionConfigured } = await import("@/lib/ddt-import/extractor");
    expect(isDdtExtractionConfigured()).toBe(false);
  });

  it("is configured as true when only OPENAI_API_KEY is present", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    const { isDdtExtractionConfigured } = await import("@/lib/ddt-import/extractor");
    expect(isDdtExtractionConfigured()).toBe(true);
  });
});
