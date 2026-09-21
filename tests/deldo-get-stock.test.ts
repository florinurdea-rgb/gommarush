import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDeldoStock,
  parseGetStockBody,
  buildGetStockUrl,
} from "@/lib/suppliers/deldo/get-stock/client";
import {
  describeDeldoConfig,
  resolveDeldoConfig,
  readDeldoEnvironment,
  DELDO_TEST_BASE_URL,
} from "@/lib/suppliers/deldo/get-stock/config";
import { DeldoApiError, redactToken } from "@/lib/suppliers/deldo/get-stock/errors";

const TOKEN = "s3cr3t-token-value";
const ENV_KEYS = [
  "DELDO_API_ENVIRONMENT",
  "DELDO_API_TOKEN",
  "DELDO_API_BASE_URL",
  "DELDO_API_TIMEOUT_MS",
] as const;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.restoreAllMocks();
});

/** The documented success body. Every value is a STRING, per the PDF. */
const SUCCESS_BODY = {
  success: "1",
  "product-id": "BS7623",
  amount: "50",
  price: "85.50",
};

const UNKNOWN_BODY = { success: "0", "error-message": "Unknown article" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Deldo configuration", () => {
  it("defaults to the test environment when unset or unrecognised", () => {
    setEnv({});
    expect(readDeldoEnvironment()).toBe("test");
    setEnv({ DELDO_API_ENVIRONMENT: "PRODUCTION" });
    // Anything unrecognised must mean the sandbox, never the live endpoint.
    expect(readDeldoEnvironment()).toBe("test");
    setEnv({ DELDO_API_ENVIRONMENT: "live" });
    expect(readDeldoEnvironment()).toBe("live");
  });

  it("defaults the documented test URL but never a live one", () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const test = describeDeldoConfig();
    expect(test.baseUrl).toBe(DELDO_TEST_BASE_URL);
    expect(test.configured).toBe(true);

    // The live URL is supplied by Deldo after testing. It is not invented.
    setEnv({ DELDO_API_ENVIRONMENT: "live", DELDO_API_TOKEN: TOKEN });
    const live = describeDeldoConfig();
    expect(live.baseUrl).toBeNull();
    expect(live.configured).toBe(false);
    expect(live.missing).toContain("DELDO_API_BASE_URL");
  });

  it("fails closed when the token is missing", () => {
    setEnv({});
    expect(describeDeldoConfig().configured).toBe(false);
    expect(() => resolveDeldoConfig()).toThrow(DeldoApiError);
  });

  it("never reports the token itself", () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const report = describeDeldoConfig();
    expect(report.tokenPresent).toBe(true);
    expect(JSON.stringify(report)).not.toContain(TOKEN);
  });

  it("refuses to send the token over plain HTTP", () => {
    setEnv({
      DELDO_API_TOKEN: TOKEN,
      DELDO_API_BASE_URL: "http://api-test.deldo.be/gaston/dotcube_cgi",
    });
    expect(() => resolveDeldoConfig()).toThrow(/HTTPS/);
  });

  it("marks test-environment answers as test data", () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    expect(resolveDeldoConfig().classification).toBe("test");

    setEnv({
      DELDO_API_ENVIRONMENT: "live",
      DELDO_API_TOKEN: TOKEN,
      DELDO_API_BASE_URL: "https://api.example.invalid/cgi",
    });
    expect(resolveDeldoConfig().classification).toBe("live");
  });

  it("builds the documented URL shape", () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const url = buildGetStockUrl(resolveDeldoConfig(), "BS7623");
    expect(url).toContain(DELDO_TEST_BASE_URL);
    expect(url).toContain("request=GET_STOCK");
    expect(url).toContain("article=BS7623");
    expect(url).toContain(`token=${encodeURIComponent(TOKEN)}`);
  });
});

describe("token redaction", () => {
  it("removes the token from any string bound for a log", () => {
    const url = `${DELDO_TEST_BASE_URL}?token=${TOKEN}&request=GET_STOCK&article=X`;
    const safe = redactToken(url, TOKEN);
    expect(safe).not.toContain(TOKEN);
    expect(safe).toContain("***REDACTED***");
  });

  it("redacts a token parameter even when the value is not the one we hold", () => {
    const safe = redactToken("...?token=some-other-value&request=GET_STOCK", TOKEN);
    expect(safe).not.toContain("some-other-value");
  });
});

describe("GET_STOCK response parsing", () => {
  const config = {
    environment: "test" as const,
    baseUrl: DELDO_TEST_BASE_URL,
    token: TOKEN,
    timeoutMs: 15_000,
    classification: "test" as const,
  };
  const observedAt = new Date("2026-09-21T12:00:00Z");

  it("parses the documented success response", () => {
    const outcome = parseGetStockBody(SUCCESS_BODY, config, observedAt);
    expect(outcome.status).toBe("available");
    if (outcome.status !== "available") return;
    expect(outcome.productId).toBe("BS7623");
    expect(outcome.amount).toBe(50);
    expect(outcome.price).toBe(85.5);
  });

  it("carries price as well as stock, because GET_STOCK verifies both", () => {
    const outcome = parseGetStockBody(SUCCESS_BODY, config, observedAt);
    if (outcome.status !== "available") throw new Error("expected available");
    expect(outcome.observation.purchasePrice).toBe(85.5);
    expect(outcome.observation.stockExact).toBe(50);
    expect(outcome.observation.source).toBe("live_lookup");
  });

  /**
   * The test endpoint serves the same fictional data as 26933TEST.csv, so its
   * answers are test data however real they look. Deriving this from the
   * environment rather than trusting the caller is what stops a sandbox price
   * being recorded as commercial fact.
   */
  it("stamps a test-environment answer as test data", () => {
    const outcome = parseGetStockBody(SUCCESS_BODY, config, observedAt);
    if (outcome.status !== "available") throw new Error("expected available");
    expect(outcome.observation.classification).toBe("test");
  });

  it("leaves the commercial mode unknown, since a lookup cannot say", () => {
    const outcome = parseGetStockBody(SUCCESS_BODY, config, observedAt);
    if (outcome.status !== "available") throw new Error("expected available");
    expect(outcome.observation.commercialMode).toBe("unknown");
    // No currency is returned by the API or present in the feed.
    expect(outcome.observation.currency).toBeNull();
  });

  it("treats an unknown article as a normal commercial answer, not an error", () => {
    const outcome = parseGetStockBody(UNKNOWN_BODY, config, observedAt);
    expect(outcome.status).toBe("unknown_article");
  });

  it("separates a supplier error from the documented unknown-article case", () => {
    const outcome = parseGetStockBody(
      { success: "0", "error-message": "Token expired" },
      config,
      observedAt
    );
    expect(outcome.status).toBe("supplier_error");
    if (outcome.status !== "supplier_error") return;
    expect(outcome.message).toBe("Token expired");
  });

  it("accepts zero stock as a real answer", () => {
    const outcome = parseGetStockBody(
      { ...SUCCESS_BODY, amount: "0" },
      config,
      observedAt
    );
    if (outcome.status !== "available") throw new Error("expected available");
    expect(outcome.amount).toBe(0);
    expect(outcome.observation.stockExact).toBe(0);
  });

  /**
   * Fail closed. Reporting a malformed body as "no stock" would look exactly
   * like a normal out-of-stock answer while actually meaning the integration
   * is broken — the failure would never be investigated.
   */
  it.each([
    ["not an object", "nonsense"],
    ["null body", null],
    ["unrecognised success value", { success: "yes" }],
    ["missing product-id", { success: "1", amount: "5", price: "10.00" }],
    ["empty amount", { ...SUCCESS_BODY, amount: "" }],
    ["non-numeric amount", { ...SUCCESS_BODY, amount: "many" }],
    ["non-numeric price", { ...SUCCESS_BODY, price: "85,50" }],
    ["negative price", { ...SUCCESS_BODY, price: "-5.00" }],
  ])("throws on a malformed response: %s", (_label, body) => {
    expect(() => parseGetStockBody(body, config, observedAt)).toThrow(DeldoApiError);
  });
});

describe("GET_STOCK client", () => {
  it("calls the documented endpoint and returns a typed outcome", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = vi.fn(async () => jsonResponse(SUCCESS_BODY));

    const result = await getDeldoStock("BS7623", {
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date("2026-09-21T12:00:00Z"),
    });

    expect(result.outcome.status).toBe("available");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("request=GET_STOCK");
    expect(init.method).toBe("GET");
  });

  it("never puts the token in the loggable URL", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const result = await getDeldoStock("BS7623", {
      fetchFn: (async () => jsonResponse(SUCCESS_BODY)) as unknown as typeof fetch,
    });
    expect(result.safeUrl).not.toContain(TOKEN);
    expect(result.safeUrl).toContain("***REDACTED***");
  });

  it("keeps the token out of a transport error message", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = (async () => {
      throw new Error(`connect ECONNREFUSED for token=${TOKEN}`);
    }) as unknown as typeof fetch;

    await expect(getDeldoStock("BS7623", { fetchFn })).rejects.toThrow(
      expect.objectContaining({
        kind: "transport",
        message: expect.not.stringContaining(TOKEN),
      }) as Error
    );
  });

  it("reports a timeout as its own kind, and as retryable", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN, DELDO_API_TIMEOUT_MS: "5" });
    const fetchFn = (async (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch;

    try {
      await getDeldoStock("BS7623", { fetchFn });
      throw new Error("expected a timeout");
    } catch (error) {
      expect(error).toBeInstanceOf(DeldoApiError);
      expect((error as DeldoApiError).kind).toBe("timeout");
      expect((error as DeldoApiError).retryable).toBe(true);
    }
  });

  it("fails on a non-2xx without leaking the token", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = (async () =>
      new Response("gateway down", { status: 502 })) as unknown as typeof fetch;

    try {
      await getDeldoStock("BS7623", { fetchFn });
      throw new Error("expected an http error");
    } catch (error) {
      expect((error as DeldoApiError).kind).toBe("http");
      expect((error as DeldoApiError).retryable).toBe(true);
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });

  it("fails closed when the body is not JSON", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = (async () =>
      new Response("<html>login</html>", { status: 200 })) as unknown as typeof fetch;

    await expect(getDeldoStock("BS7623", { fetchFn })).rejects.toThrow(
      expect.objectContaining({ kind: "parse" }) as Error
    );
  });

  it("refuses to call without configuration, before any network access", async () => {
    setEnv({});
    const fetchFn = vi.fn();
    await expect(
      getDeldoStock("BS7623", { fetchFn: fetchFn as unknown as typeof fetch })
    ).rejects.toThrow(DeldoApiError);
    // The point of failing closed: nothing reached the network.
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses an empty article identifier", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = vi.fn();
    await expect(
      getDeldoStock("   ", { fetchFn: fetchFn as unknown as typeof fetch })
    ).rejects.toThrow(DeldoApiError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  /**
   * fetch follows redirects by default, so an endpoint that redirected
   * https:// to http:// would re-send the API token in the clear. The HTTPS
   * check in config.ts cannot catch that: it only ever sees the URL we start
   * with.
   */
  it("refuses to follow a redirect, which could downgrade to plain HTTP", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: "http://evil.example.invalid/collect" },
      });
    });

    try {
      await getDeldoStock("BS7623", { fetchFn: fetchFn as unknown as typeof fetch });
      throw new Error("expected a redirect refusal");
    } catch (error) {
      expect((error as DeldoApiError).kind).toBe("transport");
      expect((error as Error).message).toMatch(/redirect/i);
      expect((error as Error).message).not.toContain(TOKEN);
    }
  });

  it("caps the response it will read", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const huge = "x".repeat(70 * 1024);
    const fetchFn = (async () =>
      new Response(huge, { status: 200 })) as unknown as typeof fetch;

    await expect(getDeldoStock("BS7623", { fetchFn })).rejects.toThrow(
      /over the \d+-byte limit/
    );
  });

  it("does not retry, so a pre-order check cannot silently age", async () => {
    setEnv({ DELDO_API_TOKEN: TOKEN });
    const fetchFn = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      getDeldoStock("BS7623", { fetchFn: fetchFn as unknown as typeof fetch })
    ).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
