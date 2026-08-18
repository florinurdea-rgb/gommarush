import "server-only";
import { logError, logEvent } from "@/lib/logger";
import { DDT_EXTRACTION_SYSTEM_PROMPT, DDT_USER_INSTRUCTION } from "@/lib/ddt-import/prompt";
import { coerceExtractionEnvelope } from "@/lib/ddt-import/coerce";
import type { ExtractionResult } from "@/lib/ddt-import/types";

/**
 * OpenAI Responses API extraction for PDFs/images.
 *
 * Keep the request comfortably below the Vercel function timeout so the
 * caller still has time to surface a useful error/fallback. `input_file`
 * receives raw base64 file data; image inputs continue to use a data URL.
 */
const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1";
const REQUEST_TIMEOUT_MS = 60_000;

interface OpenAIResponsePayload {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
}

function extractOutputText(payload: OpenAIResponsePayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;

  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .filter((block) => block.type === "output_text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("");
}

export async function extractViaOpenAI(
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

  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const base64 = input.bytes.toString("base64");
  const fileContent = isPdf
    ? { type: "input_file", filename: input.fileName, file_data: base64 }
    : { type: "input_image", image_url: `data:${input.mimeType};base64,${base64}` };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        instructions: DDT_EXTRACTION_SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [fileContent, { type: "input_text", text: DDT_USER_INSTRUCTION(input.fileName) }],
          },
        ],
        text: { format: { type: "json_object" } },
        max_output_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      logError("ddt_extraction_openai_http_error", new Error(`HTTP ${response.status}`), {
        status: response.status,
        model,
      });
      return {
        status: "failed",
        documents: [],
        pageCount: null,
        error: `OPENAI_HTTP_${response.status}: ${detail.slice(0, 800)}`,
        notes: ["Analiza OpenAI a eșuat."],
      };
    }

    const payload = (await response.json()) as OpenAIResponsePayload;
    const text = extractOutputText(payload);

    if (!text.trim()) {
      return {
        status: "failed",
        documents: [],
        pageCount: null,
        error: "OPENAI_EMPTY_RESPONSE",
        notes: ["OpenAI nu a returnat date."],
      };
    }

    const { documents, pageCount } = coerceExtractionEnvelope(text);
    if (documents.length === 0) {
      return {
        status: "failed",
        documents: [],
        pageCount,
        error: "OPENAI_NO_DOCUMENTS",
        notes: ["OpenAI a răspuns, dar nu a fost detectat niciun document utilizabil."],
      };
    }

    logEvent("ddt_extraction_completed", { provider: "openai", model, documentCount: documents.length });
    return { status: "analysed", documents, pageCount, error: null, notes: [] };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logError("ddt_extraction_openai_failed", error, { aborted, model });
    return {
      status: "failed",
      documents: [],
      pageCount: null,
      error: aborted ? "OPENAI_TIMEOUT" : `OPENAI_ERROR: ${error instanceof Error ? error.message : "UNKNOWN"}`,
      notes: [aborted ? "Analiza OpenAI a depășit timpul disponibil." : "Analiza OpenAI a eșuat."],
    };
  } finally {
    clearTimeout(timeout);
  }
}
