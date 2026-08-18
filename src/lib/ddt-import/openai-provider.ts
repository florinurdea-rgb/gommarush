import "server-only";
import { logError, logEvent } from "@/lib/logger";
import { DDT_EXTRACTION_SYSTEM_PROMPT, DDT_USER_INSTRUCTION } from "@/lib/ddt-import/prompt";
import { coerceExtractionEnvelope } from "@/lib/ddt-import/coerce";
import type { ExtractionResult } from "@/lib/ddt-import/types";

/**
 * Uses OpenAI's Responses API, which — like Anthropic's `document` content
 * block — accepts a PDF directly (`input_file` with a base64 data URI), so
 * this doesn't need to rasterize pages into images itself. `text.format:
 * json_object` guarantees syntactically valid JSON; the exact shape still
 * comes from the shared prompt (src/lib/ddt-import/prompt.ts) and is
 * validated afterward by coerceExtractionEnvelope — same trust boundary as
 * the Anthropic provider, same downstream pipeline either way.
 */

const API_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1";
const REQUEST_TIMEOUT_MS = 170_000;

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
  const dataUri = `data:${isPdf ? "application/pdf" : input.mimeType};base64,${base64}`;
  const fileContent = isPdf
    ? { type: "input_file", filename: input.fileName, file_data: dataUri }
    : { type: "input_image", image_url: dataUri };

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
      });
      return {
        status: "failed",
        documents: [],
        pageCount: null,
        error: `HTTP_${response.status}: ${detail.slice(0, 200)}`,
        notes: ["Analiza automată a eșuat."],
      };
    }

    const payload = (await response.json()) as OpenAIResponsePayload;
    const text = extractOutputText(payload);

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
    logEvent("ddt_extraction_completed", { provider: "openai", documentCount: documents.length });

    return { status: "analysed", documents, pageCount, error: null, notes: [] };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logError("ddt_extraction_openai_failed", error, { aborted });
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
