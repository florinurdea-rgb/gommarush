// Deldo API configuration.
//
// Resolved from environment variables only, server-side only. Nothing here is
// ever imported into client code, and no function returns a token in a value
// that is meant for display or logging.
//
// The test endpoint is documented and therefore defaulted:
//   https://api-test.deldo.be/gaston/dotcube_cgi
//
// The LIVE endpoint is NOT documented — "after testing procedure you will
// receive the URL for the live environment". It is therefore required
// configuration with no default. An environment that asks for live without
// supplying the URL Deldo gave it fails closed rather than inventing a
// hostname, which is the one failure mode that could send a real order
// somewhere unintended.

import { DeldoApiError } from "@/lib/suppliers/deldo/get-stock/errors";

export type DeldoEnvironment = "test" | "live";

/** Documented in the Deldo API PDF, get_stock section. */
export const DELDO_TEST_BASE_URL = "https://api-test.deldo.be/gaston/dotcube_cgi";

const DEFAULT_TIMEOUT_MS = 15_000;

export interface ResolvedDeldoConfig {
  readonly environment: DeldoEnvironment;
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;
  /**
   * Whether observations from this environment describe the real world.
   *
   * The test environment serves the same fictional data as 26933TEST.csv, so
   * anything it returns is test data by construction. Deriving this from the
   * environment rather than leaving it to callers means a live-looking price
   * from the sandbox cannot be recorded as commercial fact.
   */
  readonly classification: "live" | "test";
}

function readEnv(name: string): string {
  // Trimmed: a pasted trailing newline in a token silently breaks a URL.
  return (process.env[name] ?? "").trim();
}

/**
 * Anything unrecognised resolves to 'test'.
 *
 * The failure mode of guessing wrong must be "talked to the sandbox", never
 * "talked to production" — the same rule the Inter-Sprint gateway follows.
 */
export function readDeldoEnvironment(): DeldoEnvironment {
  return readEnv("DELDO_API_ENVIRONMENT").toLowerCase() === "live" ? "live" : "test";
}

export interface DeldoConfigReport {
  readonly environment: DeldoEnvironment;
  readonly configured: boolean;
  readonly missing: readonly string[];
  readonly baseUrl: string | null;
  /** Never the token — only whether one is present. */
  readonly tokenPresent: boolean;
  readonly timeoutMs: number;
  readonly classification: "live" | "test";
}

/**
 * Reports configuration health without revealing any of it. Safe to render on
 * an admin screen and safe to log.
 */
export function describeDeldoConfig(): DeldoConfigReport {
  const environment = readDeldoEnvironment();
  const token = readEnv("DELDO_API_TOKEN");
  const configuredBaseUrl = readEnv("DELDO_API_BASE_URL");

  const baseUrl =
    configuredBaseUrl || (environment === "test" ? DELDO_TEST_BASE_URL : "");

  const missing: string[] = [];
  if (!token) missing.push("DELDO_API_TOKEN");
  if (!baseUrl) missing.push("DELDO_API_BASE_URL");

  const timeoutRaw = Number(readEnv("DELDO_API_TIMEOUT_MS"));
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : DEFAULT_TIMEOUT_MS;

  return {
    environment,
    configured: missing.length === 0,
    missing,
    baseUrl: baseUrl || null,
    tokenPresent: Boolean(token),
    timeoutMs,
    classification: environment === "live" ? "live" : "test",
  };
}

/**
 * Resolves the full configuration, token included.
 *
 * Throws rather than returning something partial: a client built from a
 * half-configured environment fails at the supplier with an opaque error, long
 * after the actual mistake.
 */
export function resolveDeldoConfig(): ResolvedDeldoConfig {
  const report = describeDeldoConfig();

  if (!report.configured) {
    throw new DeldoApiError(
      "configuration",
      `Deldo API is not configured for '${report.environment}': missing ${report.missing.join(", ")}`
    );
  }

  const baseUrl = report.baseUrl as string;

  // HTTPS is required, not preferred. The token is a bearer credential carried
  // in the query string, so plain HTTP would put it in the clear on the wire
  // and in every intermediary's logs.
  if (!baseUrl.startsWith("https://")) {
    throw new DeldoApiError(
      "configuration",
      `Deldo API base URL must use HTTPS — refusing to send the API token over an insecure transport`
    );
  }

  return {
    environment: report.environment,
    baseUrl,
    token: readEnv("DELDO_API_TOKEN"),
    timeoutMs: report.timeoutMs,
    classification: report.classification,
  };
}
