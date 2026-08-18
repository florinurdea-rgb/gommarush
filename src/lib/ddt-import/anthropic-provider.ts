import "server-only";
import { logError, logEvent } from "@/lib/logger";
import { DDT_EXTRACTION_SYSTEM_PROMPT, DDT_USER_INSTRUCTION } from "@/lib/ddt-import/prompt";
import { coerceExtractionEnvelope } from "@/lib/ddt-import/coerce";
import type { ExtractionResult } from "@/lib/ddt-import/types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 170_000;

/** Sends the whole PDF as a native `document` content block — same technique as src/lib/documents/anthropic-analyzer.ts. */
export async function extractViaAnthropic(
  input: { bytes: Buffer; fileName: string; mimeType: string },
  apiKey: string
): Promise<ExtractionResult> {
  const isPdf = input.mimeType === "application/pdf" || input.fileName.toLowerCase().endsWith(".pdf");
  const imageMimeTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!isPdf && !imageMimeTypes.includes(input.mimeType)) {
    return {
      status: "failed",
      documents: [],
      pageCount: null,
      error: "UNSUPPORTED_FILE_TYPE",
      notes: ["Formatul fișierului nu este acceptat pentru analiză automată."],
    };
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const base64 = input.bytes.toString("base64");
  const contentBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: input.mimeType, data: base64 } };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: DDT_EXTRACTION_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [contentBlock, { type: "text", text: DDT_USER_INSTRUCTION(input.fileName) }],
          },
        ],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      logError("ddt_extraction_anthropic_http_error", new Error(`HTTP ${response.status}`), {
        status: response.status,
      });
      return {
        status: "failed",
        documents: [],
        pageCount: null,
        error: `HTTP_${response.status}: ${detail.slice(0, 200)}`,
        notes: ["Analiza automată a eșuat."],
      };
    }

    const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    if (!text.trim()) {
      return {
        status: "failed",
        documents: [],
        pageCount: null,
        error: "EMPTY_RESPONSE",
        notes: ["Analiza automată nu a returnat date."],
      };
    }

    const { documents, pageCount } = coerceExtractionEnvelope(text);
    logEvent("ddt_extraction_completed", { provider: "anthropic", documentCount: documents.length });

    return { status: "analysed", documents, pageCount, error: null, notes: [] };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logError("ddt_extraction_anthropic_failed", error, { aborted });
    return {
      status: "failed",
      documents: [],
      pageCount: null,
      error: error instanceof Error ? error.message : "UNKNOWN",
      notes: [aborted ? "Analiza a durat prea mult." : "Analiza automată a eșuat."],
    };
  } finally {
    clearTimeout(timeout);
  }
}
