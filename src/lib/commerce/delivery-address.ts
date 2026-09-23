// Whether a stored delivery location is a real address.
//
// WHY THIS EXISTS. `customer_locations.address_line1` and `.city` are NOT NULL,
// so document import and quick customer creation satisfy them with a visible
// placeholder rather than a fabricated street name — see createCustomerLocation
// in src/lib/server/customers.ts, which writes "—" for both. That is the right
// choice for master data: an obviously-wrong value is safe, an invented one is
// not.
//
// It stops being safe the moment a customer can pick a location at checkout.
// A commercial order carrying "—, —" is a delivery GommaRush cannot make and a
// commitment it cannot honour, so checkout must refuse it.
//
// Central on purpose. This rule was written twice — once in the checkout page's
// filter and once in the order engine — and the two copies already disagreed
// about which placeholders counted. The server copy is the one that matters;
// the UI filter is a courtesy. They must be the same function.
//
// Pure: no database, no I/O.

/**
 * Values that mean "no address was known", not an address.
 *
 * Both dash forms are here because the placeholder is written as an em dash
 * and typed by operators as a hyphen. A single dot is the other thing people
 * put in a required field they cannot fill.
 */
const PLACEHOLDERS = new Set(["—", "–", "-", "--", ".", "n/a", "na", "nd", "n.d."]);

/** True when a single address field carries real content. */
export function isRealAddressField(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return false;
  return !PLACEHOLDERS.has(trimmed.toLowerCase());
}

export interface DeliveryAddressFields {
  readonly address_line1?: string | null;
  readonly city?: string | null;
}

/**
 * True when a location can receive a commercial delivery.
 *
 * Street and city only. Postal code and province are frequently absent from
 * legitimate imported addresses, and refusing those would block real customers
 * to catch a problem this does not have.
 */
export function isDeliverableLocation(location: DeliveryAddressFields | null | undefined): boolean {
  if (!location) return false;
  return isRealAddressField(location.address_line1) && isRealAddressField(location.city);
}
