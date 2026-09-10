// Gateway URL construction.
//
// Manual §1.1:
//   <base>/scripts/cgirpc32.dll/ww0800?<protocol>,<parameters>
//
// The encoding rules in §1.3 are unusual enough to be worth stating, because
// each is a way to corrupt a request silently rather than loudly:
//
//   * Anything outside [0-9a-zA-Z] must be percent-encoded.
//   * '_' is destroyed: "all underscores will be replaced by a blank". A
//     value containing one arrives at the supplier different from what was
//     sent, with no error.
//   * ';' separates COMMANDS. A stray one in a value makes the gateway read
//     the rest of the request as a second command, "leading to unpredictable
//     results". The manual's own advice is not to combine commands at all,
//     which this module enforces by refusing the character outright.
//   * The whole URL must stay under 1800 characters (error 98).
//
// Pure and dependency-free.

import { GatewayError } from "@/lib/suppliers/gateway/errors";
import { PROTOCOLS, TEST_MODE_PARAM, TEST_MODE_VALUE, type GatewayProtocol } from "@/lib/suppliers/gateway/protocols";

/** §1.2: "The maximum length is 1800 characters." */
export const MAX_URL_LENGTH = 1800;

/** The fixed script path every gateway call goes through. §1.1 */
export const GATEWAY_PATH = "/scripts/cgirpc32.dll/ww0800";

export type GatewayParams = Record<string, string | number | null | undefined>;

/**
 * Percent-encodes a parameter value for the gateway.
 *
 * encodeURIComponent leaves `_` and `!*'()~` unescaped, and `_` is the one
 * character the gateway silently rewrites, so it is escaped explicitly.
 */
export function encodeGatewayValue(value: string): string {
  return encodeURIComponent(value).replace(/[_!*'()~]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`
  );
}

function assertNoCommandSeparator(key: string, value: string): void {
  if (value.includes(";")) {
    throw new GatewayError(
      "configuration",
      `parameter '${key}' contains ';', which the gateway reads as a command separator`
    );
  }
}

export interface BuildUrlInput {
  /** Base origin, e.g. "http://test-001.inter-sprint.nl". No trailing slash. */
  baseUrl: string;
  protocol: GatewayProtocol;
  /** key=value arguments, joined with '&'. Used by 103, 104, 112, 115. */
  params?: GatewayParams;
  /**
   * Comma-separated positional arguments, for the protocols that take them.
   * Protocol 11 is the live example: `ww0800?11,<customer>,<from>,<to>` (§5.2).
   * Passing these through the key=value path would produce a URL the gateway
   * silently misreads, so the two forms are kept distinct.
   */
  positional?: readonly string[];
  /**
   * Whether live ordering is permitted. When false, an order-kind protocol
   * may only be built with test=1 — see the guard below.
   */
  liveOrderingEnabled: boolean;
}

/**
 * Builds a full gateway URL.
 *
 * The ordering guard here is deliberate duplication: the client already
 * refuses to place an order while the flag is off. This is the second lock,
 * at the last point before a URL exists, so no future code path can assemble
 * a live order request by going round the client.
 */
export function buildGatewayUrl(input: BuildUrlInput): string {
  const { baseUrl, protocol, params = {}, positional, liveOrderingEnabled } = input;

  const isTestMode = String(params[TEST_MODE_PARAM] ?? "") === TEST_MODE_VALUE;
  if (protocol.kind === "order" && !isTestMode && !liveOrderingEnabled) {
    throw new GatewayError(
      "ordering_disabled",
      `refusing to build a live ${protocol.code} order URL: live ordering is disabled`
    );
  }

  let query: string;
  if (positional && positional.length > 0) {
    for (const value of positional) assertNoCommandSeparator(protocol.code, value);
    query = positional.map(encodeGatewayValue).join(",");
  } else {
    const parts: string[] = [];
    for (const [key, raw] of Object.entries(params)) {
      if (raw === null || raw === undefined || raw === "") continue;
      const value = String(raw);
      assertNoCommandSeparator(key, value);
      parts.push(`${encodeGatewayValue(key)}=${encodeGatewayValue(value)}`);
    }
    query = parts.join("&");
  }

  // §1.1: the protocol is separated from its arguments by a comma.
  const url = `${baseUrl.replace(/\/+$/, "")}${GATEWAY_PATH}?${protocol.code}${query ? `,${query}` : ""}`;

  if (url.length > MAX_URL_LENGTH) {
    throw new GatewayError(
      "request_too_long",
      `gateway URL is ${url.length} characters, over the ${MAX_URL_LENGTH} limit`,
      { gatewayCode: "98" }
    );
  }

  return url;
}

/** Convenience: the stock-search URL for a single EAN. §2.1, `artc=E=<ean>`. */
export function stockByEanParams(customerNumber: string, ean: string): GatewayParams {
  return { kl: customerNumber, artc: `E=${ean}` };
}

/** Stock for one article system number. §2.1, `artc=S=<number>`. */
export function stockBySystemNumberParams(customerNumber: string, systemNumber: string): GatewayParams {
  return { kl: customerNumber, artc: `S=${systemNumber}` };
}

export { PROTOCOLS };
