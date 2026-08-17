import "server-only";
import { logError, logEvent } from "@/lib/logger";
import type { TyreLookupResult, TyreLookupSeason, TyreLookupSource } from "@/lib/tyre-lookup/types";

/**
 * Identifies a tyre from a scanned barcode via the Anthropic Messages API's
 * server-side web search tool — the model searches the live web and answers
 * in the same request/response, so this stays one `fetch` call, same
 * pattern as src/lib/documents/anthropic-analyzer.ts (called directly
 * rather than through the SDK to keep the serverless bundle small).
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_SEARCH_USES = 5;

/**
 * The honesty rules mirror the document analyzer's: "never invent" matters
 * even more here, because a fabricated brand/size would send an operator to
 * the wrong stand with the wrong tyre. The barcode-exactness rule exists
 * because two tyres one digit apart in EAN are different products, not a
 * fuzzy-match candidate.
 */
const SYSTEM_PROMPT = `You identify a tyre (car/truck tire) product from a barcode scanned off its manufacturer label, using web search.

The barcode may be an EAN-13, UPC, GTIN, or a manufacturer/article code. Search the web for it — try, in order:
1. "<barcode>"
2. "<barcode>" tyre
3. "<barcode>" tire
4. "<barcode>" pneumatico
Prefer manufacturer catalogs, major tyre distributors, specialist tyre retailers, and product databases over generic search-result pages.

CRITICAL RULES:
- Only report a match if a source shows this EXACT barcode string associated with the product. A barcode differing by even one digit is a DIFFERENT product — never fuzzy-match. "5452000742457" is not "5452000742458".
- NEVER invent brand, model, size, or any other field. If a field cannot be verified from a source, use null.
- If you find no source tying this exact barcode to a product, set status to "unknown" and leave every other field null.
- If sources disagree about which product this exact barcode belongs to, set status to "uncertain", report the best-supported values (or null where genuinely unclear), and say what disagreed in "notes".
- Only set status "identified" when this exact barcode is clearly and consistently tied to one specific product across what you found.

After searching, respond with ONLY a JSON object (no prose, no markdown fences) matching exactly:
{
  "status": "identified" | "uncertain" | "unknown",
  "brand": string|null,
  "model": string|null,
  "width": number|null,
  "aspectRatio": number|null,
  "rimDiameter": number|null,
  "loadIndex": string|null,
  "speedRating": string|null,
  "extraLoad": boolean|null,
  "runFlat": boolean|null,
  "season": "summer"|"winter"|"all-season"|null,
  "ean": string|null,
  "manufacturerCode": string|null,
  "notes": string[]
}`;

interface AnthropicCitation {
  type?: string;
  url?: string;
  title?: string;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  citations?: AnthropicCitation[];
}

function parseModelJson(text: string): unknown {
  const trimmed = text.trim();

  // The model may reason in prose before the final JSON (web search
  // responses often do) or wrap it in a fence — take the LAST such block,
  // since the JSON is instructed to be the final message.
  let lastFenced: string | null = null;
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  for (let match = fenced.exec(trimmed); match; match = fenced.exec(trimmed)) {
    lastFenced = match[1];
  }
  const candidate = lastFenced ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.lastIndexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Model response was not valid JSON");
  }
}

/**
 * Sources come from the API's own citation metadata, not from anything the
 * model self-reports in its JSON — a model can claim a source without one
 * existing, but it cannot forge a citation the search tool didn't actually
 * return.
 */
export function extractCitationSources(content: AnthropicContentBlock[]): TyreLookupSource[] {
  const seen = new Map<string, TyreLookupSource>();
  for (const block of content) {
    if (block.type !== "text" || !block.citations) continue;
    for (const citation of block.citations) {
      if (citation.type === "web_search_result_location" && citation.url && !seen.has(citation.url)) {
        seen.set(citation.url, { url: citation.url, title: citation.title || citation.url });
      }
    }
  }
  return [...seen.values()];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asSeason(value: unknown): TyreLookupSeason | null {
  return value === "summer" || value === "winter" || value === "all-season" ? value : null;
}

function emptyResult(status: TyreLookupResult["status"], barcode: string, notes: string[], error: string | null = null): TyreLookupResult {
  return {
    status,
    barcode,
    brand: null,
    model: null,
    width: null,
    aspectRatio: null,
    rimDiameter: null,
    loadIndex: null,
    speedRating: null,
    extraLoad: null,
    runFlat: null,
    season: null,
    ean: null,
    manufacturerCode: null,
    sources: [],
    notes,
    error,
    cached: false,
  };
}

/**
 * Coerces the model's JSON into a trustworthy result. Validated rather than
 * trusted, same principle as the document analyzer: a model claiming
 * "identified" is not enough on its own — see the zero-citations downgrade
 * below.
 */
export function coerceLookupResult(raw: unknown, barcode: string, sources: TyreLookupSource[]): TyreLookupResult {
  const root = (raw ?? {}) as Record<string, unknown>;
  const notes = asStringArray(root.notes);
  const claimedStatus = asString(root.status);

  let status: TyreLookupResult["status"] =
    claimedStatus === "identified" ? "identified" : claimedStatus === "uncertain" ? "uncertain" : "unknown";

  // A claimed match backed by zero verifiable sources is never trusted at
  // face value — downgraded to "uncertain" so a human checks it, not
  // discarded to "unknown" (the model did find *something*).
  if (status === "identified" && sources.length === 0) {
    status = "uncertain";
    notes.push("Nicio sursă verificabilă returnată — verifică manual.");
  }

  if (status === "unknown") {
    return emptyResult("unknown", barcode, notes);
  }

  return {
    status,
    barcode,
    brand: asString(root.brand),
    model: asString(root.model),
    width: asNumber(root.width),
    aspectRatio: asNumber(root.aspectRatio),
    rimDiameter: asNumber(root.rimDiameter),
    loadIndex: asString(root.loadIndex),
    speedRating: asString(root.speedRating),
    extraLoad: asBoolean(root.extraLoad),
    runFlat: asBoolean(root.runFlat),
    season: asSeason(root.season),
    ean: asString(root.ean),
    manufacturerCode: asString(root.manufacturerCode),
    sources,
    notes,
    error: null,
    cached: false,
  };
}

export class AnthropicTyreLookup {
  isConfigured(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  }

  async lookup(barcode: string): Promise<TyreLookupResult> {
    // Trimmed: a stray trailing space/newline pasted into Vercel's env var
    // UI would otherwise make every request fail at the network layer
    // instead of just being "missing" — see src/lib/supabase/config.ts.
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      return emptyResult("unconfigured", barcode, ["Căutarea automată nu este configurată."], "UNCONFIGURED");
    }

    const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
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
          max_tokens: 2000,
          system: SYSTEM_PROMPT,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCH_USES }],
          messages: [{ role: "user", content: `Identify the tyre for this barcode: ${barcode}` }],
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        logError("tyre_lookup_http_error", new Error(`HTTP ${response.status}`), { status: response.status });
        return emptyResult(
          "failed",
          barcode,
          ["Căutarea a eșuat. Încearcă din nou."],
          `HTTP_${response.status}: ${detail.slice(0, 200)}`
        );
      }

      const payload = (await response.json()) as { content?: AnthropicContentBlock[] };
      const content = payload.content ?? [];
      const text = content
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("\n");

      if (!text.trim()) {
        return emptyResult("failed", barcode, ["Căutarea nu a returnat niciun rezultat."], "EMPTY_RESPONSE");
      }

      const sources = extractCitationSources(content);
      const result = coerceLookupResult(parseModelJson(text), barcode, sources);
      logEvent("tyre_lookup_completed", { status: result.status, source_count: sources.length });
      return result;
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      logError("tyre_lookup_request_failed", error, { aborted });
      return emptyResult(
        "failed",
        barcode,
        [aborted ? "Căutarea a durat prea mult. Încearcă din nou." : "Căutarea a eșuat. Încearcă din nou."],
        error instanceof Error ? error.message : "UNKNOWN"
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
