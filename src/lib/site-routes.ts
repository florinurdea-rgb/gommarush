/**
 * Public route constants.
 *
 * Centralised so the header, the footer, the hamburger and every in-page CTA
 * cannot drift apart, and so the operational entry points are visible in one
 * place as things that must not be renamed.
 */

/** Marketing routes. */
export const ROUTES = {
  home: "/",
  tyres: "/pneumatici",
  howItWorks: "/come-funziona",
  why: "/perche-gommarush",
  suppliers: "/per-fornitori",
  quote: "/richiedi-offerta",
  register: "/registrati",
} as const;

/**
 * Operational entry points. These are EXISTING working routes owned by the
 * platform, not the marketing site. They are listed here so the public
 * navigation can link to them, and they must not be renamed or invented
 * around -- /admin is the admin dashboard entry and /driver is the driver
 * area entry, exactly as the hamburger has always used them.
 */
export const OPERATIONAL_ROUTES = {
  admin: "/admin",
  driver: "/driver",
} as const;

/**
 * Where every "Registrati" CTA points.
 *
 * The registration funnel is being built separately. Until it exists this
 * resolves to a real interim page that says so and offers the route that does
 * work today -- rather than a `#` that goes nowhere, or the quote form, which
 * would be the wrong destination dressed up as the right one. Connecting the
 * real funnel later is a one-line change here.
 */
export const REGISTER_HREF: string = ROUTES.register;
