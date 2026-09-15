import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { logError, logEvent } from "@/lib/logger";
import {
  EXTRACTION_FORMAT_NAME,
  EXTRACTION_SCHEMA_VERSION,
  TransportDocumentExtractionSchema,
  type TransportDocumentExtraction,
} from "@/lib/transport/extraction-schema";
import { PROMPT_VERSION, TRANSPORT_EXTRACTION_SYSTEM_PROMPT, buildUserInstruction } from "@/lib/transport/prompt";

/**
 * Transport-document extraction via the OpenAI Responses API.
 *
 * `import "server-only"` is the first line for a reason: importing this from a
 * client component becomes a build error, which is a stronger guarantee than
 * remembering not to. The API key is read here and never returned, logged or
 * included in an error.
 *
 * Free-form JSON parsing is not available in this path. Every call goes
 * through strict Structured Outputs via `responses.parse()`, so a response
 * that does not match the schema arrives as a refusal or a parse failure
 * rather than as plausible-looking wrong data.
 */

/**
 * Model ids come from the environment with these as defaults.
 *
 * They are configurable deliberately: they were supplied to this project
 * without being verifiable against OpenAI's own documentation (which is
 * unreachable from the build environment), so if the API rejects one it is a
 * Vercel configuration change rather than a code change and a redeploy.
 */
const DEFAULT_PRIMARY_MODEL = "gpt-5.6-luna";
const DEFAULT_ESCALATION_MODEL = "gpt-5.6-terra";

/** Below the route's own budget, so a timeout here still leaves time to respond. */
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * Pasted text longer than this is refused before a request is made. A DDT
 * page is a few thousand characters; 200k is dozens of pages and far more
 * likely to be a mis-paste than a real consignment, and refusing costs
 * nothing while a runaway request costs tokens.
 */
export const MAX_INPUT_CHARS = 200_000;

/** Shorter than this cannot be a transport document. */
export const MIN_INPUT_CHARS = 40;

export type ExtractionFailureCode =
  | "UNCONFIGURED"
  | "INPUT_TOO_SHORT"
  | "INPUT_TOO_LARGE"
  | "MODEL_REFUSED"
  | "NO_PARSED_OUTPUT"
  | "SCHEMA_VALIDATION_FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR";

export interface ExtractionAttemptTelemetry {
  model: string;
  /** OpenAI's request id, for support tickets. */
  requestId: string | null;
  responseId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  outcome: "parsed" | ExtractionFailureCode;
  /** Why this attempt happened: the first pass, or what triggered escalation. */
  escalationReason: string | null;
}

export interface ExtractionSuccess {
  status: "extracted";
  extraction: TransportDocumentExtraction;
  schemaVersion: string;
  promptVersion: string;
  /** One entry per attempt, oldest first. Length > 1 means escalation ran. */
  attempts: ExtractionAttemptTelemetry[];
  usedEscalationModel: boolean;
}

export interface ExtractionFailure {
  status: "failed";
  code: ExtractionFailureCode;
  /** Operator-facing. Never contains the document text, the key, or a raw provider body. */
  message: string;
  attempts: ExtractionAttemptTelemetry[];
  usedEscalationModel: boolean;
}

export type ExtractionOutcome = ExtractionSuccess | ExtractionFailure;

export function isTransportExtractionConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function primaryModel(): string {
  return process.env.OPENAI_TRANSPORT_MODEL?.trim() || DEFAULT_PRIMARY_MODEL;
}

export function escalationModel(): string {
  return process.env.OPENAI_TRANSPORT_ESCALATION_MODEL?.trim() || DEFAULT_ESCALATION_MODEL;
}

/**
 * Critical-field completeness, used as the escalation trigger.
 *
 * The brief asks to escalate when "critical fields are below the confidence
 * threshold". This schema deliberately carries no per-field confidence --
 * partly because the same brief forbids deriving correctness from confidence
 * scores, and partly because a model's self-reported confidence is not
 * evidence. So the trigger is the observable equivalent: how many fields that
 * an operator cannot proceed without actually came back populated.
 *
 * A cheap model that returns nulls for the recipient and the address has
 * failed at the task whatever it claims about its own certainty, and that is
 * exactly when a stronger model is worth paying for.
 */
export function criticalFieldCompleteness(extraction: TransportDocumentExtraction): {
  ratio: number;
  populated: number;
  total: number;
  missing: string[];
} {
  const missing: string[] = [];
  let populated = 0;
  let total = 0;

  const check = (name: string, ok: boolean) => {
    total += 1;
    if (ok) populated += 1;
    else missing.push(name);
  };

  check("distributor.name", Boolean(extraction.distributor.name?.trim()));
  check("documentClassification.documentNumber", Boolean(extraction.documentClassification.documentNumber?.trim()));
  check("deliveries", extraction.deliveries.length > 0);

  for (const [index, delivery] of extraction.deliveries.entries()) {
    check(`deliveries.${index}.recipient.companyName`, Boolean(delivery.recipient.companyName?.trim()));
    check(`deliveries.${index}.recipient.addressLine`, Boolean(delivery.recipient.addressLine?.trim()));
    check(`deliveries.${index}.recipient.city`, Boolean(delivery.recipient.city?.trim()));
    check(`deliveries.${index}.deliveryDocumentNumber`, Boolean(delivery.deliveryDocumentNumber?.trim()));
    check(
      `deliveries.${index}.quantity`,
      delivery.items.some((item) => item.quantity !== null && item.quantity > 0) ||
        (delivery.totalTyres !== null && delivery.totalTyres > 0)
    );
  }

  return { ratio: total === 0 ? 0 : populated / total, populated, total, missing };
}

/** Escalate when fewer than this fraction of critical fields came back populated. */
export const ESCALATION_COMPLETENESS_THRESHOLD = 0.75;

function classifyProviderError(error: unknown): { code: ExtractionFailureCode; message: string } {
  if (error instanceof OpenAI.APIError) {
    if (error.status === 429) {
      return { code: "RATE_LIMITED", message: "Limite di richieste OpenAI raggiunto: riprovare tra poco." };
    }
    if (error.status === 401 || error.status === 403) {
      return { code: "PROVIDER_ERROR", message: "Credenziali OpenAI non valide o non autorizzate." };
    }
    if (error.status === 404) {
      // The likeliest cause given the model ids were not verifiable.
      return {
        code: "PROVIDER_ERROR",
        message: "Modello OpenAI non trovato: verificare OPENAI_TRANSPORT_MODEL in Vercel.",
      };
    }
    return { code: "PROVIDER_ERROR", message: `Errore OpenAI (HTTP ${error.status ?? "?"}).` };
  }

  if (error instanceof Error && (error.name === "AbortError" || /timeout/i.test(error.message))) {
    return { code: "TIMEOUT", message: "L'analisi ha superato il tempo massimo: riprovare." };
  }

  return { code: "PROVIDER_ERROR", message: "Errore imprevisto durante l'analisi del documento." };
}

interface AttemptResult {
  telemetry: ExtractionAttemptTelemetry;
  extraction: TransportDocumentExtraction | null;
  failure: { code: ExtractionFailureCode; message: string } | null;
}

async function runAttempt(input: {
  client: OpenAI;
  model: string;
  documentText: string;
  correlationId: string;
  escalationReason: string | null;
}): Promise<AttemptResult> {
  const { client, model, documentText, correlationId, escalationReason } = input;
  const startedAt = Date.now();

  const base = {
    model,
    requestId: null as string | null,
    responseId: null as string | null,
    inputTokens: null as number | null,
    outputTokens: null as number | null,
    totalTokens: null as number | null,
    escalationReason,
  };

  try {
    const response = await client.responses.parse(
      {
        model,
        input: [
          { role: "system", content: TRANSPORT_EXTRACTION_SYSTEM_PROMPT },
          { role: "user", content: buildUserInstruction(documentText) },
        ],
        text: {
          format: zodTextFormat(TransportDocumentExtractionSchema, EXTRACTION_FORMAT_NAME),
        },
        // Reasoning summaries are not requested and not retained: the brief
        // forbids storing hidden reasoning, and we have no use for it.
        store: false,
      },
      { timeout: REQUEST_TIMEOUT_MS }
    );

    const telemetryBase = {
      ...base,
      responseId: response.id ?? null,
      requestId: (response as { _request_id?: string | null })._request_id ?? null,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
      latencyMs: Date.now() - startedAt,
    };

    // A refusal is a first-class outcome, not an exception.
    //
    // Walked through an unknown-typed view on purpose: the SDK's parsed
    // content union is not flat-mappable without a cast, and a structural
    // check is both simpler and resilient to the union gaining members.
    const hasRefusal = ((response.output ?? []) as unknown[]).some((item) => {
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return false;
      return content.some((part) => (part as { type?: unknown } | null)?.type === "refusal");
    });

    if (hasRefusal) {
      return {
        telemetry: { ...telemetryBase, outcome: "MODEL_REFUSED" },
        extraction: null,
        failure: {
          code: "MODEL_REFUSED",
          message: "Il modello ha rifiutato di analizzare il documento.",
        },
      };
    }

    const parsed = response.output_parsed;
    if (!parsed) {
      return {
        telemetry: { ...telemetryBase, outcome: "NO_PARSED_OUTPUT" },
        extraction: null,
        failure: { code: "NO_PARSED_OUTPUT", message: "Il modello non ha restituito dati strutturati." },
      };
    }

    // The SDK already validated against the schema, but re-parsing costs
    // microseconds and means nothing downstream has to trust that it did.
    const revalidated = TransportDocumentExtractionSchema.safeParse(parsed);
    if (!revalidated.success) {
      return {
        telemetry: { ...telemetryBase, outcome: "SCHEMA_VALIDATION_FAILED" },
        extraction: null,
        failure: {
          code: "SCHEMA_VALIDATION_FAILED",
          message: "I dati restituiti non rispettano lo schema previsto.",
        },
      };
    }

    return {
      telemetry: { ...telemetryBase, outcome: "parsed" },
      extraction: revalidated.data,
      failure: null,
    };
  } catch (error) {
    const classified = classifyProviderError(error);
    // Note what is NOT logged: the document text, the API key, the raw
    // response body. Only the shape of the failure.
    logError("transport_extraction_attempt_failed", error, {
      model,
      correlationId,
      code: classified.code,
    });
    return {
      telemetry: { ...base, latencyMs: Date.now() - startedAt, outcome: classified.code },
      extraction: null,
      failure: classified,
    };
  }
}

/**
 * Extracts transport information from pasted document text.
 *
 * One escalation at most. The cheap model runs first; the stronger one runs
 * only when the first refused, returned nothing parseable, violated the
 * schema, or came back too sparse to act on. Two attempts is the ceiling --
 * a third would cost more than an operator typing the fields themselves.
 */
export async function extractTransportDocument(input: {
  documentText: string;
  correlationId: string;
}): Promise<ExtractionOutcome> {
  const { documentText, correlationId } = input;
  const attempts: ExtractionAttemptTelemetry[] = [];

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "failed",
      code: "UNCONFIGURED",
      message: "L'analisi automatica non e' configurata.",
      attempts,
      usedEscalationModel: false,
    };
  }

  const trimmed = documentText.trim();
  if (trimmed.length < MIN_INPUT_CHARS) {
    return {
      status: "failed",
      code: "INPUT_TOO_SHORT",
      message: "Il testo incollato e' troppo breve per essere un documento di trasporto.",
      attempts,
      usedEscalationModel: false,
    };
  }
  if (trimmed.length > MAX_INPUT_CHARS) {
    return {
      status: "failed",
      code: "INPUT_TOO_LARGE",
      message: `Il testo incollato supera il limite di ${MAX_INPUT_CHARS.toLocaleString("it-IT")} caratteri.`,
      attempts,
      usedEscalationModel: false,
    };
  }

  const client = new OpenAI({ apiKey, maxRetries: 1 });

  const first = await runAttempt({
    client,
    model: primaryModel(),
    documentText: trimmed,
    correlationId,
    escalationReason: null,
  });
  attempts.push(first.telemetry);

  let escalationReason: string | null = first.failure ? first.failure.code : null;

  if (first.extraction && !first.failure) {
    const completeness = criticalFieldCompleteness(first.extraction);
    if (completeness.ratio < ESCALATION_COMPLETENESS_THRESHOLD) {
      escalationReason = `LOW_CRITICAL_FIELD_COMPLETENESS(${completeness.populated}/${completeness.total})`;
    } else {
      logEvent("transport_extraction_completed", {
        correlationId,
        model: first.telemetry.model,
        deliveries: first.extraction.deliveries.length,
        completeness: Number(completeness.ratio.toFixed(2)),
        escalated: false,
        inputTokens: first.telemetry.inputTokens,
        outputTokens: first.telemetry.outputTokens,
      });
      return {
        status: "extracted",
        extraction: first.extraction,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        promptVersion: PROMPT_VERSION,
        attempts,
        usedEscalationModel: false,
      };
    }
  }

  // Escalate once.
  const second = await runAttempt({
    client,
    model: escalationModel(),
    documentText: trimmed,
    correlationId,
    escalationReason,
  });
  attempts.push(second.telemetry);

  if (second.extraction && !second.failure) {
    const completeness = criticalFieldCompleteness(second.extraction);
    logEvent("transport_extraction_completed", {
      correlationId,
      model: second.telemetry.model,
      deliveries: second.extraction.deliveries.length,
      completeness: Number(completeness.ratio.toFixed(2)),
      escalated: true,
      escalationReason,
      inputTokens: second.telemetry.inputTokens,
      outputTokens: second.telemetry.outputTokens,
    });
    return {
      status: "extracted",
      extraction: second.extraction,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      attempts,
      usedEscalationModel: true,
    };
  }

  // If the escalation attempt also produced a sparse-but-valid extraction we
  // return it rather than failing: an operator correcting four fields on a
  // pre-filled review screen is still faster than typing the whole document,
  // and the validator will block anything genuinely unusable.
  if (second.extraction) {
    return {
      status: "extracted",
      extraction: second.extraction,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      attempts,
      usedEscalationModel: true,
    };
  }
  if (first.extraction) {
    return {
      status: "extracted",
      extraction: first.extraction,
      schemaVersion: EXTRACTION_SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      attempts,
      usedEscalationModel: true,
    };
  }

  const failure = second.failure ?? first.failure ?? {
    code: "PROVIDER_ERROR" as ExtractionFailureCode,
    message: "Analisi non riuscita.",
  };

  logError("transport_extraction_failed", new Error(failure.code), {
    correlationId,
    code: failure.code,
    attempts: attempts.length,
  });

  return {
    status: "failed",
    code: failure.code,
    message: failure.message,
    attempts,
    usedEscalationModel: true,
  };
}
