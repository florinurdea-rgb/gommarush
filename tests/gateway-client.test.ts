import { describe, expect, it, vi } from "vitest";
import { InterSprintGatewayClient, type GatewayAuditRecord } from "@/lib/suppliers/gateway/client";
import { PROTOCOLS } from "@/lib/suppliers/gateway/protocols";
import { GatewayError } from "@/lib/suppliers/gateway/errors";
import { parseGatewayResponse } from "@/lib/suppliers/gateway/response";
import { buildGatewayUrl, MAX_URL_LENGTH } from "@/lib/suppliers/gateway/url";
import type { ResolvedGatewayConfig } from "@/lib/suppliers/gateway/config";

/**
 * The gateway client.
 *
 * The responses below are copied from the manual's own worked examples, so
 * these tests fail if the parser drifts from the documented wire format.
 */

// Manual §2.1, Example 1 — a real protocol 103 tyre response.
const STOCK_RESPONSE =
  "034949\t225 40ZR 18TCSC2N2EU\tCO\t11\t225/40 ZR18 TL ZR CO CSC 2 N2 EU\tEUR\t105.89\t224.00\t10\n*END*";
// Manual §4.1.1, Example 1 — a successful order entry.
const ORDER_RESPONSE =
  "00\t836517\t0001\t224148\t225 40YR 18TCSC5SSR\t225/40 YR18 TL 88Y\tCO\t25\t4\t139.75\tEUR\n*END*";
// Manual §4.2 — the three documented test-mode outcomes.
const TEST_OK_RESPONSE = "01 test ok\n*END*";
const NOT_ENOUGH_STOCK = "92 not enough stock\n*END*";

function config(overrides: Partial<ResolvedGatewayConfig> = {}): ResolvedGatewayConfig {
  return {
    partner: "intersprint",
    environment: "test",
    baseUrl: "http://test-001.inter-sprint.nl",
    customerNumber: "99999",
    username: "gr-user",
    password: "gr-secret",
    timeoutMs: 50,
    liveOrderingEnabled: false,
    insecureTransport: true,
    ...overrides,
  };
}

function clientWith(
  fetchFn: typeof fetch,
  overrides: Partial<ResolvedGatewayConfig> = {}
): { client: InterSprintGatewayClient; audits: GatewayAuditRecord[] } {
  const audits: GatewayAuditRecord[] = [];
  const client = new InterSprintGatewayClient(config(overrides), {
    fetchFn,
    onAudit: (record) => audits.push(record),
    newCorrelationId: () => "corr-test-1",
  });
  return { client, audits };
}

function respond(body: string, status = 200): typeof fetch {
  return vi.fn(async () => new Response(body, { status })) as unknown as typeof fetch;
}

describe("successful response", () => {
  it("parses a documented protocol 103 stock response", async () => {
    const { client } = clientWith(respond(STOCK_RESPONSE));
    const result = await client.stockByEan("3286347860812");

    expect(result.outcome.status).toBe("data");
    if (result.outcome.status !== "data") throw new Error("unreachable");
    expect(result.outcome.rows[0][0]).toBe("034949");
    expect(result.outcome.rows[0][6]).toBe("105.89");
    expect(result.httpStatus).toBe(200);
  });

  it("preserves the raw supplier body for debugging", async () => {
    const { client } = clientWith(respond(STOCK_RESPONSE));
    const result = await client.stockByEan("3286347860812");
    expect(result.raw).toBe(STOCK_RESPONSE);
  });

  it("sends HTTP Basic auth and a correlation id, and puts kl in the URL", async () => {
    const fetchFn = respond(STOCK_RESPONSE);
    const { client } = clientWith(fetchFn);
    await client.stockByEan("3286347860812");

    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;

    expect(headers.Authorization).toBe(`Basic ${Buffer.from("gr-user:gr-secret").toString("base64")}`);
    expect(headers["X-Correlation-Id"]).toBe("corr-test-1");
    // §1.1 URL shape, §2.1 EAN search, customer number as the `kl` parameter.
    expect(String(url)).toContain("/scripts/cgirpc32.dll/ww0800?103,");
    expect(String(url)).toContain("kl=99999");
    expect(String(url)).toContain("artc=E%3D3286347860812");
  });

  it("writes an audit record carrying the correlation id and no credentials", async () => {
    const { client, audits } = clientWith(respond(STOCK_RESPONSE));
    await client.stockByEan("3286347860812");

    expect(audits).toHaveLength(1);
    expect(audits[0].correlationId).toBe("corr-test-1");
    expect(audits[0].protocol).toBe("103");
    expect(audits[0].ok).toBe(true);
    expect(JSON.stringify(audits[0])).not.toContain("gr-secret");
  });
});

describe("gateway error response", () => {
  /** §1.2: an error arrives as an ordinary HTTP 200 with a code in the body. */
  it("classifies an error body returned with HTTP 200", async () => {
    const { client } = clientWith(respond(NOT_ENOUGH_STOCK));
    const result = await client.validateOrder({ art: "224148", aant: 4 });

    expect(result.httpStatus).toBe(200);
    expect(result.outcome.status).toBe("error");
    if (result.outcome.status !== "error") throw new Error("unreachable");
    expect(result.outcome.code).toBe("92");
    expect(result.outcome.description).toBe("not enough stock");
  });

  it("marks the audit record as not ok and records the gateway code", async () => {
    const { client, audits } = clientWith(respond(NOT_ENOUGH_STOCK));
    await client.validateOrder({ art: "224148", aant: 4 });
    expect(audits[0].ok).toBe(false);
    expect(audits[0].gatewayCode).toBe("92");
  });

  it("surfaces a non-2xx HTTP status as a transport-level failure", async () => {
    const { client } = clientWith(respond("upstream down", 502));
    await expect(client.stockByEan("3286347860812")).rejects.toMatchObject({ kind: "http" });
  });
});

describe("malformed supplier response", () => {
  /** Without *END* the body may be a truncated transfer. §2.1 */
  it("refuses a response with no end marker rather than reading partial data", () => {
    const outcome = parseGatewayResponse("034949\t225 40ZR 18TCSC2N2EU\tCO");
    expect(outcome.status).toBe("malformed");
    if (outcome.status !== "malformed") throw new Error("unreachable");
    expect(outcome.reason).toBe("MISSING_END_MARKER");
  });

  it("treats an empty body as malformed, not as an empty result", () => {
    expect(parseGatewayResponse("").status).toBe("malformed");
    expect(parseGatewayResponse("   ").status).toBe("malformed");
  });

  it("detects an unknown protocol", () => {
    const outcome = parseGatewayResponse("*INCORRECT TYPE*");
    expect(outcome.status).toBe("error");
  });

  it("returns malformed to the caller with the raw body intact", async () => {
    const { client } = clientWith(respond("garbage with no marker"));
    const result = await client.stockByEan("3286347860812");
    expect(result.outcome.status).toBe("malformed");
    expect(result.raw).toBe("garbage with no marker");
  });

  /**
   * The trap this pins. Protocol 15 (§5.6) lists every gateway error code,
   * so each of its rows legitimately BEGINS with a two-digit error number.
   * Classifying on "starts with a code" alone would read the whole error
   * catalogue as a single error.
   */
  it("reads the protocol 15 error catalogue as data, not as an error", () => {
    const outcome = parseGatewayResponse(
      "44\tsystem in maintenance\n92\tnot enough stock\n98\turl too long\n*END*"
    );
    expect(outcome.status).toBe("data");
    if (outcome.status !== "data") throw new Error("unreachable");
    expect(outcome.rows).toHaveLength(3);
    expect(outcome.rows[1]).toEqual(["92", "not enough stock"]);
  });

  it("still classifies a lone code line as an error (§1.2: no other output)", () => {
    const outcome = parseGatewayResponse("44 system in maintenance\n*END*");
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("unreachable");
    expect(outcome.code).toBe("44");
    expect(outcome.description).toBe("system in maintenance");
  });

  it("never throws on malformed input, so the evidence is preserved", () => {
    for (const body of ["", "\t\t\t", "*END*", "\n\n*END*", "not a code\n*END*"]) {
      expect(() => parseGatewayResponse(body)).not.toThrow();
    }
  });
});

describe("timeout", () => {
  it("aborts and reports a timeout instead of hanging", async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as unknown as typeof fetch;

    const { client, audits } = clientWith(fetchFn, { timeoutMs: 20 });
    await expect(client.stockByEan("3286347860812")).rejects.toMatchObject({ kind: "timeout" });
    expect(audits.some((record) => record.outcome === "timeout")).toBe(true);
  });

  /** An order timing out means UNKNOWN, not failed — retrying could duplicate it. */
  it("never retries an order after a timeout", async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as unknown as typeof fetch;

    const { client } = clientWith(fetchFn, { timeoutMs: 20, liveOrderingEnabled: true });
    await expect(client.placeOrder({ art: "224148", aant: 4 })).rejects.toMatchObject({
      kind: "timeout",
    });
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe("the live-ordering gate", () => {
  it("refuses placeOrder while the flag is false, without any network call", async () => {
    const fetchFn = respond(ORDER_RESPONSE);
    const { client, audits } = clientWith(fetchFn);

    await expect(client.placeOrder({ art: "224148", aant: 4 })).rejects.toMatchObject({
      kind: "ordering_disabled",
    });
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    expect(audits[0].outcome).toBe("ordering_disabled");
  });

  it("allows validateOrder while the flag is false, and forces test=1", async () => {
    const fetchFn = respond(TEST_OK_RESPONSE);
    const { client } = clientWith(fetchFn);

    const result = await client.validateOrder({ art: "224148", aant: 4 });
    expect(result.outcome.status).toBe("test_ok");

    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("test=1");
  });

  /** A caller must not be able to turn a validation into a real order. */
  it("cannot be tricked into a live order by passing test=0 to validateOrder", async () => {
    const fetchFn = respond(TEST_OK_RESPONSE);
    const { client } = clientWith(fetchFn);
    await client.validateOrder({ art: "224148", aant: 4, test: "0" });
    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("test=1");
    expect(String(url)).not.toContain("test=0");
  });

  it("blocks a live order URL at the builder too, independently of the client", () => {
    expect(() =>
      buildGatewayUrl({
        baseUrl: "http://test-001.inter-sprint.nl",
        protocol: PROTOCOLS.ORDER_ENTRY,
        params: { kl: "99999", art: "224148", aant: "4" },
        liveOrderingEnabled: false,
      })
    ).toThrow(GatewayError);
  });

  it("places a real order only once the flag is true", async () => {
    const fetchFn = respond(ORDER_RESPONSE);
    const { client } = clientWith(fetchFn, { liveOrderingEnabled: true });

    const result = await client.placeOrder({ art: "224148", aant: 4 });
    expect(result.outcome.status).toBe("order_placed");
    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).not.toContain("test=1");
  });
});

describe("URL construction rules (§1.1, §1.3)", () => {
  it("escapes the underscore, which the gateway would otherwise turn into a blank", () => {
    const url = buildGatewayUrl({
      baseUrl: "http://test-001.inter-sprint.nl",
      protocol: PROTOCOLS.STOCK_SEARCH,
      params: { kl: "99999", refkop: "order_123" },
      liveOrderingEnabled: false,
    });
    expect(url).toContain("order%5F123");
    expect(url).not.toContain("order_123");
  });

  it("refuses a semicolon, which the gateway reads as a command separator", () => {
    expect(() =>
      buildGatewayUrl({
        baseUrl: "http://test-001.inter-sprint.nl",
        protocol: PROTOCOLS.STOCK_SEARCH,
        params: { kl: "99999", artc: "a;b" },
        liveOrderingEnabled: false,
      })
    ).toThrow(/command separator/);
  });

  it("refuses a URL over the documented 1800-character limit", () => {
    try {
      buildGatewayUrl({
        baseUrl: "http://test-001.inter-sprint.nl",
        protocol: PROTOCOLS.STOCK_SEARCH,
        params: { kl: "99999", artc: "x".repeat(MAX_URL_LENGTH) },
        liveOrderingEnabled: false,
      });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as GatewayError).kind).toBe("request_too_long");
      expect((error as GatewayError).gatewayCode).toBe("98");
    }
  });

  it("builds protocol 11 positionally, not as key=value (§5.2)", async () => {
    const fetchFn = respond("*END*");
    const { client } = clientWith(fetchFn);
    await client.invoices("20120425", "20120425");
    const [url] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("ww0800?11,99999,20120425,20120425");
  });
});
