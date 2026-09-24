import "server-only";
import { getGatewayClient } from "@/lib/server/supplier-gateway";
import { calculateTyrePrice } from "@/lib/pricing/calculate";
import { resolvePfu } from "@/lib/pricing/pfu";
import { DEFAULT_PRICING_SETTINGS } from "@/lib/pricing/settings";
import { toCustomerOffer, toInternalOffer } from "@/lib/pricing/projection";
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
 * WHEN THIS RUNS. Every basket preview and every order confirmation.
 *
 * This SUPERSEDES the earlier confirm-only restriction (D21, 2026-09-24).
 * That decision had quantity edits answered from the stored feed, and the
 * approved requirement is now explicit: a quantity change must be checked
 * against the real current price and quantity, not against imported catalogue
 * state. Anything less means a customer can reduce a line to a quantity the
 * feed believes is available, be told it is fine, and have the order refused
 * moments later by the check that actually counts.
 *
 * THE COST THAT RESTRICTION EXISTED TO BOUND IS STILL REAL. The Inter-Sprint
 * gateway is documented as plain HTTP (§1.1,
 * `http://customers.inter-sprint.nl`) and the credentials travel in the clear
 * on every call — security finding 2. Two things keep the call count sane
 * rather than removing the exposure: the client debounces typing, and the
 * per-EAN cache below collapses a burst of edits on one tyre into a single
 * lookup. Moving the gateway to HTTPS remains the actual fix and is the
 * supplier's to provide.
 *
 * WHAT IT CALLS. Protocol 103, "Extended stock search" (§2.1), addressed by
 * EAN. It is `kind: "read"`, it is not gated by the live-ordering flag, and it
 * cannot create an order. Protocol 104 is not referenced anywhere in this
 * file, in any form, including its test=1 validation mode.
 *
 * WHAT IT DOES NOT COVER. Only the Inter-Sprint lane has a live lookup today.
 * Both production adapters — `intersprint-feed` and the legacy `isb` workbook
 * — attribute to that one lane, so every active production listing is
 * verifiable. Deldo and Carlini are registered lanes with no implemented
 * lookup; a line on one of those keeps its stored observation and says so,
 * because there is no honest way to invent a check that does not exist.
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

/**
 * Whether this line COULD be verified live at all.
 *
 * The distinction the order gate turns on. A line on a lane with no live
 * lookup was never going to be asked; a line on a lane that HAS one and did
 * not answer is a different thing entirely.
 *
 * NOTE ON `isb`. Both the legacy workbook adapter (`isb`) and the live FTP
 * feed (`intersprint-feed`) attribute to the SAME `intersprint` lane — see
 * SUPPLIER_LANES — because they are one commercial relationship imported two
 * ways. So `isb` listings DO have a live lookup and are verified like any
 * other. Nothing in production currently sits on a lane without one; the
 * branch exists for Deldo and Carlini, which are registered and not yet live.
 */
function hasLiveLane(line: BasketResolvedLine): boolean {
  const lane = line.internal?.laneCode ?? null;
  return line.internal !== null && lane !== null && LIVE_LANES.has(lane);
}

/** True when a line needed a live answer and did not get one. */
export function liveVerificationMissing(lines: readonly BasketResolvedLine[]): boolean {
  return lines.some((line) => line.provenance.source === "feed_after_live_failure");
}

/**
 * How long one EAN's live answer is reused.
 *
 * THIS IS A CALL-RATE GUARD, NOT A FRESHNESS COMPROMISE. The window is short
 * enough that a wholesaler's stock cannot meaningfully move inside it, and it
 * exists because a customer nudging a quantity from 4 to 8 with the +
 * button fires several previews in a few seconds — each of which would
 * otherwise be its own plain-HTTP round trip carrying credentials.
 *
 * It caches the SUPPLIER'S ANSWER (quantity and price for an EAN), never a
 * verdict about a line. The requested quantity is compared against that answer
 * on every single request, so "reduce the quantity and it becomes available
 * again" still works within the window — same live figure, different question.
 *
 * A failure is never cached: the next request tries again.
 */
const LIVE_CACHE_MS = 20_000;

interface LiveAnswer {
  readonly quantity: number;
  readonly costCents: number | null;
  readonly at: number;
}

const liveCache = new Map<string, { value: LiveAnswer; expiresAt: number }>();

/** Test seam. Never called by application code. */
export function resetLiveAvailabilityCache(): void {
  liveCache.clear();
}

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
 * Inter-Sprint's own net price for one EAN, in cents.
 *
 * Column 7 of the protocol-103 row (§2.1). Parsed strictly and conservatively:
 * a value that is not a plain decimal is NOT read as zero or as free, because
 * a misparse here would reprice a tyre rather than merely fail to reprice it.
 * Both separators are accepted — the gateway is a Dutch system quoting a
 * European wholesaler, and neither convention can be assumed.
 */
export function parseNetPriceCents(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Re-prices one line from a live supplier cost.
 *
 * THROUGH THE SAME ENGINE, NOT BESIDE IT. `calculateTyrePrice` applies the
 * approved markup, the PFU and the VAT chain exactly as the catalogue did;
 * this only changes the cost it starts from. A second price path here would
 * be a second set of commercial rules, and the two would disagree the first
 * time either changed.
 *
 * PFU is re-resolved from the SAME weight, because PFU is a function of the
 * tyre, not of what it cost today.
 *
 * The customer projection is rebuilt with `toCustomerOffer`, so the live cost
 * has no field to travel in and cannot reach a customer payload.
 */
function repriceLine(line: BasketResolvedLine, liveCostCents: number): BasketResolvedLine {
  const internal = line.internal;
  if (!internal) return line;

  try {
    return rebuild(line, internal, liveCostCents);
  } catch (error) {
    /*
      A re-price that cannot be completed must NOT discard an answer the
      supplier gave us. The quantity was good; only the price could not be
      re-derived. The line keeps the price it already had and stays live.
    */
    logError("live_reprice_failed", error);
    return line;
  }
}

function rebuild(
  line: BasketResolvedLine,
  internal: NonNullable<BasketResolvedLine["internal"]>,
  liveCostCents: number
): BasketResolvedLine {

  const pfu = resolvePfu({
    weightKg: internal.weightKg,
    productClass: internal.tyre.productClass,
  });
  const breakdown = calculateTyrePrice(
    { supplierCostCents: liveCostCents, pfu },
    DEFAULT_PRICING_SETTINGS
  );

  const listing = {
    tyre: internal.tyre,
    availability: internal.availability,
    supplierListingId: internal.supplierListingId,
    supplierName: internal.supplierName,
    supplierArticleId: internal.supplierArticleId,
    laneCode: internal.laneCode,
    ean: internal.ean,
    weightKg: internal.weightKg,
    costObservedAt: internal.costObservedAt,
    breakdown,
    supplierStockExact: internal.supplierStockExact,
    supplierStockMinimum: internal.supplierStockMinimum,
    supplierStockRaw: internal.supplierStockRaw,
    sellability: {
      sellable: internal.sellable,
      reason: internal.sellabilityReason,
      assessedQuantity: internal.supplierStockExact ?? internal.supplierStockMinimum,
      minimumApplied: internal.minimumOfferQuantity,
    },
  };

  return {
    ...line,
    customer: toCustomerOffer(listing as never),
    internal: toInternalOffer(listing as never),
  };
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
 * Applies one supplier answer to one line: availability AND price.
 *
 * Both, because the approved requirement is that a quantity change is checked
 * against the real current price and quantity. Checking only the quantity
 * would let a customer agree to a figure the supplier has already moved away
 * from, and discover it at the order gate instead.
 *
 * Re-pricing is skipped when the cost is unchanged or unreadable, so the
 * common case does no work and a malformed price column cannot disturb a line.
 */
function applyLiveAnswer(line: BasketResolvedLine, answer: LiveAnswer): BasketResolvedLine {
  const provenance: AvailabilityProvenance = {
    source: "live",
    observedAt: new Date(answer.at).toISOString(),
  };

  const repriced =
    answer.costCents !== null && answer.costCents !== line.internal?.supplierCostCents
      ? repriceLine(line, answer.costCents)
      : line;

  return {
    ...repriced,
    availability: applyLiveQuantity(repriced, answer.quantity),
    provenance,
  };
}

/**
 * Verifies a resolved basket against the supplier, line by line.
 *
 * Never throws. Every failure path ends in the feed answer this was given,
 * because the caller is about to create an order and an exception here would
 * turn a supplier hiccup into a lost sale.
 */
export interface VerifyOptions {
  /**
   * Ignore the per-EAN cache and ask the supplier again.
   *
   * THE ORDER PATH ALWAYS SETS THIS. The cache exists so a burst of quantity
   * edits is one lookup rather than several, which is right for a screen the
   * customer is still deciding on. It is wrong for the moment they commit: a
   * cached answer from a basket preview seconds earlier would then stand in
   * for the authoritative final check, and the whole point of that check is
   * that it happens now.
   *
   * The fresh answer still refreshes the cache, so a retry after a price
   * change does not pay for a third lookup.
   */
  readonly forceFresh?: boolean;
}

export async function verifyBasketLive(
  lines: readonly BasketResolvedLine[],
  now: () => number = Date.now,
  options: VerifyOptions = {}
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

  /*
    Configuration is checked ONCE, before any call.

    MISSING CREDENTIALS ARE A VERIFICATION FAILURE, not a quiet pass. They
    used to leave every line on plain `feed`, which was indistinguishable from
    a lane that genuinely has no live lookup — so an unconfigured deployment
    looked exactly like a correctly-configured one and orders flowed through
    the live gate having never been near it. A line that HAS a live lane and
    did not get a live answer says so, whatever the reason.

    A line with no live lane at all is untouched: nothing was attempted, so
    nothing failed. See the `feed` / `feed_after_live_failure` split.
  */
  let configured = false;
  try {
    configured = describeGatewayConfig("intersprint").configured;
  } catch {
    configured = false;
  }
  if (!configured) {
    const marked = lines.map((line) =>
      hasLiveLane(line) ? fallback(line, "not_configured") : line
    );
    return {
      lines: marked,
      anyLive: false,
      anyLiveFailure: marked.some((l) => l.provenance.source === "feed_after_live_failure"),
    };
  }

  const client = getGatewayClient("intersprint");

  const verified: BasketResolvedLine[] = [];
  let anyLive = false;
  let anyLiveFailure = false;

  for (const line of lines) {
    const ean = line.internal?.ean ?? null;

    // No live lane at all: the stored answer is the only answer there is, and
    // it is already correct. Nothing was attempted, so nothing failed.
    if (!hasLiveLane(line)) {
      verified.push(line);
      continue;
    }

    /*
      A live lane with no EAN to address it with. This IS a failure: the lane
      can be asked, we simply cannot form the question, and treating it as a
      quiet pass would let the order gate believe it had been verified.
    */
    if (!ean) {
      anyLiveFailure = true;
      verified.push(fallback(line, "no_identifier"));
      continue;
    }

    if (now() >= deadline) {
      anyLiveFailure = true;
      verified.push(fallback(line, "budget_exhausted"));
      continue;
    }

    // The supplier's answer for this EAN, reused within a short window so a
    // burst of quantity edits on one tyre is one lookup rather than several.
    const cached = options.forceFresh ? undefined : liveCache.get(ean);
    if (cached && cached.expiresAt > now()) {
      anyLive = true;
      verified.push(applyLiveAnswer(line, cached.value));
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

      /*
        The price is read but is NOT allowed to fail the check.

        An unparseable price means "we could not re-price", not "this tyre is
        unavailable" — the quantity answer is still good and refusing the line
        over a malformed price column would turn a formatting quirk into a lost
        sale. The line simply keeps the price it already had.
      */
      const answer: LiveAnswer = {
        quantity,
        costCents: row ? parseNetPriceCents(row.netPrice) : null,
        at: now(),
      };
      liveCache.set(ean, { value: answer, expiresAt: now() + LIVE_CACHE_MS });

      anyLive = true;
      verified.push(applyLiveAnswer(line, answer));
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
