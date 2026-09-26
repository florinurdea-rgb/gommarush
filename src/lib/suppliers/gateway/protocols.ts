// Inter-Sprint / Inter-Tyre Gateway protocol registry.
//
// Every entry is transcribed from the Gateway Manual v2.2 (Moerdijk, August
// 2018). The paragraph reference on each protocol is the citation — if a
// value here is ever questioned, that is where to check it.
//
// `kind` is the safety-relevant field. "order" means the call can create a
// real, billable order at the supplier, and the client refuses those unless
// live ordering has been explicitly enabled. Everything else is read-only.

export type ProtocolKind = "read" | "order";

export interface GatewayProtocol {
  /** The numeric protocol id, as it appears after `ww0800?`. */
  readonly code: string;
  readonly name: string;
  readonly kind: ProtocolKind;
  /** Paragraph in the manual, so a reader can verify the syntax. */
  readonly manualRef: string;
  /** Which company offers it. Some are Inter-Tyre only. */
  readonly availableFor: readonly GatewayPartner[];
}

export type GatewayPartner = "intersprint" | "intertyre";

export const GATEWAY_PARTNERS: readonly GatewayPartner[] = ["intersprint", "intertyre"];

const BOTH: readonly GatewayPartner[] = ["intersprint", "intertyre"];

/**
 * The protocols this integration uses. Deliberately not the full list from
 * the manual: an unused protocol here would be untested surface area, and
 * the obsolete ones (1, 2, 3, 4, 5) are explicitly superseded by 103/104/105
 * in the manual's own words ("in service-only phase, please use ...").
 */
export const PROTOCOLS = {
  /** Extended stock search, incl. external warehouses. §2.1 */
  STOCK_SEARCH: {
    code: "103",
    name: "Extended stock search",
    kind: "read",
    manualRef: "§2.1",
    availableFor: BOTH,
  },
  /** Order entry extended. §4.1 — the only protocol that can place an order. */
  ORDER_ENTRY: {
    code: "104",
    name: "Order entry extended",
    kind: "order",
    manualRef: "§4.1",
    availableFor: BOTH,
  },
  /** Packing lists / delivery notes. §5.1 */
  DELIVERY_NOTES: {
    code: "112",
    name: "Packing lists and delivery notes",
    kind: "read",
    manualRef: "§5.1",
    availableFor: BOTH,
  },
  /** Invoice data. §5.2 */
  INVOICES: {
    code: "11",
    name: "Invoice data",
    kind: "read",
    manualRef: "§5.2",
    availableFor: BOTH,
  },
  /** Gateway error message list. §5.6 */
  ERROR_LIST: {
    code: "15",
    name: "Gateway error messages",
    kind: "read",
    manualRef: "§5.6",
    availableFor: BOTH,
  },
  /** Delivery costs per delivery method. §5.7 */
  DELIVERY_PRICES: {
    code: "115",
    name: "Delivery prices per method",
    kind: "read",
    manualRef: "§5.7",
    availableFor: BOTH,
  },
  /** Delivery addresses of the login. §5.8 */
  DELIVERY_ADDRESSES: {
    code: "116",
    name: "Delivery addresses",
    kind: "read",
    manualRef: "§5.8",
    availableFor: BOTH,
  },
  /** Company data. §5.9 */
  COMPANY_DATA: {
    code: "117",
    name: "Company data",
    kind: "read",
    manualRef: "§5.9",
    availableFor: BOTH,
  },
} as const satisfies Record<string, GatewayProtocol>;

export type ProtocolName = keyof typeof PROTOCOLS;

/**
 * The parameter that turns a 104 into a dry run. §4.2: "Adding the parameter
 * 'test=1' to the order entry causes the gateway to process and validate the
 * command without actually placing an order."
 */
export const TEST_MODE_PARAM = "test";
export const TEST_MODE_VALUE = "1";
