import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeGatewayConfig, resolveGatewayConfig } from "@/lib/suppliers/gateway/config";
import { GatewayError } from "@/lib/suppliers/gateway/errors";

/**
 * Gateway configuration.
 *
 * The two properties worth protecting: an unclear environment resolves to
 * TEST, and an unclear ordering flag resolves to OFF. Both fail closed, and
 * both would be easy to invert by accident.
 */

const VARS = [
  "INTERSPRINT_GATEWAY_ENV", "INTERSPRINT_GATEWAY_CUSTOMER_NUMBER",
  "INTERSPRINT_GATEWAY_USERNAME", "INTERSPRINT_GATEWAY_PASSWORD",
  "INTERSPRINT_GATEWAY_BASE_URL", "INTERSPRINT_GATEWAY_TIMEOUT_MS",
  "INTERSPRINT_LIVE_ORDERING_ENABLED",
  "INTERTYRE_GATEWAY_ENV", "INTERTYRE_GATEWAY_CUSTOMER_NUMBER",
  "INTERTYRE_GATEWAY_USERNAME", "INTERTYRE_GATEWAY_PASSWORD",
  "INTERTYRE_LIVE_ORDERING_ENABLED",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of VARS) { saved[key] = process.env[key]; delete process.env[key]; }
});
afterEach(() => {
  for (const key of VARS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function configureIntersprint(overrides: Record<string, string> = {}) {
  process.env.INTERSPRINT_GATEWAY_CUSTOMER_NUMBER = "99999";
  process.env.INTERSPRINT_GATEWAY_USERNAME = "gr-user";
  process.env.INTERSPRINT_GATEWAY_PASSWORD = "gr-secret";
  for (const [key, value] of Object.entries(overrides)) process.env[key] = value;
}

describe("describeGatewayConfig", () => {
  it("names every missing variable when nothing is set", () => {
    const report = describeGatewayConfig("intersprint");
    expect(report.configured).toBe(false);
    expect(report.missing).toEqual([
      "INTERSPRINT_GATEWAY_CUSTOMER_NUMBER",
      "INTERSPRINT_GATEWAY_USERNAME",
      "INTERSPRINT_GATEWAY_PASSWORD",
    ]);
  });

  it("never reveals a credential", () => {
    configureIntersprint();
    const serialized = JSON.stringify(describeGatewayConfig("intersprint"));
    expect(serialized).not.toContain("gr-secret");
    expect(serialized).not.toContain("gr-user");
    expect(serialized).not.toContain("99999");
  });

  it("reports presence without the value", () => {
    configureIntersprint();
    const report = describeGatewayConfig("intersprint");
    expect(report.configured).toBe(true);
    expect(report.customerNumberPresent).toBe(true);
    expect(report.usernamePresent).toBe(true);
    expect(report.passwordPresent).toBe(true);
  });

  it("defaults to the documented test URL", () => {
    configureIntersprint();
    const report = describeGatewayConfig("intersprint");
    expect(report.environment).toBe("test");
    expect(report.baseUrl).toBe("http://test-001.inter-sprint.nl");
  });

  it("uses the documented production URL only when explicitly asked", () => {
    configureIntersprint({ INTERSPRINT_GATEWAY_ENV: "production" });
    const report = describeGatewayConfig("intersprint");
    expect(report.environment).toBe("production");
    expect(report.baseUrl).toBe("http://customers.inter-sprint.nl");
  });

  /** Guessing wrong must mean the sandbox, never production. */
  it("falls back to test for any unrecognised environment value", () => {
    for (const value of ["prod", "PRODUCTION ", "live", "", "1"]) {
      configureIntersprint({ INTERSPRINT_GATEWAY_ENV: value });
      const report = describeGatewayConfig("intersprint");
      if (value.trim().toLowerCase() === "production") continue;
      expect(report.environment).toBe("test");
    }
  });

  it("keeps Inter-Tyre on its own URLs and credentials", () => {
    configureIntersprint();
    process.env.INTERTYRE_GATEWAY_CUSTOMER_NUMBER = "11111";
    process.env.INTERTYRE_GATEWAY_USERNAME = "it-user";
    process.env.INTERTYRE_GATEWAY_PASSWORD = "it-secret";

    const it_ = describeGatewayConfig("intertyre");
    expect(it_.baseUrl).toBe("http://test-002.inter-tyre.nl");
    expect(it_.configured).toBe(true);

    // Inter-Sprint credentials must not satisfy Inter-Tyre or vice versa.
    delete process.env.INTERTYRE_GATEWAY_PASSWORD;
    expect(describeGatewayConfig("intertyre").configured).toBe(false);
    expect(describeGatewayConfig("intersprint").configured).toBe(true);
  });

  it("flags plain-HTTP transport", () => {
    configureIntersprint();
    expect(describeGatewayConfig("intersprint").insecureTransport).toBe(true);
    configureIntersprint({ INTERSPRINT_GATEWAY_BASE_URL: "https://gw.example.com" });
    expect(describeGatewayConfig("intersprint").insecureTransport).toBe(false);
  });

  describe("live ordering flag", () => {
    it("is off when unset", () => {
      configureIntersprint();
      expect(describeGatewayConfig("intersprint").liveOrderingEnabled).toBe(false);
    });

    it("is on only for the exact string 'true'", () => {
      for (const value of ["false", "FALSE", "0", "yes", "1", "", " ", "TRUE-ish", "enabled"]) {
        configureIntersprint({ INTERSPRINT_LIVE_ORDERING_ENABLED: value });
        expect(describeGatewayConfig("intersprint").liveOrderingEnabled).toBe(false);
      }
      configureIntersprint({ INTERSPRINT_LIVE_ORDERING_ENABLED: "true" });
      expect(describeGatewayConfig("intersprint").liveOrderingEnabled).toBe(true);
      configureIntersprint({ INTERSPRINT_LIVE_ORDERING_ENABLED: " TRUE " });
      expect(describeGatewayConfig("intersprint").liveOrderingEnabled).toBe(true);
    });

    it("is independent per partner", () => {
      configureIntersprint({ INTERSPRINT_LIVE_ORDERING_ENABLED: "true" });
      expect(describeGatewayConfig("intersprint").liveOrderingEnabled).toBe(true);
      expect(describeGatewayConfig("intertyre").liveOrderingEnabled).toBe(false);
    });
  });

  it("applies a sane timeout default and ignores nonsense", () => {
    configureIntersprint();
    expect(describeGatewayConfig("intersprint").timeoutMs).toBe(20_000);
    configureIntersprint({ INTERSPRINT_GATEWAY_TIMEOUT_MS: "-5" });
    expect(describeGatewayConfig("intersprint").timeoutMs).toBe(20_000);
    configureIntersprint({ INTERSPRINT_GATEWAY_TIMEOUT_MS: "abc" });
    expect(describeGatewayConfig("intersprint").timeoutMs).toBe(20_000);
    configureIntersprint({ INTERSPRINT_GATEWAY_TIMEOUT_MS: "5000" });
    expect(describeGatewayConfig("intersprint").timeoutMs).toBe(5_000);
  });

  it("trims a pasted trailing newline rather than treating it as a value", () => {
    configureIntersprint({ INTERSPRINT_GATEWAY_USERNAME: "  gr-user\n" });
    expect(describeGatewayConfig("intersprint").configured).toBe(true);
    expect(resolveGatewayConfig("intersprint").username).toBe("gr-user");
  });
});

describe("resolveGatewayConfig", () => {
  it("throws a configuration error naming the missing variables", () => {
    expect(() => resolveGatewayConfig("intersprint")).toThrow(GatewayError);
    try {
      resolveGatewayConfig("intersprint");
    } catch (error) {
      expect((error as GatewayError).kind).toBe("configuration");
      expect((error as GatewayError).message).toContain("INTERSPRINT_GATEWAY_PASSWORD");
    }
  });

  it("returns credentials for server-side use", () => {
    configureIntersprint();
    const config = resolveGatewayConfig("intersprint");
    expect(config.customerNumber).toBe("99999");
    expect(config.password).toBe("gr-secret");
    expect(config.liveOrderingEnabled).toBe(false);
  });
});
