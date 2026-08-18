import "server-only";
import { extractViaAnthropic } from "@/lib/ddt-import/anthropic-provider";
import { extractViaOpenAI } from "@/lib/ddt-import/openai-provider";
import { extractViaTextLayer } from "@/lib/ddt-import/text-fallback";
import type { ExtractionResult } from "@/lib/ddt-import/types";

/**
 * Multi-document extraction for the DDT/invoice import pipeline.
 *
 * Important reliability rule: one configured AI provider failing must never
 * make the whole import fail if another provider (or the deterministic text
 * layer) can still read the document. Providers are attempted in order and a
 * successful result returns immediately.
 */

export function isDdtExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

async function textFallback(
  input: { bytes: Buffer; fileName: string; mimeType: string },
  providerFailures: string[],
  aiWasConfigured: boolean
): Promise<ExtractionResult> {
  const fallback = await extractViaTextLayer(input);

  if (fallback.foundData && fallback.document) {
    return {
      status: "analysed",
      documents: [fallback.document],
      pageCount: null,
      error: null,
      notes: [
        ...(providerFailures.length
          ? ["Analiza AI nu a răspuns corect; documentul a fost recuperat din stratul text al PDF-ului."]
          : ["Analiza automată nu este configurată; documentul a fost citit din stratul text al fișierului."]),
        "Un singur document a putut fi citit din text. Separarea automată a mai multor DDT-uri într-un singur PDF necesită un provider AI funcțional.",
      ],
    };
  }

  if (!aiWasConfigured) {
    return {
      status: "unconfigured",
      documents: [],
      pageCount: null,
      error: "UNCONFIGURED",
      notes: [
        "Analiza automată nu este configurată.",
        "Documentul a fost stocat, dar nu conține un strat text suficient pentru extracție automată.",
      ],
    };
  }

  return {
    status: "failed",
    documents: [],
    pageCount: null,
    error: providerFailures.length ? providerFailures.join(" | ") : "ANALYSIS_FAILED",
    notes: [
      "Toți providerii de analiză configurați au eșuat, iar documentul nu a putut fi recuperat din stratul text.",
    ],
  };
}

export async function extractDdtDocuments(input: {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<ExtractionResult> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const providerFailures: string[] = [];

  if (anthropicKey) {
    const anthropic = await extractViaAnthropic(input, anthropicKey);
    if (anthropic.status === "analysed") return anthropic;
    providerFailures.push(`Anthropic: ${anthropic.error ?? "FAILED"}`);
  }

  if (openaiKey) {
    const openai = await extractViaOpenAI(input, openaiKey);
    if (openai.status === "analysed") return openai;
    providerFailures.push(`OpenAI: ${openai.error ?? "FAILED"}`);
  }

  return textFallback(input, providerFailures, Boolean(anthropicKey || openaiKey));
}
