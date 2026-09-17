import "server-only";
import { InterSprintGatewayClient, type GatewayClientDeps } from "@/lib/suppliers/gateway/client";
import { describeGatewayConfig, resolveGatewayConfig } from "@/lib/suppliers/gateway/config";
import type { GatewayPartner } from "@/lib/suppliers/gateway/protocols";

/**
 * Server-only entry point to the supplier gateway.
 *
 * The `server-only` import above is the enforcement, not a convention: it
 * makes importing this module from a client component a BUILD error rather
 * than a runtime credential leak. Gateway credentials exist only in
 * environment variables read here, and no NEXT_PUBLIC_ variable is involved
 * anywhere in this integration.
 *
 * Everything that talks to Inter-Sprint or Inter-Tyre goes through this file.
 */

export function getGatewayClient(
  partner: GatewayPartner,
  deps: GatewayClientDeps = {}
): InterSprintGatewayClient {
  return new InterSprintGatewayClient(resolveGatewayConfig(partner), deps);
}

/**
 * Configuration health for both partners, safe to render in an admin screen:
 * it reports what is missing and never what is set.
 */
export function describeAllGatewayConfigs() {
  return {
    intersprint: describeGatewayConfig("intersprint"),
    intertyre: describeGatewayConfig("intertyre"),
  };
}

export { describeGatewayConfig };
export type { GatewayPartner };
