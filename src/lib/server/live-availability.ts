import "server-only";
import { getGatewayClient } from "@/lib/server/supplier-gateway";
import { describeGatewayConfig } from "@/lib/suppliers/gateway/config";
import { toStockRow } from "@/lib/suppliers/gateway/response";
import { logError } from "@/lib/logger";
import type {
  AvailabilityProvenance,
  BasketLineAvailability,
  BasketResolvedLine,
} from "@/lib/server/customer-basket";

/**
 * The last check before an order is created.
 *
 * WHEN THIS RUNS, AND WHY ONLY THEN. Owner decision, 2026-09-24: the live
 * supplier lookup happens at the FINAL CONFIRM and nowhere else. Quantity
 * edits in the basket and on the checkout screen re-resolve against the
 * stored feed instead — instant, free, and accurate to the last import.
 *
 * The reason for the restriction is not performance. The Inter-Sprint gateway
 * is documented as plain HTTP (§1.1, `http://customers.inter-sprint.nl`) and
 * the credentials travel in the clear on every call; that is already recorded
 * as security finding 2. One call per basket line at the single moment a
 * promise is actually made is a very different exposure from one per
 * keystroke, and it buys the same guarantee — the figure is checked at the
 * instant it starts to matter.
 *
 * WHAT IT CALLS. Protocol 103, "Extended stock search" (§2.1), addressed by
 * EAN. It is `kind: "read"`, it is not gated by the live-ordering flag, and it
 * cannot create an order. Protocol 104 is not referenced anywhere in this
 * file, in any form, including its test=1 validation mode.
 *
 * WHAT IT DOES NOT COVER. Only listings on the Inter-Sprint lane have a live
 * API. The `isb` lane — 3,289 active listings in production — has none, and
 * there is no honest way to invent one. Those lines keep their feed
 * observation and say so, which is the owner's recorded decision and better
 * than implying a check that cannot happen.
 *
 * FAILS OPEN, NEVER SILENTLY. Owner decision, 2026-09-24: a gateway that does
 * not answer must not stop GommaRush selling. The stored observation stands,
 * the line is marked `feed_after_live_failure` with the reason, and both the
 * checkout screen and the order snapshot carry that distinction. What is
 * forbidden is the third option — falling back while still telling the
 * customer the figure was verified live.
 */

/** How long the whole verification may take before the feed answer stands. */
const LIVE_BUDGET_MS = 6_000;

/** Lanes with a documented, implemented live stock lookup. */
const LIVE_LANES = new Set(["intersprint"]);

export interface LiveVerificationOutcome {
  readonly lines: readonly BasketResolvedLine[];
  /** True when at least one line was actually answered by the supplier. */
  readonly anyLive: boolean;
  /** True when a live lane was tried and did not answer. */
  readonly anyLiveFailure: boolean;
}

/**
 * Inter-Sprint's own availability figure for one EAN.
 *
 * `available` is column 9 of the protocol-103 row (§2.1). It is parsed
 * strictly: a value that is not a non-negative integer is NOT read as zero,
 * because "unparseable" and "none in stock" are different facts and treating
 * the first as the second would cancel an orderable line.
 */
function parseAvailable(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Re-decides one line's availability against a live quantity.
 *
 * Deliberately the SAME shape the feed path produces, so every screen and the
 * order route read one vocabulary regardless of where the number came from.
 */
function applyLiveQuantity(
  line: BasketResolvedLine,
  liveQuantity: number
): BasketLineAvailability {
  if (liveQuantity <= 0) return { state: "unavailable", reason: "out_of_stock" };
  if (liveQuantity >= line.input.quantity) return { state: "available" };
  return { state: "limited", availableQuantity: liveQuantity };
}

/**
 * Verifies a resolved basket against the supplier, line by line.
 *
 * Never throws. Every failure path ends in the feed answer this was given,
 * because the caller is about to create an order and an exception here would
 * turn a supplier hiccup into a lost sale.
 */
export async function verifyBasketLive(
  lines: readonly BasketResolvedLine[],
  now: () => number = Date.now
): Promise<LiveVerificationOutcome> {
  const deadline = now() + LIVE_BUDGET_MS;

  const fallback = (line: BasketResolvedLine, reason: string): BasketResolvedLine => ({
    ...line,
    provenance: {
      ...line.provenance,
      source: "feed_after_live_failure",
      liveFailureReason: reason,
    },
  });

  // Configuration is checked ONCE, before any call. An unconfigured gateway is
  // not a failure of this order — it is a deployment that has never had
  // credentials — so those lines stay plain `feed` rather than being marked as
  // a live lane that let us down.
  let configured = false;
  try {
    configured = describeGatewayConfig("intersprint").configured;
  } catch {
    configured = false;
  }
  if (!configured) return { lines: [...lines], anyLive: false, anyLiveFailure: false };

  const client = getGatewayClient("intersprint");

  const verified: BasketResolvedLine[] = [];
  let anyLive = false;
  let anyLiveFailure = false;

  for (const line of lines) {
    const lane = line.internal?.laneCode ?? null;
    const ean = line.internal?.ean ?? null;

    // No live lane, no EAN to address it with, or nothing priced to check:
    // the feed answer is the only answer there is, and it is already correct.
    if (line.internal === null || !lane || !LIVE_LANES.has(lane) || !ean) {
      verified.push(line);
      continue;
    }

    if (now() >= deadline) {
      anyLiveFailure = true;
      verified.push(fallback(line, "budget_exhausted"));
      continue;
    }

    try {
      const result = await client.stockByEan(ean);

      if (result.outcome.status !== "data") {
        anyLiveFailure = true;
        verified.push(
          fallback(
            line,
            result.outcome.status === "error"
              ? `gateway_${result.outcome.code}`
              : result.outcome.status
          )
        );
        continue;
      }

      const rows = result.outcome.rows.map(toStockRow);
      // The supplier answered about SOMETHING; make sure it was this tyre.
      // A lookup that returns the wrong article is worse than one that
      // returns nothing, which is the same rule the live probe applies.
      const row = rows.find((r) => r.fields.some((f) => f.trim() === ean)) ?? rows[0] ?? null;
      const quantity = row ? parseAvailable(row.available) : null;

      if (quantity === null) {
        anyLiveFailure = true;
        verified.push(fallback(line, row ? "unparseable_quantity" : "no_rows"));
        continue;
      }

      anyLive = true;
      const provenance: AvailabilityProvenance = {
        source: "live",
        observedAt: new Date(now()).toISOString(),
      };
      verified.push({
        ...line,
        availability: applyLiveQuantity(line, quantity),
        provenance,
      });
    } catch (error) {
      // Timeout, DNS, TLS, HTTP 5xx — the client throws GatewayError for all
      // of them. Logged with no credential and no basket content.
      anyLiveFailure = true;
      logError("live_availability_failed", error);
      verified.push(fallback(line, "transport"));
    }
  }

  return { lines: verified, anyLive, anyLiveFailure };
}
