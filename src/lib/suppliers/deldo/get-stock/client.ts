// Deldo GET_STOCK — the final availability AND price verification.
//
// Documented in the Deldo API PDF:
//
//   METHOD: GET
//   URL (test): https://api-test.deldo.be/gaston/dotcube_cgi
//               ?token=TOKEN&request=GET_STOCK&article=ProductID
//
//   success response   {"success":"1","product-id":"BS7623",
//                       "amount":"50","price":"85.50"}
//   unknown article    {"success":"0","error-message":"Unknown article"}
//
// This is NOT merely a stock check. The response carries `price` as well as
// `amount`, so it is the supplier's final word on both, and the order flow
// will eventually use it to detect that stock changed, the price changed, or
// the product vanished between the hourly feed and the moment of commitment.
// Modelling it as a boolean "in stock?" would throw away the price and make
// that check impossible to add later.
//
// Reads only. There is no code path from this file to CREATE_ORDER.

import "server-only";

import {
  resolveDeldoConfig,
  type ResolvedDeldoConfig,
} from "@/lib/suppliers/deldo/get-stock/config";
import { DeldoApiError, redactToken } from "@/lib/suppliers/deldo/get-stock/errors";
import { DELDO_LANE_CODE } from "@/lib/suppliers/deldo/capabilities";
import type { SupplierObservation } from "@/lib/suppliers/observation";

/**
 * How the article is identified.
 *
 * ⚠ DOCUMENTATION CONFLICT, recorded rather than resolved. The PDF's "URL
 * Parameters" section lists `productId=[integer|string] OR ean=[string]`, but
 * BOTH worked examples — the success case and the unknown-article case — use
 * `article=`. The prose likewise says "The request parameter can be 'Deldo
 * product id' or 'EAN'".
 *
 * `article=` is used here because it is the only form the documentation
 * actually demonstrates against a live endpoint. This must be confirmed with
 * Deldo before the first live call; see handoff risk R10.
 */
export const DELDO_ARTICLE_PARAM = "article";
export const DELDO_REQUEST_PARAM = "request";
export const DELDO_GET_STOCK_REQUEST = "GET_STOCK";

export type DeldoStockOutcome =
  | {
      readonly status: "available";
      readonly productId: string;
      readonly amount: number;
      readonly price: number;
      /**
       * The same answer as a normalized observation, ready to be classified
       * for freshness and to be compared against the feed.
       */
      readonly observation: SupplierObservation;
    }
  /** A normal commercial answer: Deldo does not carry this article. */
  | { readonly status: "unknown_article"; readonly message: string }
  /** success=0 with a message that is not the documented unknown-article one. */
  | { readonly status: "supplier_error"; readonly message: string };

export interface DeldoStockResult {
  readonly outcome: DeldoStockOutcome;
  readonly httpStatus: number;
  readonly durationMs: number;
  /** The request URL with the token redacted. Safe to log. */
  readonly safeUrl: string;
}

export interface DeldoClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly now?: () => Date;
}

/** Builds the GET_STOCK URL. The token is a query parameter, per the PDF. */
export function buildGetStockUrl(
  config: ResolvedDeldoConfig,
  article: string
): string {
  const url = new URL(config.baseUrl);
  url.searchParams.set("token", config.token);
  url.searchParams.set(DELDO_REQUEST_PARAM, DELDO_GET_STOCK_REQUEST);
  url.searchParams.set(DELDO_ARTICLE_PARAM, article);
  return url.toString();
}

/**
 * Parses the documented numeric strings.
 *
 * Every value in the response is a JSON string — "amount":"50", not 50 — so
 * each needs an explicit, strict conversion. Strict because a silently
 * coerced price is the failure this whole integration is built to avoid:
 * Number("") is 0, and a free tyre is not an acceptable rounding of a missing
 * field.
 */
function strictNumber(value: unknown, field: string): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DeldoApiError(
      "parse",
      `Deldo GET_STOCK response field '${field}' is missing or not a string`
    );
  }
  if (!/^\d+(\.\d+)?$/.test(value.trim())) {
    throw new DeldoApiError(
      "parse",
      `Deldo GET_STOCK response field '${field}' is not a non-negative number`
    );
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    throw new DeldoApiError("parse", `Deldo GET_STOCK '${field}' is not finite`);
  }
  return parsed;
}

/** The documented unknown-article message, compared case-insensitively. */
const UNKNOWN_ARTICLE_MESSAGE = "unknown article";

/**
 * A cap on the response we will read.
 *
 * The documented body is four short fields. Anything approaching this is not
 * a GET_STOCK response, and reading an unbounded stream into memory because a
 * proxy returned something unexpected is an avoidable failure mode.
 */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Turns a parsed JSON body into a typed outcome.
 *
 * Anything that is not recognisably one of the two documented shapes throws
 * rather than being treated as "not available". A malformed response must fail
 * closed: silently reporting zero stock would look like a normal out-of-stock
 * answer while actually meaning the integration is broken.
 */
export function parseGetStockBody(
  body: unknown,
  config: ResolvedDeldoConfig,
  observedAt: Date
): DeldoStockOutcome {
  if (typeof body !== "object" || body === null) {
    throw new DeldoApiError("parse", "Deldo GET_STOCK response is not a JSON object");
  }

  const record = body as Record<string, unknown>;
  const success = record.success;

  if (success !== "1" && success !== "0") {
    throw new DeldoApiError(
      "parse",
      `Deldo GET_STOCK response has an unrecognised 'success' value — expected "1" or "0"`
    );
  }

  if (success === "0") {
    const message =
      typeof record["error-message"] === "string" ? record["error-message"] : "";
    if (message.trim().toLowerCase() === UNKNOWN_ARTICLE_MESSAGE) {
      return { status: "unknown_article", message };
    }
    return {
      status: "supplier_error",
      message: message.trim() === "" ? "Deldo returned success=0 without a message" : message,
    };
  }

  const productId = record["product-id"];
  if (typeof productId !== "string" || productId.trim() === "") {
    throw new DeldoApiError("parse", "Deldo GET_STOCK success response has no 'product-id'");
  }

  const amount = strictNumber(record.amount, "amount");
  const price = strictNumber(record.price, "price");

  return {
    status: "available",
    productId: productId.trim(),
    amount,
    price,
    observation: {
      laneCode: DELDO_LANE_CODE,
      // Inherited from the environment, never chosen by the caller: the test
      // endpoint serves fictional data, so its answers are test data however
      // real they look.
      classification: config.classification,
      source: "live_lookup",
      observedAt,
      purchasePrice: price,
      // GET_STOCK returns no currency, and neither does the feed. Left null
      // rather than assumed to be EUR — see handoff decision D8.
      currency: null,
      stockExact: amount,
      stockRaw: String(amount),
      // A live lookup says nothing about whether transport is included in the
      // price; that is a property of the commercial agreement, not the call.
      commercialMode: "unknown",
    },
  };
}

/**
 * Calls Deldo GET_STOCK for one article.
 *
 * Not retried. A repeated read is harmless in principle, but this call sits
 * immediately before an order in Deldo's recommended flow, and a caller that
 * quietly retried a timeout would be making its "is it still there?" answer
 * older than it appears. The caller decides.
 */
export async function getDeldoStock(
  article: string,
  deps: DeldoClientDeps = {}
): Promise<DeldoStockResult> {
  const trimmedArticle = article.trim();
  if (trimmedArticle === "") {
    throw new DeldoApiError("configuration", "Deldo GET_STOCK requires an article identifier");
  }

  const config = resolveDeldoConfig();
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());

  const url = buildGetStockUrl(config, trimmedArticle);
  const safeUrl = redactToken(url, config.token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
      // Redirects are NOT followed. fetch follows them by default, and a
      // redirect from the HTTPS endpoint to an http:// one would re-send the
      // API token in the clear — undoing the HTTPS check in config.ts, which
      // only ever sees the URL we started with. An unexpected redirect on this
      // endpoint is a diagnosis, not something to chase.
      redirect: "manual",
    });
  } catch (caught) {
    const durationMs = Date.now() - startedAt;
    const aborted = caught instanceof Error && caught.name === "AbortError";
    throw new DeldoApiError(
      aborted ? "timeout" : "transport",
      redactToken(
        aborted
          ? `Deldo GET_STOCK timed out after ${config.timeoutMs}ms (${durationMs}ms elapsed)`
          : `Deldo GET_STOCK transport failure: ${caught instanceof Error ? caught.message : String(caught)}`,
        config.token
      ),
      { cause: caught }
    );
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  // 0 is what a manual-redirect fetch reports for an opaque redirect.
  if (response.status === 0 || (response.status >= 300 && response.status < 400)) {
    throw new DeldoApiError(
      "transport",
      redactToken(
        `Deldo GET_STOCK was redirected (HTTP ${response.status}) — refusing to follow, ` +
          `because a redirect to a non-HTTPS host would expose the API token`,
        config.token
      )
    );
  }

  const text = await response.text();

  if (text.length > MAX_RESPONSE_BYTES) {
    throw new DeldoApiError(
      "parse",
      `Deldo GET_STOCK response is ${text.length} bytes, over the ${MAX_RESPONSE_BYTES}-byte limit — not a GET_STOCK response`
    );
  }

  if (!response.ok) {
    throw new DeldoApiError(
      "http",
      redactToken(
        `Deldo GET_STOCK returned HTTP ${response.status} for ${safeUrl}`,
        config.token
      ),
      { retryable: response.status >= 500 }
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (caught) {
    throw new DeldoApiError(
      "parse",
      redactToken("Deldo GET_STOCK response was not valid JSON", config.token),
      { cause: caught }
    );
  }

  return {
    outcome: parseGetStockBody(body, config, now()),
    httpStatus: response.status,
    durationMs,
    safeUrl,
  };
}
