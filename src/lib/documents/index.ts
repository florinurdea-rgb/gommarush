import "server-only";
import { AnthropicDocumentAnalyzer } from "@/lib/documents/anthropic-analyzer";
import { extractDocxText, extractPdfText } from "@/lib/documents/pdf-text";
import { parseInvoiceText } from "@/lib/documents/text-invoice-parser";
import { emptyResult } from "@/lib/documents/analyzer";
import { logEvent } from "@/lib/logger";
import type {
  AnalysisResult,
  AnalyzableDocument,
  DocumentAnalyzer,
} from "@/lib/documents/analyzer";

/**
 * The document analysis pipeline:
 *
 *   upload -> store original -> extract text (free, deterministic)
 *          -> if no usable text layer, hand the bytes to a vision provider
 *          -> if no provider configured, return "unconfigured"
 *
 * Text extraction runs first for text PDFs and DOCX because it costs nothing
 * and is deterministic. The AI provider is for scans and photos — and for text
 * documents whose layout defeated the deterministic parser.
 *
 * When nothing is configured and there is no text layer, this returns
 * `status: "unconfigured"` with zero extracted values. Nothing is ever invented:
 * the review screen shows "Analiza automată nu este configurată" and the Admin
 * completes the form by hand.
 */

/** The providers, in priority order. Add new ones here. */
function availableAnalyzers(): DocumentAnalyzer[] {
  return [new AnthropicDocumentAnalyzer()];
}

export function configuredAnalyzer(): DocumentAnalyzer | null {
  return availableAnalyzers().find((analyzer) => analyzer.isConfigured()) ?? null;
}

export function isAnalysisConfigured(): boolean {
  return configuredAnalyzer() !== null;
}

/** How many product lines make the deterministic parse worth keeping. */
const MIN_USEFUL_PRODUCT_LINES = 1;

export async function analyzeDocument(document: AnalyzableDocument): Promise<AnalysisResult> {
  const analyzer = configuredAnalyzer();

  // --- 1. Try a text layer first -----------------------------------------
  let textResult: AnalysisResult | null = null;

  if (document.mimeType === "application/pdf" || document.fileName.toLowerCase().endsWith(".pdf")) {
    const extracted = extractPdfText(document.bytes);
    if (extracted.usable) {
      textResult = parseInvoiceText(extracted.text, "pdf-text");
      logEvent("document_text_layer_used", {
        chars: extracted.text.length,
        products: textResult.products.length,
      });
    }
  } else if (
    document.mimeType.includes("wordprocessingml") ||
    document.fileName.toLowerCase().endsWith(".docx")
  ) {
    const extracted = extractDocxText(document.bytes);
    if (extracted.usable) {
      textResult = parseInvoiceText(extracted.text, "docx-text");
    }
  }

  // A clean text parse that actually found products is the cheapest good
  // answer, so prefer it over an AI call.
  if (textResult && textResult.products.length >= MIN_USEFUL_PRODUCT_LINES && !analyzer) {
    return textResult;
  }

  // --- 2. Hand it to the configured vision/OCR provider -------------------
  if (analyzer) {
    const aiResult = await analyzer.analyze(document);

    if (aiResult.status === "analysed") {
      // Keep the deterministic text around: it is useful evidence when the
      // Admin is checking a field the model got wrong.
      if (textResult?.extractedText) aiResult.extractedText = textResult.extractedText;
      return aiResult;
    }

    // The provider failed. A usable text parse is better than nothing.
    if (textResult) {
      return {
        ...textResult,
        notes: [
          ...textResult.notes,
          "L'analisi AI non è riuscita; i dati qui sotto provengono solo dal testo del documento. Controllali con attenzione.",
        ],
      };
    }
    return aiResult;
  }

  // --- 3. Nothing configured ---------------------------------------------
  if (textResult) {
    return {
      ...textResult,
      notes: [
        "L'analisi automatica (AI/OCR) non è configurata. I dati qui sotto sono stati letti direttamente dal testo del documento e vanno verificati.",
        ...textResult.notes,
      ],
    };
  }

  // No provider AND no readable text layer: say so, extract nothing.
  return emptyResult(
    "unconfigured",
    "none",
    [
      "L'analisi automatica non è configurata e il documento non contiene testo leggibile direttamente.",
      "Inserisci manualmente i dati dell'ordine qui sotto.",
    ]
  );
}

export type { AnalysisResult, AnalyzableDocument, DocumentAnalyzer };
