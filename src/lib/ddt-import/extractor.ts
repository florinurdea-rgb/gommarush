import "server-only";
import { extractViaAnthropic } from "@/lib/ddt-import/anthropic-provider";
import { extractViaOpenAI } from "@/lib/ddt-import/openai-provider";
import { extractViaTextLayer } from "@/lib/ddt-import/text-fallback";
import type { ExtractionResult } from "@/lib/ddt-import/types";

/**
 * Multi-document extraction for the DDT/invoice import pipeline —
 * provider-agnostic entry point. Tries, in order: Anthropic (if
 * ANTHROPIC_API_KEY is set), OpenAI (if OPENAI_API_KEY is set), then the
 * deterministic text-layer fallback (see text-fallback.ts) if neither is
 * configured. Both AI providers are asked for the exact same JSON shape
 * (src/lib/ddt-import/prompt.ts) and validated the same way afterward
 * (src/lib/ddt-import/coerce.ts) — the rest of the pipeline
 * (src/lib/ddt-import/pipeline.ts) never knows or cares which one answered.
 *
 * What no provider is trusted for (enforced downstream, not here): whether
 * a line is PFU/a fee vs. a real product, the final tyre count, duplicate
 * detection, or payment flags. Each only proposes raw text, a soft
 * item-type hint, and copies payment text verbatim — everything
 * safety-critical is decided by deterministic code afterward.
 */

export function isDdtExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

export async function extractDdtDocuments(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<ExtractionResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) return extractViaAnthropic(input, anthropicKey);

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) return extractViaOpenAI(input, openaiKey);

  // No AI configured: fall back to the existing deterministic text-layer
  // parser rather than just failing — "textul va fi citit direct din
  // fișier acolo unde este posibil." Multi-document splitting still needs
  // AI (there's no reliable way to find DDT boundaries from raw text
  // alone), so a text-only pass always yields at most one document.
  const fallback = await extractViaTextLayer(input);
  const UNCONFIGURED_NOTES = [
    "Analiza automată nu este configurată.",
    "Documentul va fi stocat, iar textul va fi citit direct din fișier acolo unde este posibil. Datele care nu pot fi citite trebuie completate manual — sistemul nu inventează valori.",
  ];

  if (!fallback.foundData || !fallback.document) {
    return {
      status: "unconfigured",
      documents: [],
      pageCount: null,
      error: "UNCONFIGURED",
      notes: UNCONFIGURED_NOTES,
    };
  }

  return {
    status: "analysed",
    documents: [fallback.document],
    pageCount: null,
    error: null,
    notes: [
      ...UNCONFIGURED_NOTES,
      "Un singur document a putut fi citit din text — detectarea automată a mai multor DDT-uri într-un fișier necesită AI configurat.",
    ],
  };
}
