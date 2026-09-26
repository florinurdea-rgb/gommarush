// Deldo NV — supplier capability registry.
//
// Every entry is transcribed from the official Deldo integration documentation
// supplied by Jan Van Dyck (Deldo NV), received by the owner as
// "API documentation.pdf" alongside the sample feed "26933TEST.csv", under the
// subject "RE: Connect platform and orders for - 026933 (Go Rush Trasporti
// srl)". That correspondence is the authority for this lane. Nothing here is
// taken from another supplier's protocol, from a web source, or from a
// previous AI summary.
//
// TWO SEPARATE QUESTIONS, deliberately two separate fields:
//
//   documented  — the supplier says this capability exists
//   implemented — code exists here that can actually perform it
//
// They are not the same, and conflating them is how an integration comes to be
// believed complete while nothing has ever reached the supplier. A capability
// is usable only when BOTH are true; `isCapabilityAvailable` is the only thing
// that decides that, so the rule lives in one place.
//
// ABSENCE MEANS UNAVAILABLE. A capability missing from this registry is not
// "probably fine" — it is unavailable.

/** The shared capability vocabulary, common to every supplier lane. */
export type SupplierCapability =
  | "catalogue_feed"
  | "price_feed"
  | "stock_feed"
  | "live_stock_lookup"
  | "live_price_lookup"
  | "test_ordering"
  | "production_ordering"
  | "order_status"
  | "tracking"
  | "invoices"
  | "delivery_documents";

export interface CapabilityRecord {
  readonly capability: SupplierCapability;
  /** The supplier documents this capability as existing. */
  readonly documented: boolean;
  /** Code exists in this repository that can perform it. */
  readonly implemented: boolean;
  /** Why it is in this state. Cites the documentation where relevant. */
  readonly note: string;
}

export const DELDO_LANE_CODE = "deldo";

/** Supplier-assigned customer number for GoRush, from the correspondence. */
export const DELDO_CUSTOMER_NUMBER = "026933";

/**
 * The sample feed filename the supplier supplied, recorded so the import path
 * can recognise it. The supplier stated explicitly that it contains FICTIONAL
 * stocks and prices for testing and must not be used for real orders.
 */
export const DELDO_TEST_FEED_FILENAME = "26933TEST.csv";

export const DELDO_CAPABILITIES: readonly CapabilityRecord[] = [
  {
    capability: "catalogue_feed",
    documented: true,
    implemented: true,
    note:
      "Price & stock CSV, updated on the client's FTP server hourly. Parser written against the supplier's own 26933TEST.csv: 35 ';'-delimited columns, exact header match required. FTP transport itself is not yet wired.",
  },
  {
    capability: "price_feed",
    documented: true,
    implemented: true,
    note:
      "Price column parsed strictly. Which of the two documented commercial modes applies (transport separate, or transport included for a destination country) is NOT confirmed, so every observation carries commercialMode 'unknown' and cannot yet drive a commercial decision.",
  },
  {
    capability: "stock_feed",
    documented: true,
    implemented: true,
    note: "Stock column parsed strictly as a non-negative integer; zero is preserved as a real answer, distinct from absent.",
  },
  {
    capability: "live_stock_lookup",
    documented: true,
    implemented: true,
    note:
      "GET_STOCK. Implemented as response parsing and transport safety; cannot run until the live URL and token are supplied, which the documentation states follows successful testing.",
  },
  {
    capability: "live_price_lookup",
    documented: true,
    implemented: true,
    note:
      "GET_STOCK returns amount AND price, so it is a price verification as much as a stock check. Same implementation, same blocker.",
  },
  {
    capability: "test_ordering",
    documented: true,
    implemented: false,
    note:
      "CREATE_ORDER against the test environment. Deliberately not implemented. The supplier's rollout requires example XML to be validated by Deldo before any test call.",
  },
  {
    capability: "production_ordering",
    documented: true,
    implemented: false,
    note:
      "CREATE_ORDER (POST XML) creates an order directly in Deldo's ERP. DELIBERATELY DISABLED. Enabling it is an OWNER_DECISION and requires the supplier's green light after successful testing.",
  },
  {
    capability: "order_status",
    documented: true,
    implemented: false,
    note:
      "GET_ORDER_STATUS. Documented states: ordered, in progress, shipped, delivered, cancelled. Modelled for a later mission, not implemented.",
  },
  {
    capability: "tracking",
    documented: true,
    implemented: false,
    note:
      "GET_TRACKING. The documentation limits this to parcel-service deliveries; it must NOT be generalised to every Deldo delivery mode. Not implemented.",
  },
  {
    capability: "invoices",
    documented: true,
    implemented: false,
    note:
      "After shipment Deldo can supply PDF and CSV invoices via FTP, once per day in the evening. Belongs to a later fulfilment/accounting mission.",
  },
  {
    capability: "delivery_documents",
    documented: true,
    implemented: false,
    note:
      "CSV tracking file via FTP, once per day in the evening. Belongs to a later fulfilment/accounting mission.",
  },
];

const BY_CAPABILITY = new Map(DELDO_CAPABILITIES.map((c) => [c.capability, c]));

export function getDeldoCapability(
  capability: SupplierCapability
): CapabilityRecord | null {
  return BY_CAPABILITY.get(capability) ?? null;
}

/**
 * Whether a capability can actually be used.
 *
 * Requires documented AND implemented. An unregistered capability is
 * unavailable — the default answer is no, not "probably".
 */
export function isCapabilityAvailable(capability: SupplierCapability): boolean {
  const record = BY_CAPABILITY.get(capability);
  return record ? record.documented && record.implemented : false;
}

/**
 * Capabilities the supplier documents but we have not built.
 *
 * The honest gap. Useful on an operator screen and in a handoff, where the
 * interesting question is never what works but what does not yet.
 */
export function documentedButNotImplemented(): readonly SupplierCapability[] {
  return DELDO_CAPABILITIES.filter((c) => c.documented && !c.implemented).map(
    (c) => c.capability
  );
}

/**
 * Ordering capabilities, named so tests can assert the invariant directly.
 *
 * Both must remain unimplemented for the whole of this mission. This is the
 * one property worth asserting about code that does not exist: the guarantee
 * is that no code path can place a Deldo order, and the cheapest way to keep
 * that true through future edits is a test that fails the moment it stops
 * being true.
 */
export const DELDO_ORDERING_CAPABILITIES: readonly SupplierCapability[] = [
  "test_ordering",
  "production_ordering",
];
