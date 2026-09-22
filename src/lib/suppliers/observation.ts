// Supplier observations: provenance, classification and freshness.
//
// Supplier-generic on purpose. Deldo's hourly CSV feed, an Inter-Sprint
// catalogue upload and an operator typing a price they were quoted on the
// phone are all the same thing here — somebody observed a supplier's price and
// stock at a moment in time. What differs is provenance, and provenance is
// data, not a separate code path.
//
// One rule runs through the whole file: AN OBSERVATION IS NOT AVAILABILITY.
// A price and a stock figure are evidence about the past. Whether they may be
// used for a commercial decision depends on how old they are, whether they are
// complete, and whether they describe the real world at all. Callers ask
// classifyObservation() rather than reading `observedAt` and deciding for
// themselves, so that judgement exists in exactly one place.

/** How the observation reached us. */
export type ObservationSource =
  /** A bulk file: Deldo's hourly CSV, an Inter-Sprint catalogue upload. */
  | "bulk_feed"
  /** A live per-product call, e.g. Deldo GET_STOCK. */
  | "live_lookup"
  /** An operator recorded it by hand. */
  | "manual";

/**
 * Whether the observation describes the real commercial world.
 *
 * `test` is not a lesser grade of `live` — it is a different kind of thing.
 * Deldo's 26933TEST.csv carries fictional prices and quantities, supplied so
 * the integration can be built before real data flows. A fictional price that
 * reaches a customer, a purchase order or an accounting record is the most
 * expensive failure this integration can produce, and it would look completely
 * normal on the way there.
 *
 * So the classification travels WITH the observation rather than being a
 * property of the environment that read it. A test file imported into
 * production must still be test data.
 */
export type DataClassification = "live" | "test";

export const DATA_CLASSIFICATIONS: readonly DataClassification[] = ["live", "test"];

/**
 * Runtime guard for a data classification.
 *
 * The TypeScript type is erased at build time, so it protects nothing at the
 * edge of the system. The moment supplier data arrives over HTTP, from a form
 * upload, from a scheduler payload or from JSON on disk, `classification` is
 * whatever the caller happened to send — including `undefined`, `"LIVE"`, or
 * `"production"` — and the compiler has already stopped looking.
 *
 * This is the one place that decides, and it FAILS CLOSED:
 *
 *   - there is NO default and no fallback to "live";
 *   - matching is exact and case-sensitive, so "Live"/"LIVE"/"TEST" are
 *     rejected rather than helpfully coerced. A caller that cannot spell its
 *     own classification has not proven which one it means;
 *   - nothing is inferred from a filename, a directory, an FTP location, an
 *     environment variable or a supplier account. Every one of those has been
 *     wrong somewhere: a test file can sit in a live directory, and a live file
 *     can be replayed from a developer's laptop.
 *
 * Refusing an unknown value is the safe direction. The expensive failure is a
 * fictional price that looks completely normal all the way to an invoice.
 */
export class DataClassificationError extends Error {
  readonly received: unknown;
  constructor(context: string, received: unknown) {
    super(
      `${context}: data classification must be exactly "live" or "test", ` +
        `received ${describeClassificationValue(received)}. ` +
        "There is no default - a caller that cannot state whether supplier data " +
        "is real or fictional must not import it."
    );
    this.name = "DataClassificationError";
    this.received = received;
  }
}

function describeClassificationValue(value: unknown): string {
  if (value === undefined) return "undefined (absent)";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  return `${typeof value}`;
}

export function isDataClassification(value: unknown): value is DataClassification {
  return value === "live" || value === "test";
}

/** Narrows an untrusted value, or throws. Never returns a default. */
export function assertDataClassification(
  value: unknown,
  context: string
): DataClassification {
  if (!isDataClassification(value)) {
    throw new DataClassificationError(context, value);
  }
  return value;
}

/**
 * What a feed's price actually includes.
 *
 * Deldo's documentation describes two commercial feed modes: the tyre price
 * with transport charged separately, or transport already included in the tyre
 * price for a specified destination country. Which one GoRush receives is NOT
 * yet confirmed.
 *
 * The same number means two different things under the two modes, and nothing
 * in the number itself says which. Recording `unknown` keeps that ambiguity
 * visible instead of silently resolving it — a price whose meaning is unknown
 * must not reach a margin calculation.
 */
export type FeedCommercialMode =
  | "transport_separate"
  | "transport_included"
  | "unknown";

export const FEED_COMMERCIAL_MODES: readonly FeedCommercialMode[] = [
  "transport_separate",
  "transport_included",
  "unknown",
];

export function isFeedCommercialMode(value: unknown): value is FeedCommercialMode {
  return (
    value === "transport_separate" ||
    value === "transport_included" ||
    value === "unknown"
  );
}

/**
 * Narrows an untrusted commercial mode, or throws.
 *
 * Note that `"unknown"` is a VALID mode and must be stated explicitly. It is
 * not the same as omitting the field: "unknown" records that we know we do not
 * know, which downstream code already treats as blocking for margin. An absent
 * value records nothing at all and is refused here.
 */
export function assertFeedCommercialMode(
  value: unknown,
  context: string
): FeedCommercialMode {
  if (!isFeedCommercialMode(value)) {
    throw new DataClassificationError(
      `${context}: commercial mode must be one of ${FEED_COMMERCIAL_MODES.join(", ")}`,
      value
    );
  }
  return value;
}

/**
 * Supplier-reported stock condition. This is deliberately factual, not policy:
 * a non-empty DOT field means the supplier separated that listing as older-DOT
 * stock; Demo means the supplier supplied its Demo marker. We do not infer an
 * age threshold or what "Demo" means commercially.
 *
 * null is allowed for sources such as GET_STOCK that do not report condition.
 */
export type StockCondition = "normal" | "older_dot" | "demo";

/** One supplier price/stock observation, normalized across all lanes. */
export interface SupplierObservation {
  /** Which supplier lane this came from, e.g. 'deldo'. */
  readonly laneCode: string;

  /**
   * Exact supplier listing identity. Required so an observation remains safe
   * when detached from its import row. Never reconstruct this from EAN: one EAN
   * may legitimately have multiple supplier listings with different condition
   * and price.
   */
  readonly supplierListingKey: string;
  readonly supplierArticleId: string;

  /** Source facts about condition; null means the source did not report them. */
  readonly dotYear: string | null;
  readonly demo: boolean | null;
  readonly stockCondition: StockCondition | null;
  readonly classification: DataClassification;
  readonly source: ObservationSource;
  readonly observedAt: Date;

  /** Supplier purchase price. Null means not supplied, never zero. */
  readonly purchasePrice: number | null;
  readonly currency: string | null;

  /**
   * Stock as an exact count where the supplier gave one.
   *
   * Zero is a real, useful answer: the supplier has none. It is NOT the same
   * as null, which means the supplier did not say. Collapsing the two would
   * turn "unknown" into "out of stock" or worse.
   */
  readonly stockExact: number | null;
  /** Whatever the source supplied, verbatim, for audit. */
  readonly stockRaw: string | null;

  readonly commercialMode: FeedCommercialMode;
}

/**
 * Why an observation cannot support a commercial decision.
 *
 * Separate from the state so a caller can log or display the cause without
 * re-deriving it.
 */
export type UnusableReason =
  | "no_observation"
  | "missing_price"
  | "unknown_stock"
  | "unknown_commercial_mode"
  | "unverified_demo"
  | "observed_in_future";

export type ObservationState =
  /** Recent, complete, and describes the real world. */
  | { readonly state: "current"; readonly ageMs: number }
  /** Real and complete, but old enough that it may no longer hold. */
  | { readonly state: "stale"; readonly ageMs: number }
  /**
   * Describes fictional data. Never usable commercially, at any age.
   * Deliberately its own state rather than a flavour of unusable, so it cannot
   * be swept into a generic "no data" branch and forgotten.
   */
  | { readonly state: "test_data" }
  | { readonly state: "no_usable_observation"; readonly reason: UnusableReason };

/**
 * How old an observation may be before it stops counting as current.
 *
 * Required, with no default anywhere in this module. A default would be a
 * commercial promise about availability chosen by whoever wrote the code, and
 * the correct value differs per lane: Deldo documents an hourly feed, an
 * Inter-Sprint catalogue upload is manual and irregular, a phone quote is good
 * for as long as the supplier said it was.
 */
export interface FreshnessPolicy {
  readonly staleAfterMs: number;
}

/**
 * Deldo's documented feed cadence: the price and stock CSV is updated on the
 * FTP server every hour.
 *
 * This is a SUPPLIER-DOCUMENTED FACT about how often data arrives. It is not a
 * freshness policy and must not be used as one — how long GommaRush is willing
 * to rely on an hour-old price is a commercial decision, not a consequence of
 * the publishing schedule.
 */
export const DELDO_DOCUMENTED_FEED_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Classifies an observation for commercial use.
 *
 * Check order is the safety property, not a detail:
 *
 *   1. absent           — nothing to judge
 *   2. TEST DATA        — before anything else, and regardless of everything else
 *   3. incomplete       — a missing price or unknown stock cannot be reasoned about
 *   4. age              — only then does freshness matter
 *
 * Test data is checked before completeness and before age so that no
 * combination of inputs can produce `current` for a fictional row. A fresh,
 * complete, well-formed test observation is exactly the case that would slip
 * through a check written in the obvious order.
 */
export function classifyObservation(
  observation: SupplierObservation | null | undefined,
  policy: FreshnessPolicy,
  now: Date
): ObservationState {
  if (!observation) {
    return { state: "no_usable_observation", reason: "no_observation" };
  }

  if (observation.classification === "test") {
    return { state: "test_data" };
  }

  if (observation.purchasePrice === null) {
    return { state: "no_usable_observation", reason: "missing_price" };
  }

  // Zero stock is a known answer and stays usable; only an absent one is not.
  if (observation.stockExact === null) {
    return { state: "no_usable_observation", reason: "unknown_stock" };
  }

  // A price whose commercial meaning is unresolved cannot be compared or
  // marked up: under one Deldo feed mode it already contains transport, under
  // the other it does not.
  if (observation.commercialMode === "unknown") {
    return { state: "no_usable_observation", reason: "unknown_commercial_mode" };
  }

  // Deldo has not yet defined what its Demo marker means or its disclosure /
  // warranty implications. A Demo observation therefore fails closed even when
  // price, stock and freshness are otherwise valid.
  if (observation.demo === true || observation.stockCondition === "demo") {
    return { state: "no_usable_observation", reason: "unverified_demo" };
  }

  const ageMs = now.getTime() - observation.observedAt.getTime();

  // A timestamp in the future means a clock or a parser is wrong. Treating it
  // as maximally fresh would make the broken case the most trusted one.
  if (ageMs < 0) {
    return { state: "no_usable_observation", reason: "observed_in_future" };
  }

  return ageMs > policy.staleAfterMs
    ? { state: "stale", ageMs }
    : { state: "current", ageMs };
}

/**
 * True only for an observation that may drive a commercial decision — a
 * customer-facing availability claim, a sourcing choice or a purchase.
 *
 * Deliberately narrow: `stale` is excluded. Whether a stale price may be shown
 * with a caveat is a product decision, and this predicate is not the place to
 * make it.
 */
export function isCommerciallyUsable(state: ObservationState): boolean {
  return state.state === "current";
}

/**
 * The guard for any path that commits GommaRush to money or to a customer
 * promise. Throws rather than returning false, because the cost of the caller
 * ignoring a boolean here is a real order at a fictional price.
 */
export function assertCommerciallyUsable(
  state: ObservationState,
  context: string
): void {
  if (state.state === "current") return;

  const detail =
    state.state === "no_usable_observation" ? `: ${state.reason}` : "";
  throw new Error(
    `${context}: refusing to use a supplier observation in state '${state.state}'${detail}`
  );
}

/**
 * Removes test observations from a set.
 *
 * Exists so the exclusion is one named, tested operation rather than a
 * `.filter()` repeated at each call site — the kind of line that is correct
 * everywhere it appears until the one place someone forgets it.
 */
export function excludeTestObservations(
  observations: readonly SupplierObservation[]
): SupplierObservation[] {
  return observations.filter((o) => o.classification !== "test");
}


/**
 * Lane policy registry used by callers that classify supplier observations.
 * There is intentionally no default and no Deldo hard-coded threshold:
 * documented publishing cadence is not the same thing as GommaRush's
 * commercial freshness tolerance.
 */
export type FreshnessPolicies = Readonly<Record<string, FreshnessPolicy>>;

export function freshnessPolicyForLane(
  laneCode: string,
  policies: FreshnessPolicies
): FreshnessPolicy {
  const policy = policies[laneCode];
  if (!policy || !Number.isFinite(policy.staleAfterMs) || policy.staleAfterMs < 0) {
    throw new Error(`No valid freshness policy configured for supplier lane '${laneCode}'`);
  }
  return policy;
}

export function classifyObservationForLane(
  observation: SupplierObservation | null | undefined,
  policies: FreshnessPolicies,
  now: Date
): ObservationState {
  if (!observation) {
    return { state: "no_usable_observation", reason: "no_observation" };
  }
  return classifyObservation(
    observation,
    freshnessPolicyForLane(observation.laneCode, policies),
    now
  );
}
