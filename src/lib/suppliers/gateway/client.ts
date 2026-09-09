import { randomUUID } from "node:crypto";
import { buildGatewayUrl, type GatewayParams } from "@/lib/suppliers/gateway/url";
import {
  parseGatewayResponse,
  type ResponseOutcome,
} from "@/lib/suppliers/gateway/response";
import {
  GatewayError,
  describeGatewayCode,
  isRetryableGatewayCode,
} from "@/lib/suppliers/gateway/errors";
import {
  PROTOCOLS,
  TEST_MODE_PARAM,
  TEST_MODE_VALUE,
  type GatewayProtocol,
} from "@/lib/suppliers/gateway/protocols";
import type { ResolvedGatewayConfig } from "@/lib/suppliers/gateway/config";
import { logError, logEvent } from "@/lib/logger";

/**
 * The Inter-Sprint / Inter-Tyre Gateway client.
 *
 * One transport for every protocol. Each call gets a correlation id, a hard
 * timeout, an audit record and a classified outcome, and the raw supplier
 * body is always returned so a disputed response can be examined afterwards.
 *
 * Three properties this file exists to guarantee:
 *
 *   1. A live order cannot happen while the feature flag is off. The check
 *      is before any network call, and buildGatewayUrl repeats it.
 *   2. An order is never retried automatically. A timeout on a 104 does not
 *      mean the order failed — it means the outcome is unknown, and a retry
 *      is how one order becomes two.
 *   3. Credentials never reach a log. The Authorization header is built at
 *      the point of use and nothing that touches it is logged.
 *
 * Deterministic throughout: no AI, no heuristics, no inference about what
 * the supplier "meant".
 */

export interface GatewayCallResult {
  correlationId: string;
  outcome: ResponseOutcome;
  /** The supplier's response verbatim. Server-side only. */
  raw: string;
  httpStatus: number;
  durationMs: number;
  attempts: number;
  /** The URL called, with credentials never present (they are in a header). */
  url: string;
}

export interface GatewayClientDeps {
  /** Injectable for tests. Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable so audit assertions do not depend on console output. */
  onAudit?: (record: GatewayAuditRecord) => void;
  now?: () => number;
  newCorrelationId?: () => string;
}

export interface GatewayAuditRecord {
  correlationId: string;
  partner: string;
  environment: string;
  protocol: string;
  protocolName: string;
  kind: string;
  testMode: boolean;
  httpStatus: number | null;
  outcome: string;
  gatewayCode: string | null;
  durationMs: number;
  attempts: number;
  responseBytes: number;
  ok: boolean;
}

/** Read calls get one retry; orders get none, ever. */
const MAX_READ_ATTEMPTS = 2;

export class InterSprintGatewayClient {
  private readonly config: ResolvedGatewayConfig;
  private readonly fetchFn: typeof fetch;
  private readonly onAudit: (record: GatewayAuditRecord) => void;
  private readonly now: () => number;
  private readonly newCorrelationId: () => string;

  constructor(config: ResolvedGatewayConfig, deps: GatewayClientDeps = {}) {
    this.config = config;
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
    this.now = deps.now ?? (() => Date.now());
    this.newCorrelationId = deps.newCorrelationId ?? (() => randomUUID());
    this.onAudit =
      deps.onAudit ??
      ((record) => {
        logEvent("supplier_gateway_call", { ...record });
      });
  }

  /** HTTP Basic, per §1.4. Built here and never stored or logged. */
  private authorizationHeader(): string {
    const token = Buffer.from(`${this.config.username}:${this.config.password}`, "utf8").toString(
      "base64"
    );
    return `Basic ${token}`;
  }

  /**
   * Issues one gateway call.
   *
   * Every failure path produces an audit record before it throws, so a call
   * that went wrong is never invisible.
   */
  async call(
    protocol: GatewayProtocol,
    params: GatewayParams,
    options: { correlationId?: string; positional?: readonly string[] } = {}
  ): Promise<GatewayCallResult> {
    const correlationId = options.correlationId ?? this.newCorrelationId();
    const testMode = String(params[TEST_MODE_PARAM] ?? "") === TEST_MODE_VALUE;

    if (!protocol.availableFor.includes(this.config.partner)) {
      throw new GatewayError(
        "configuration",
        `protocol ${protocol.code} is not available for ${this.config.partner}`,
        { context: this.contextFor(correlationId, protocol) }
      );
    }

    // Lock one: no live order while the flag is off. Before any I/O.
    if (protocol.kind === "order" && !testMode && !this.config.liveOrderingEnabled) {
      const error = new GatewayError(
        "ordering_disabled",
        `live ordering is disabled — protocol ${protocol.code} refused`,
        { context: this.contextFor(correlationId, protocol) }
      );
      this.audit({
        correlationId, protocol, testMode, httpStatus: null,
        outcome: "ordering_disabled", gatewayCode: null, durationMs: 0,
        attempts: 0, responseBytes: 0, ok: false,
      });
      throw error;
    }

    // Lock two lives inside buildGatewayUrl.
    const url = buildGatewayUrl({
      baseUrl: this.config.baseUrl,
      protocol,
      params,
      positional: options.positional,
      liveOrderingEnabled: this.config.liveOrderingEnabled,
    });

    const maxAttempts = protocol.kind === "order" ? 1 : MAX_READ_ATTEMPTS;
    let lastError: GatewayError | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const started = this.now();
      try {
        const { body, status } = await this.fetchOnce(url, correlationId, protocol);
        const durationMs = this.now() - started;
        const outcome = parseGatewayResponse(body);

        const gatewayCode = outcome.status === "error" ? outcome.code : null;
        this.audit({
          correlationId, protocol, testMode, httpStatus: status,
          outcome: outcome.status, gatewayCode, durationMs, attempts: attempt,
          responseBytes: body.length,
          ok: outcome.status !== "error" && outcome.status !== "malformed",
        });

        // A retryable gateway code on a read gets one more go; an order never does.
        if (
          outcome.status === "error" &&
          protocol.kind !== "order" &&
          isRetryableGatewayCode(outcome.code) &&
          attempt < maxAttempts
        ) {
          lastError = new GatewayError(
            "gateway",
            `gateway error ${outcome.code}: ${outcome.description || describeGatewayCode(outcome.code)}`,
            { gatewayCode: outcome.code, retryable: true, context: this.contextFor(correlationId, protocol, durationMs) }
          );
          continue;
        }

        return {
          correlationId,
          outcome,
          raw: body,
          httpStatus: status,
          durationMs,
          attempts: attempt,
          url,
        };
      } catch (caught) {
        const durationMs = this.now() - started;
        const error = this.toGatewayError(caught, correlationId, protocol, durationMs);

        this.audit({
          correlationId, protocol, testMode, httpStatus: null,
          outcome: error.kind, gatewayCode: null, durationMs, attempts: attempt,
          responseBytes: 0, ok: false,
        });

        // An order is never retried: a timeout means "unknown", not "failed".
        if (protocol.kind === "order" || !error.retryable || attempt >= maxAttempts) {
          logError("supplier_gateway_failed", error, {
            correlationId,
            partner: this.config.partner,
            protocol: protocol.code,
          });
          throw error;
        }
        lastError = error;
      }
    }

    throw lastError ?? new GatewayError("transport", "gateway call failed", {
      context: this.contextFor(correlationId, protocol),
    });
  }

  private async fetchOnce(
    url: string,
    correlationId: string,
    protocol: GatewayProtocol
  ): Promise<{ body: string; status: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await this.fetchFn(url, {
        method: "GET",
        headers: {
          Authorization: this.authorizationHeader(),
          Accept: "text/plain",
          // Correlation travels with the request so a supplier-side trace can
          // be lined up with ours when something is disputed.
          "X-Correlation-Id": correlationId,
        },
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });

      const body = await response.text();

      if (!response.ok) {
        throw new GatewayError(
          "http",
          `gateway returned HTTP ${response.status}`,
          {
            retryable: response.status >= 500,
            context: this.contextFor(correlationId, protocol),
          }
        );
      }

      return { body, status: response.status };
    } finally {
      clearTimeout(timer);
    }
  }

  private toGatewayError(
    caught: unknown,
    correlationId: string,
    protocol: GatewayProtocol,
    durationMs: number
  ): GatewayError {
    if (caught instanceof GatewayError) return caught;

    const context = this.contextFor(correlationId, protocol, durationMs);
    const name = (caught as { name?: string } | null)?.name;

    if (name === "AbortError" || name === "TimeoutError") {
      return new GatewayError("timeout", `gateway call timed out after ${this.config.timeoutMs}ms`, {
        // Retryable in principle; the order guard above still blocks 104.
        retryable: true,
        context,
        cause: caught,
      });
    }

    const message = caught instanceof Error ? caught.message : String(caught);
    return new GatewayError("transport", `gateway transport error: ${message}`, {
      retryable: true,
      context,
      cause: caught,
    });
  }

  private contextFor(correlationId: string, protocol: GatewayProtocol, durationMs: number | null = null) {
    return {
      correlationId,
      partner: this.config.partner,
      environment: this.config.environment,
      protocol: protocol.code,
      durationMs,
    };
  }

  private audit(input: {
    correlationId: string;
    protocol: GatewayProtocol;
    testMode: boolean;
    httpStatus: number | null;
    outcome: string;
    gatewayCode: string | null;
    durationMs: number;
    attempts: number;
    responseBytes: number;
    ok: boolean;
  }): void {
    this.onAudit({
      correlationId: input.correlationId,
      partner: this.config.partner,
      environment: this.config.environment,
      protocol: input.protocol.code,
      protocolName: input.protocol.name,
      kind: input.protocol.kind,
      testMode: input.testMode,
      httpStatus: input.httpStatus,
      outcome: input.outcome,
      gatewayCode: input.gatewayCode,
      durationMs: input.durationMs,
      attempts: input.attempts,
      responseBytes: input.responseBytes,
      ok: input.ok,
    });
  }

  // -------------------------------------------------------------------------
  // Typed operations
  // -------------------------------------------------------------------------

  /** Live stock/price for one EAN. §2.1 */
  async stockByEan(ean: string, extra: GatewayParams = {}) {
    return this.call(PROTOCOLS.STOCK_SEARCH, {
      kl: this.config.customerNumber,
      artc: `E=${ean}`,
      ...extra,
    });
  }

  /** Live stock/price for one article system number. §2.1 */
  async stockBySystemNumber(systemNumber: string, extra: GatewayParams = {}) {
    return this.call(PROTOCOLS.STOCK_SEARCH, {
      kl: this.config.customerNumber,
      artc: `S=${systemNumber}`,
      ...extra,
    });
  }

  /**
   * Validates an order WITHOUT placing it. §4.2.
   *
   * Always safe: test=1 is forced here rather than passed through, so a
   * caller cannot turn a validation into a real order by supplying params.
   */
  async validateOrder(params: GatewayParams) {
    return this.call(PROTOCOLS.ORDER_ENTRY, {
      kl: this.config.customerNumber,
      ...params,
      [TEST_MODE_PARAM]: TEST_MODE_VALUE,
    });
  }

  /**
   * Places a REAL order. §4.1.
   *
   * Refused unless live ordering is enabled. The manual's own recommended
   * sequence (§6.3 → §6.4) is validate first, then re-issue without test —
   * which is exactly the pair of methods above and below.
   */
  async placeOrder(params: GatewayParams) {
    const cleaned = { ...params };
    delete cleaned[TEST_MODE_PARAM];
    return this.call(PROTOCOLS.ORDER_ENTRY, {
      kl: this.config.customerNumber,
      ...cleaned,
    });
  }

  /** Packing lists / delivery notes for a date range. §5.1 */
  async deliveryNotes(dateFrom: string, dateTo: string, type?: "P" | "L") {
    return this.call(PROTOCOLS.DELIVERY_NOTES, {
      kl: this.config.customerNumber,
      datum1: dateFrom,
      datum2: dateTo,
      type,
    });
  }

  /**
   * Invoices for a date range. §5.2.
   *
   * Protocol 11 takes positional arguments, not key=value:
   * `ww0800?11,<customer number>,<date from>,<date to>`.
   */
  async invoices(dateFrom: string, dateTo: string) {
    return this.call(PROTOCOLS.INVOICES, {}, {
      positional: [this.config.customerNumber, dateFrom, dateTo],
    });
  }

  /** The supplier's own error-code list. §5.6 */
  async errorList() {
    return this.call(PROTOCOLS.ERROR_LIST, {});
  }

  /** Delivery prices per method. §5.7 */
  async deliveryPrices(extra: GatewayParams = {}) {
    return this.call(PROTOCOLS.DELIVERY_PRICES, {
      kl: this.config.customerNumber,
      ...extra,
    });
  }

  /** Delivery addresses of the login. §5.8 */
  async deliveryAddresses() {
    return this.call(PROTOCOLS.DELIVERY_ADDRESSES, {});
  }

  /** Company data. §5.9 */
  async companyData() {
    return this.call(PROTOCOLS.COMPANY_DATA, {});
  }
}
