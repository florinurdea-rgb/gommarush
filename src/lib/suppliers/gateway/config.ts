// Gateway configuration, resolved from environment variables only.
//
// Two independent partners with two environments each. The manual is
// emphatic that these do not mix (§1.1): "Separate logins are necessary for
// Inter-Sprint and Inter-Tyre and they are not exchangeable!" — so the
// configuration is keyed by partner from the ground up rather than being one
// set of credentials with a switch.
//
// Nothing here reads a credential into a return value. describeGatewayConfig
// reports what is missing and what shape things are in, and is safe to render
// on an admin screen; the secrets themselves only ever leave via
// resolveGatewayConfig, which is used server-side.

import type { GatewayPartner } from "@/lib/suppliers/gateway/protocols";
import { GatewayError } from "@/lib/suppliers/gateway/errors";

export type GatewayEnvironment = "test" | "production";

/**
 * Base URLs exactly as documented in §1.1. Defaulted rather than required so
 * a deployment cannot typo a hostname, but overridable per partner because
 * the manual documents http:// only — see the note below.
 */
const DEFAULT_BASE_URLS: Record<GatewayPartner, Record<GatewayEnvironment, string>> = {
  intersprint: {
    production: "http://customers.inter-sprint.nl",
    test: "http://test-001.inter-sprint.nl",
  },
  intertyre: {
    production: "http://customers.inter-tyre.nl",
    test: "http://test-002.inter-tyre.nl",
  },
};

/** Env var prefix per partner. */
const PREFIX: Record<GatewayPartner, string> = {
  intersprint: "INTERSPRINT",
  intertyre: "INTERTYRE",
};

const DEFAULT_TIMEOUT_MS = 20_000;

export interface ResolvedGatewayConfig {
  partner: GatewayPartner;
  environment: GatewayEnvironment;
  baseUrl: string;
  customerNumber: string;
  username: string;
  password: string;
  timeoutMs: number;
  liveOrderingEnabled: boolean;
  /** True when the transport is plain HTTP, i.e. credentials in the clear. */
  insecureTransport: boolean;
}

/** Trimmed, because a pasted trailing newline breaks an HTTP header. */
function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function readEnvironment(prefix: string): GatewayEnvironment {
  const raw = readEnv(`${prefix}_GATEWAY_ENV`).toLowerCase();
  // Anything unrecognised resolves to 'test'. The failure mode of guessing
  // wrong must be "talked to the sandbox", never "talked to production".
  return raw === "production" ? "production" : "test";
}

/**
 * The live-ordering flag.
 *
 * Only the exact string "true" enables it. An unset, misspelled or empty
 * value leaves ordering disabled, so the flag fails closed.
 */
function readLiveOrdering(prefix: string): boolean {
  return readEnv(`${prefix}_LIVE_ORDERING_ENABLED`).toLowerCase() === "true";
}

export interface GatewayConfigReport {
  partner: GatewayPartner;
  environment: GatewayEnvironment;
  configured: boolean;
  missing: string[];
  baseUrl: string;
  /** Never the number itself — only whether one is present. */
  customerNumberPresent: boolean;
  usernamePresent: boolean;
  passwordPresent: boolean;
  liveOrderingEnabled: boolean;
  insecureTransport: boolean;
  timeoutMs: number;
}

/**
 * Reports configuration health without revealing any of it. Mirrors
 * describeEmailConfig() in src/lib/email/send-quote-request.ts — the same
 * problem (a deployment that silently cannot talk to a third party) deserves
 * the same answer.
 */
export function describeGatewayConfig(partner: GatewayPartner): GatewayConfigReport {
  const prefix = PREFIX[partner];
  const environment = readEnvironment(prefix);
  const baseUrl = readEnv(`${prefix}_GATEWAY_BASE_URL`) || DEFAULT_BASE_URLS[partner][environment];

  const customerNumber = readEnv(`${prefix}_GATEWAY_CUSTOMER_NUMBER`);
  const username = readEnv(`${prefix}_GATEWAY_USERNAME`);
  const password = readEnv(`${prefix}_GATEWAY_PASSWORD`);

  const missing: string[] = [];
  if (!customerNumber) missing.push(`${prefix}_GATEWAY_CUSTOMER_NUMBER`);
  if (!username) missing.push(`${prefix}_GATEWAY_USERNAME`);
  if (!password) missing.push(`${prefix}_GATEWAY_PASSWORD`);

  const timeoutRaw = Number(readEnv(`${prefix}_GATEWAY_TIMEOUT_MS`));
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : DEFAULT_TIMEOUT_MS;

  return {
    partner,
    environment,
    configured: missing.length === 0,
    missing,
    baseUrl,
    customerNumberPresent: Boolean(customerNumber),
    usernamePresent: Boolean(username),
    passwordPresent: Boolean(password),
    liveOrderingEnabled: readLiveOrdering(prefix),
    insecureTransport: baseUrl.startsWith("http://"),
    timeoutMs,
  };
}

/**
 * Resolves the full configuration, credentials included.
 *
 * Throws rather than returning a partial config: a client built from
 * half-configured credentials would fail at the supplier with an opaque
 * error, long after the actual mistake.
 */
export function resolveGatewayConfig(partner: GatewayPartner): ResolvedGatewayConfig {
  const report = describeGatewayConfig(partner);
  if (!report.configured) {
    throw new GatewayError(
      "configuration",
      `Inter-Sprint gateway is not configured for '${partner}': missing ${report.missing.join(", ")}`,
      { context: { partner, environment: report.environment } }
    );
  }

  const prefix = PREFIX[partner];
  return {
    partner,
    environment: report.environment,
    baseUrl: report.baseUrl,
    customerNumber: readEnv(`${prefix}_GATEWAY_CUSTOMER_NUMBER`),
    username: readEnv(`${prefix}_GATEWAY_USERNAME`),
    password: readEnv(`${prefix}_GATEWAY_PASSWORD`),
    timeoutMs: report.timeoutMs,
    liveOrderingEnabled: report.liveOrderingEnabled,
    insecureTransport: report.insecureTransport,
  };
}

export { DEFAULT_BASE_URLS };
