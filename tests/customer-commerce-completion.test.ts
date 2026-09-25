import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  FULFILMENT_CLASSES,
  FULFILMENT_LABELS,
  fulfilmentLabel,
} from "@/lib/commerce/fulfilment";

/**
 * The customer-commerce UI/UX completion pass on PR #15.
 *
 * Each block pins one decision from that pass, so a later edit that quietly
 * reverses it fails here rather than in front of a customer. Most are source
 * assertions, like the rest of the portal's UI suite: the screens are client
 * components with no rendering harness in this repo.
 */

const read = (path: string) => readFileSync(path, "utf8");

const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";
const BASKET = "src/components/customer/CustomerBasket.tsx";
const CHECKOUT = "src/components/customer/CustomerCheckout.tsx";
const LINE = "src/components/customer/LineAvailability.tsx";
const LAYOUT = "app/account/(secure)/layout.tsx";
const NAV = "src/components/customer/CustomerShellNav.tsx";
const ORDER_DETAIL = "app/account/(secure)/orders/[id]/page.tsx";

// ---------------------------------------------------------------------------
// Fulfilment vocabulary
// ---------------------------------------------------------------------------

describe("the stored fulfilment class never reaches a customer as-is", () => {
  it("has a customer label for every class", () => {
    for (const value of FULFILMENT_CLASSES) {
      expect(fulfilmentLabel(value)).toBe(FULFILMENT_LABELS[value]);
      expect(FULFILMENT_LABELS[value]).not.toBe(value);
    }
  });

  it("answers null, not the raw value, for anything unrecognised", () => {
    expect(fulfilmentLabel("same_day")).toBeNull();
    expect(fulfilmentLabel(null)).toBeNull();
    expect(fulfilmentLabel(undefined)).toBeNull();
  });

  it("keeps the approved wording unchanged", () => {
    expect(FULFILMENT_LABELS.standard).toBe("Standard · consegna entro 7 giorni");
    expect(FULFILMENT_LABELS.express).toBe("Express · 24–48h, su verifica");
  });

  it("is what the order detail renders, never the column", () => {
    const page = read(ORDER_DETAIL);
    expect(page).toContain("fulfilmentLabel(order.fulfilment_class)");
    expect(page).not.toMatch(/\{\s*order\.fulfilment_class\s*\}/);
  });

  it("is the same source the checkout offers the choice from", () => {
    const checkout = read(CHECKOUT);
    expect(checkout).toContain("FULFILMENT_LABELS[value]");
    expect(checkout, "no second copy of the labels").not.toContain('label: "Standard');
  });
});

// ---------------------------------------------------------------------------
// Checkout states
// ---------------------------------------------------------------------------

describe("the checkout shows one status at a time", () => {
  const checkout = read(CHECKOUT);

  it("chooses among the five distinct states in priority order", () => {
    for (const state of ['"validating"', '"unavailable"', '"price_changed"', '"verification"', '"ready"']) {
      expect(checkout).toContain(state);
    }
    const order = ["? \"validating\"", "? \"load_failed\"", "? \"unavailable\"", "? \"price_changed\"", "? \"verification\""]
      .map((s) => checkout.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  /** A check that could not complete is not out of stock, and not red. */
  it("draws a failed verification amber, never with danger semantics", () => {
    const start = checkout.indexOf('{status === "verification" && (');
    const block = checkout.slice(start, checkout.indexOf('{status === "pricing"', start));
    expect(block).toContain("state-warning");
    expect(block).not.toContain("state-danger");
    expect(block).not.toContain("Non disponibile");
  });

  it("draws unavailable stock red, in its own branch", () => {
    const start = checkout.indexOf('{status === "unavailable" && (');
    const block = checkout.slice(start, checkout.indexOf("{/* ---- THE PRICE MOVED", start));
    expect(block).toContain("state-danger");
  });

  /** "Riprova" re-runs the check. Only the one final button places an order. */
  it("has exactly one control that submits the order", () => {
    expect(checkout.match(/onClick=\{submit\}/g)?.length).toBe(1);
    const start = checkout.indexOf('{status === "verification" && (');
    const block = checkout.slice(start, checkout.indexOf('{status === "pricing"', start));
    expect(block).toContain("verify(stored)");
  });

  it("treats a line whose preview check failed as the verification state", () => {
    expect(checkout).toContain('basket?.verifiedSource === "feed_after_live_failure"');
    expect(checkout).toContain("verificationUnavailable || lineCheckFailed");
  });

  /** The submit gate itself is unchanged: nothing here weakens it. */
  it("keeps the submit gate on money, stock, accepted total and address", () => {
    const gate = checkout.slice(checkout.indexOf("const canSubmit ="), checkout.indexOf("!checking;"));
    for (const term of ["complete &&", "orderable &&", "acceptedTotalCents !== null", "!!locationId", "!!idempotencyKey", "!busy"]) {
      expect(gate).toContain(term);
    }
  });
});

describe("a price moved by a re-check is announced, not absorbed", () => {
  const checkout = read(CHECKOUT);

  it("compares unit prices, so a quantity edit is not mistaken for one", () => {
    expect(checkout).toContain("function unitPriceMoved(");
    const fn = checkout.slice(checkout.indexOf("function unitPriceMoved("));
    expect(fn).toContain("previous.unitTotalCents !== line.unitTotalCents");
    expect(fn.slice(0, 600)).not.toContain(".quantity");
  });

  it("shows the notice and updates the accepted total to what is on screen", () => {
    expect(checkout).toContain('kind: "preview"');
    expect(checkout).toContain("setAcceptedTotal(j.basket?.grandTotalCents ?? null);");
    expect(checkout).toContain('tr("Il prezzo è cambiato")');
  });

  it("shows the checkout the same Pneumatici → PFU → IVA → Totale chain as the basket", () => {
    for (const term of ['tr("Pneumatici")', 'tr("PFU")', 'tr("IVA")', "basket.grandTotalCents"]) {
      expect(checkout).toContain(term);
    }
  });

  it("does not repeat the PFU estimate disclosure twice", () => {
    expect(checkout.split("PFU stimato — l'importo definitivo può variare.").length - 1).toBe(1);
  });
});

describe("the checkout layout", () => {
  const checkout = read(CHECKOUT);

  it("is one column on a phone and two from lg, with the summary sticky only there", () => {
    expect(checkout).toContain('className="mt-5 grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start"');
    expect(checkout).toContain('className="space-y-4 lg:sticky lg:top-24"');
  });

  it("puts delivery and payment before the summary, and the button after it", () => {
    const delivery = checkout.indexOf("---- 1. DELIVERY");
    const payment = checkout.indexOf("---- 2. PAYMENT");
    const summary = checkout.indexOf("---- 3. ORDER SUMMARY");
    const button = checkout.indexOf("onClick={submit}");
    expect(delivery).toBeLessThan(payment);
    expect(payment).toBeLessThan(summary);
    expect(summary).toBeLessThan(button);
  });

  it("offers only the two V1 payment methods", () => {
    expect(checkout).toContain('value: "bank_transfer"');
    expect(checkout).toContain('value: "cash_on_delivery"');
    expect(checkout).not.toContain("pos_on_delivery");
  });
});

// ---------------------------------------------------------------------------
// Line state
// ---------------------------------------------------------------------------

describe("a line whose check failed", () => {
  const shared = read(LINE);
  const branch = shared.slice(
    shared.indexOf('if (verifiedSource === "feed_after_live_failure") {'),
    shared.indexOf("Available. A quiet confirmation")
  );

  it("is amber with a retry, never green and never red", () => {
    expect(branch).toContain("state-warning");
    expect(branch).not.toContain("state-danger");
    expect(branch).not.toContain("state-success");
    expect(branch).toContain('tr("Riprova")');
  });

  it("is checked before the quiet 'available' confirmation can claim it", () => {
    expect(shared.indexOf('if (verifiedSource === "feed_after_live_failure") {')).toBeLessThan(
      shared.indexOf('{tr("Disponibile")}')
    );
  });

  it("is retried per line from the basket, through the same loader", () => {
    expect(read(BASKET)).toContain("onRetry={() => void load(stored, [key])}");
  });
});

// ---------------------------------------------------------------------------
// Stale architecture statements
// ---------------------------------------------------------------------------

describe("comments describe the verification that actually runs", () => {
  it("no longer claims the live check happens only on submit", () => {
    expect(read(CHECKOUT)).not.toContain("HAPPENS ON SUBMIT, not here");
    expect(read(CHECKOUT)).toContain("forceFresh");
  });

  it("no longer claims the order path fails open", () => {
    const orders = read("src/lib/server/sales-orders.ts");
    expect(orders).not.toContain("rather than blocking the sale");
    expect(orders).toContain('throw new OrderRefusal("LIVE_VERIFICATION_UNAVAILABLE", basket)');
  });
});

// ---------------------------------------------------------------------------
// Catalogue and shell on a phone
// ---------------------------------------------------------------------------

describe("the catalogue on a phone", () => {
  const source = read(CATALOGUE);

  it("folds the secondary filters behind one labelled toggle, always shown from sm", () => {
    expect(source).toContain("aria-expanded={filtersOpen}");
    expect(source).toContain('aria-controls="catalogue-secondary-filters"');
    expect(source).toContain('tr("Filtri aggiuntivi")');
    expect(source).toContain('filtersOpen ? "grid" : "hidden"');
    expect(source).toContain("sm:grid sm:grid-cols-4");
  });

  it("keeps the three size selectors outside the fold, at every width", () => {
    const size = source.indexOf("facetValues={rims}");
    const toggle = source.indexOf("aria-expanded={filtersOpen}");
    expect(size).toBeGreaterThan(-1);
    expect(size).toBeLessThan(toggle);
  });

  it("reserves room for the sticky basket bar so it never covers the last result", () => {
    expect(source).toContain('<div className="h-[60px] md:hidden" aria-hidden="true" />');
  });

  it("offers a retry when the search itself fails", () => {
    expect(source).toContain("setAttempt((n) => n + 1)");
    expect(source).toContain("[filters, page, canQuery, attempt]");
  });

  it("uses 16px controls on a phone, so iOS does not zoom the page on focus", () => {
    expect(source).toContain("text-base font-semibold text-ink sm:text-sm");
    expect(read("src/components/customer/QuantityStepper.tsx")).toContain("text-center text-base");
  });
});

describe("the shell", () => {
  /**
   * The catalogue's sticky bar pins itself at top-[57px] / sm:top-[65px];
   * a header whose height followed its content slid the bar partly under it.
   */
  it("has a fixed header height matching the catalogue's sticky offset", () => {
    expect(read(LAYOUT)).toContain("h-14 items-center");
    expect(read(LAYOUT)).toContain("sm:h-16");
    expect(read(CATALOGUE)).toContain("sticky top-[57px]");
    expect(read(CATALOGUE)).toContain("sm:top-[65px]");
  });

  it("marks the current tab with more than colour", () => {
    const nav = read(NAV);
    expect(nav).toContain('aria-current={active ? "page" : undefined}');
    expect(nav).toContain("absolute inset-x-5 top-0 h-0.5");
  });
});
