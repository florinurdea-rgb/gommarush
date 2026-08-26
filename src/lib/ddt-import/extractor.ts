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
          ? ["L'analisi AI non ha risposto correttamente; il documento è stato recuperato dal livello testo del PDF."]
          : ["L'analisi automatica non è configurata; il documento è stato letto dal livello testo del file."]),
        "È stato possibile leggere un solo documento dal testo. La separazione automatica di più DDT in un unico PDF richiede un provider AI funzionante.",
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
        "L'analisi automatica non è configurata.",
        "Il documento è stato salvato ma non contiene testo sufficiente per l'estrazione automatica.",
        "Inserisci i dati manualmente — il sistema non inventa valori.",
      ],
    };
  }

  return {
    status: "failed",
    documents: [],
    pageCount: null,
    error: providerFailures.length ? providerFailures.join(" | ") : "ANALYSIS_FAILED",
    notes: [
      "Tutti i provider di analisi configurati hanno fallito e il documento non è stato recuperato dal livello testo.",
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
