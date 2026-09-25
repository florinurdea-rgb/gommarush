// Portal activation rules shared by the activation page and its route.
// Client-safe: no secrets, no I/O.

/** The customer's own password. Chosen on /account/attiva, never seen by an operator. */
export const MIN_CUSTOMER_PASSWORD_LENGTH = 10;
export const MAX_CUSTOMER_PASSWORD_LENGTH = 128;

/** Link types the activation page accepts: a first invite, or a reissued link. */
export const ACTIVATION_TYPES = ["invite", "recovery"] as const;
export type ActivationType = (typeof ACTIVATION_TYPES)[number];

export function isActivationType(value: unknown): value is ActivationType {
  return typeof value === "string" && (ACTIVATION_TYPES as readonly string[]).includes(value);
}
