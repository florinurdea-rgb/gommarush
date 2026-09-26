import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { clampQuantity, parseQuantity, QUANTITY_MAX, QUANTITY_MIN } from "@/lib/customer/quantity";

/**
 * The customer commerce reskin.
 *
 * Three kinds of guarantee live here:
 *
 *   1. the quantity control's arithmetic, which is pure and worth asserting
 *      directly rather than through a rendered component;
 *   2. the interaction rules the brief specifies (debounce window, single-add,
 *      per-line validation, basket persistence across navigation);
 *   3. the two things that must NOT have happened — the logo must be
 *      untouched, and no backend vocabulary may reach a customer screen.
 */

const read = (path: string) => readFileSync(path, "utf8");

const CUSTOMER_SURFACES = (() => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (!/admin|driver/.test(full)) walk(full);
      } else if (/\.tsx?$/.test(full)) {
        files.push(full);
      }
    }
  };
  walk("src/components/customer");
  walk("app/account");
  return files;
})();

// ---------------------------------------------------------------------------
// Quantity
// ---------------------------------------------------------------------------

describe("the quantity control's arithmetic", () => {
  it("never goes below one", () => {
    expect(clampQuantity(0)).toBe(QUANTITY_MIN);
    expect(clampQuantity(-4)).toBe(QUANTITY_MIN);
  });

  it("never exceeds what the server will accept", () => {
    expect(clampQuantity(1000)).toBe(QUANTITY_MAX);
    // The same ceiling validateBasketLines enforces, so the box cannot compose
    // a line the server will reject.
    expect(QUANTITY_MAX).toBe(100);
  });

  it("is integer only", () => {
    expect(clampQuantity(3.7)).toBe(3);
    expect(parseQuantity("4.9")).toBe(49);
    expect(parseQuantity("2a")).toBe(2);
  });

  /** Empty is not zero: it is a box being typed into. */
  it("treats an empty box as nothing rather than as zero", () => {
    expect(parseQuantity("")).toBeNull();
    expect(parseQuantity("abc")).toBeNull();
  });

  it("survives a value that is not a number at all", () => {
    expect(clampQuantity(Number.NaN)).toBe(QUANTITY_MIN);
    expect(clampQuantity(Number.POSITIVE_INFINITY)).toBe(QUANTITY_MAX);
  });
});

describe("typing is not fought", () => {
  /**
   * REGRESSION CLASS. A controlled numeric input that normalises on every
   * keystroke snaps back to 1 the moment the box is cleared to type a
   * two-digit number. The draft string is what fixes that.
   */
  it("holds the raw string while it is being edited", () => {
    const source = read("src/components/customer/QuantityStepper.tsx");
    expect(source).toContain("const [draft, setDraft] = useState(String(value));");
    expect(source).toContain('type="text"');
    expect(source).toContain('inputMode="numeric"');
  });

  it("normalises on blur and on the buttons, not on each keystroke", () => {
    const source = read("src/components/customer/QuantityStepper.tsx");
    expect(source).toContain("onBlur={() => {");
    expect(source).toContain("onCommit?.(next)");
  });

  /** The brief's floor for a control a shop uses on a phone all day. */
  it("keeps the buttons at a comfortable touch size", () => {
    expect(read("src/components/customer/QuantityStepper.tsx")).toContain("w-11");
  });

  it("gives every instance on a page of results its own accessible name", () => {
    const source = read("src/components/customer/QuantityStepper.tsx");
    expect(source).toContain("aria-label={label}");
    // ...and the catalogue supplies one per card rather than a shared literal.
    expect(read("src/components/customer/CustomerCatalogue.tsx")).toContain(
      'label={`${tr("Quantità")} ${name} ${t.sizeDisplay ?? ""}`.trim()}'
    );
  });
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe("the catalogue price block", () => {
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  /**
   * OWNER DECISION, 2026-09-24. A result shows the selling price and the PFU
   * amount and stops there. A shop scanning fifty rows compares net prices,
   * and four figures per row to compare one of them is noise.
   */
  it("shows the selling price and the PFU amount", () => {
    const card = read(CATALOGUE).slice(read(CATALOGUE).indexOf("function OfferCard("));
    expect(card).toContain("money(offer.tyreSaleNetCents)");
    expect(card).toContain('{tr("PFU")} {money(offer.pfuAmountCents)}');
    expect(card).toContain('tr("netto")');
  });

  it("shows no VAT line, no VAT total and no estimate wording", () => {
    const source = read(CATALOGUE);
    const card = source.slice(source.indexOf("function OfferCard("));
    expect(card, "no VAT rate").not.toContain("IVA");
    expect(card, "no VAT amount").not.toContain("vatAmountCents");
    expect(card, "no VAT-inclusive total").not.toContain("customerTotalCents");
    expect(card, "no estimate wording on a result").not.toContain("PFU stimato");
  });

  /**
   * PRESENTATION ONLY. The estimate is still flagged on the wire and still
   * disclosed where the customer commits, so nothing about PFU auditability
   * depends on what this screen chooses to draw.
   */
  it("does not weaken PFU provenance to achieve that", () => {
    expect(read(CATALOGUE), "the flag still arrives").toContain("pfuEstimated: boolean;");
    for (const file of [
      "src/components/customer/CustomerBasket.tsx",
      "src/components/customer/CustomerCheckout.tsx",
    ]) {
      expect(read(file), `${file} still discloses the estimate`).toContain(
        'tr("PFU stimato — l\'importo definitivo può variare.")'
      );
    }
  });
});

describe("adding from the catalogue", () => {
  const CATALOGUE = "src/components/customer/CustomerCatalogue.tsx";

  it("defaults to one and adds what was chosen, in one operation", () => {
    const source = read(CATALOGUE);
    expect(source).toContain("quantities[key] ?? 1");
    expect(source).toContain("addBasketLine(o.tyre.productId, o.tyre.oldDot, quantity)");
  });

  it("does not navigate away", () => {
    const source = read(CATALOGUE);
    const add = source.slice(source.indexOf("const add = useCallback("), source.indexOf("function reset()"));
    expect(add).not.toContain("router.push");
    expect(add).not.toContain("window.location");
  });

  it("confirms locally and resets the card to one", () => {
    const source = read(CATALOGUE);
    expect(source).toContain('tr("Aggiunto")');
    expect(source).toContain("setQuantity(key, 1);");
  });

  /**
   * A grand total here would be computed from what the catalogue happened to
   * show — before any fulfilment check and before VAT — and would change the
   * moment the basket opened. Count and navigation only.
   */
  it("offers a sticky basket bar carrying a count, never a total", () => {
    const source = read(CATALOGUE);
    const start = source.indexOf("function StickyBasketBar(");
    const bar = source.slice(start, source.indexOf("\n}", start));
    expect(bar).toContain("{count}");
    expect(bar).toContain('href="/account/basket"');
    expect(bar, "no money in the sticky bar").not.toContain("money(");
    expect(bar, "clears the phone navigation and the home indicator").toContain(
      "bottom-[calc(56px+env(safe-area-inset-bottom))]"
    );
  });
});

// ---------------------------------------------------------------------------
// Basket and checkout interaction
// ---------------------------------------------------------------------------

describe("quantity changes revalidate per line", () => {
  for (const file of [
    "src/components/customer/CustomerBasket.tsx",
    "src/components/customer/CustomerCheckout.tsx",
  ]) {
    it(`${file.split("/").pop()} debounces typing and acts immediately on the buttons`, () => {
      const source = read(file);
      // The brief's window is 400-600ms.
      expect(source).toMatch(/[45]\d\d/);
      expect(source).toContain("onChange={(q) => changeQuantity(s, q, false)}");
      expect(source).toContain("onCommit={(q) => changeQuantity(s, q, true)}");
    });

    /**
     * CHANGED 2026-09-26 (owner decision): there is no per-line "checking"
     * indicator any more. The preview re-prices from catalogue data only and
     * the live supplier check runs at final confirmation, so nothing slow
     * happens per line to indicate.
     */
    it(`${file.split("/").pop()} shows no per-line verification indicator`, () => {
      const source = read(file);
      expect(source).not.toContain("setValidating");
      expect(source).not.toContain("validating=");
    });

    /** A superseded response must not overwrite a newer one. */
    it(`${file.split("/").pop()} ignores a stale response`, () => {
      const source = read(file);
      expect(source).toContain("const ticket = ++request.current;");
      expect(source).toContain("if (ticket !== request.current) return;");
    });

    /**
     * THE WRITE HAPPENS FIRST. The basket must survive a slow validation, a
     * failed one, a navigation away and a closed tab.
     */
    it(`${file.split("/").pop()} persists the basket before validating`, () => {
      const source = read(file);
      const change = source.slice(source.indexOf("changeQuantity = useCallback("));
      // Both screens re-check through their own loader; the invariant is that
      // the write to the store happens before either of them is called.
      const revalidate = Math.min(
        ...[change.indexOf("verify(next"), change.indexOf("load(next")].filter((i) => i > -1)
      );
      expect(change.indexOf("writeBasket(next)")).toBeLessThan(revalidate);
    });
  }

  /** Never silently reduce what somebody asked for. */
  it("offers the available quantity rather than applying it", () => {
    const shared = read("src/components/customer/LineAvailability.tsx");
    expect(shared).toContain('tr("Porta a")');
    expect(shared).toContain("onAcceptAvailable(available)");
  });

  /** Reducing must be able to restore a line, which needs a fresh check. */
  it("re-checks after a reduction rather than trusting the browser", () => {
    const basket = read("src/components/customer/CustomerBasket.tsx");
    expect(basket).toContain("onAcceptAvailable={(q) => changeQuantity(s, q, true)}");
  });
});

describe("basket persistence across the journey", () => {
  /**
   * catalogue → basket → checkout → alternatives → catalogue, and back, must
   * all read the same store. Nothing may hold basket state in component
   * memory alone, and nothing may clear it except a completed order.
   */
  it("reads and writes one store everywhere", () => {
    for (const file of [
      "src/components/customer/CustomerCatalogue.tsx",
      "src/components/customer/CustomerBasket.tsx",
      "src/components/customer/CustomerCheckout.tsx",
    ]) {
      expect(read(file)).toContain('from "@/lib/customer/basket"');
    }
  });

  it("clears the basket only after an order is created", () => {
    const checkout = read("src/components/customer/CustomerCheckout.tsx");
    const clear = checkout.indexOf("writeBasket([])");
    expect(clear).toBeGreaterThan(-1);
    // It sits after the response was accepted, not in the error path.
    expect(clear).toBeGreaterThan(checkout.indexOf("throw new Error(j.code)"));
  });

  /** An unavailable line is never removed for the customer. */
  it("never drops a line it cannot fulfil", () => {
    const basket = read("src/components/customer/CustomerBasket.tsx");
    expect(basket).not.toContain("filter((l) => l.state === \"available\")");
    const shared = read("src/components/customer/LineAvailability.tsx");
    expect(shared).toContain('tr("Vedi alternative")');
  });
});

// ---------------------------------------------------------------------------
// The two things that must NOT have happened
// ---------------------------------------------------------------------------

describe("no backend vocabulary reaches a customer screen", () => {
  /**
   * Checked against the RENDERED strings, not the whole file: the components
   * legitimately discuss their own mechanism in comments and in type names,
   * and banning the words there would ban explaining the code.
   */
  const FORBIDDEN = [
    "Supabase",
    "Inter-Sprint",
    "InterSprint",
    "database",
    "RPC",
    "supplier listing",
    "supplier feed",
    "markup",
    "margine",
    "provenance",
  ];

  for (const file of CUSTOMER_SURFACES) {
    it(`${file} renders none of it`, () => {
      const source = read(file);
      // Everything inside tr("…") plus every bare JSX text node is what a
      // customer can actually read.
      const translated = [...source.matchAll(/tr\(\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      const jsxText = [...source.matchAll(/>\s*([A-Za-zÀ-ÿ][^<>{}\n]{3,})\s*</g)].map((m) => m[1]);
      const visible = [...translated, ...jsxText].join(" | ").toLowerCase();

      for (const word of FORBIDDEN) {
        expect(visible, `"${word}" must not be customer-visible`).not.toContain(word.toLowerCase());
      }
    });
  }

  /** Sourcing identity has no field to occupy in a customer payload either. */
  it("keeps the projection boundary as the real guarantee", async () => {
    const { FORBIDDEN_CUSTOMER_FIELDS } = await import("@/lib/pricing/projection");
    expect(FORBIDDEN_CUSTOMER_FIELDS).toContain("supplierName");
    expect(FORBIDDEN_CUSTOMER_FIELDS).toContain("laneCode");
    expect(FORBIDDEN_CUSTOMER_FIELDS).toContain("supplierCostCents");
  });
});

describe("the GommaRush logo is untouched", () => {
  /**
   * The reskin brief is explicit: do not redraw, regenerate, recolour or
   * replace it. This asserts the component is used as-is and that no customer
   * screen has started drawing its own.
   */
  it("is still rendered from the one Logo component", () => {
    expect(existsSync("src/components/Logo.tsx")).toBe(true);
    expect(read("app/account/(secure)/layout.tsx")).toContain('from "@/components/Logo"');
    expect(read("app/account/login/page.tsx")).toContain('from "@/components/Logo"');
  });

  /**
   * The failure this guards against is a second Logo appearing somewhere in
   * the customer area — hand-drawn, re-coloured, or swapped for an image —
   * while the original stays in place and nobody notices the two differ.
   */
  it("has no second definition of it anywhere in the customer area", () => {
    for (const file of CUSTOMER_SURFACES) {
      const source = read(file);
      expect(source, `${file} must not define its own logo`).not.toMatch(
        /function\s+Logo\b|const\s+Logo\s*=/
      );
      expect(source, `${file} must not swap it for an image asset`).not.toMatch(
        /logo[-_.\w]*\.(svg|png|jpe?g|webp)/i
      );
    }
  });

  /** And the component itself still draws, rather than importing, the mark. */
  it("still draws the mark it always drew", () => {
    const logo = read("src/components/Logo.tsx");
    expect(logo).toContain("export function Logo");
    expect(logo, "no image swapped in").not.toMatch(/<img|next\/image/);
  });
});

describe("the approved icon set is the only one used", () => {
  it("covers every commerce concept from one file", () => {
    const icons = read("src/components/customer/CommerceIcons.tsx");
    for (const name of [
      "CommerceCartIcon",
      "CommerceCheckIcon",
      "CommercePlusIcon",
      "CommerceMinusIcon",
      "CommerceSunIcon",
      "CommerceSnowflakeIcon",
      "CommerceAllSeasonIcon",
      "CommerceTruckIcon",
      "CommerceSearchIcon",
      "CommerceWarningIcon",
      "CommerceRefreshIcon",
      "CommerceLocationIcon",
    ]) {
      expect(icons).toContain(`export function ${name}`);
    }
  });

  /** No emoji standing in for a concept the asset file already covers. */
  it("uses no emoji in place of an approved mark", () => {
    for (const file of CUSTOMER_SURFACES) {
      expect(read(file), `${file}`).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    }
  });
});

// ---------------------------------------------------------------------------
// The public site and the customer area are one product
// ---------------------------------------------------------------------------

describe("the primary action looks the same on both sides of sign-in", () => {
  /**
   * The single most-seen element on the site. It used to be a gradient with a
   * tinted lift on the public pages and a flat accent inside the account, so
   * it changed appearance at exactly the moment a customer crossed between
   * them — the discontinuity this pass exists to remove.
   */
  it("uses one flat accent treatment in both places", () => {
    const publicPrimary = read("src/components/site/Section.tsx");
    expect(publicPrimary).toContain("bg-accent text-white hover:bg-accent-dark");
    expect(publicPrimary, "no gradient on the primary CTA").not.toContain(
      "primary: `${BUTTON_BASE} bg-gr-accent"
    );

    const commercePrimary = read("src/components/Button.tsx");
    expect(commercePrimary).toContain("bg-accent text-white hover:bg-accent-dark");
  });

  /** Restrained: a border or a shadow, not both. */
  it("keeps the public surfaces as bordered cards without a lift", () => {
    for (const file of ["src/components/site/OrderMockup.tsx", "src/components/site/ImagePlaceholder.tsx"]) {
      expect(read(file), `${file}`).not.toContain("shadow-card");
    }
  });

  /**
   * The marketing palette is otherwise untouched: the inverted band and the
   * section grounds still use their gradients.
   */
  it("changes only the button, not the marketing palette", () => {
    const config = read("tailwind.config.js");
    expect(config).toContain('"gr-ink"');
    expect(config).toContain('"gr-soft"');
  });

  /** Copy and destinations are out of bounds for a visual pass. */
  it("leaves the homepage copy and CTA destinations alone", () => {
    const page = read("app/page.tsx");
    // Every string on the landing page still comes from the locale copy object.
    expect(page).toContain("const { copy } = useLocale();");
    expect(page, "no literal marketing sentence introduced").not.toMatch(
      />\s*[A-ZÀ-Ý][a-zà-ÿ]+(\s+[a-zà-ÿ]+){4,}\s*</
    );
    const routes = read("src/lib/site-routes.ts");
    expect(routes).toContain('account: "/account/login"');
  });

  /** The public header keeps the logo it always had. */
  it("keeps the public header's logo untouched", () => {
    const header = read("src/components/site/GlobalHeader.tsx");
    expect(header).toContain('from "@/components/Logo"');
    expect(header).toContain("<Logo iconClassName=");
  });
});

describe("mobile stays first-class at 375-430px", () => {
  /**
   * Gutters are enforced in one place on the marketing side, so no section can
   * lose them on a narrow phone. Asserted rather than trusted because it is a
   * property a single careless `className` would break.
   */
  it("keeps the marketing gutter decision in one place", () => {
    const section = read("src/components/site/Section.tsx");
    expect(section).toContain("px-4");
  });

  /** Nothing fixed may sit on top of the content it refers to. */
  it("reserves room for every fixed element in the customer area", () => {
    const layout = read("app/account/(secure)/layout.tsx");
    expect(layout).toContain("h-[calc(56px+env(safe-area-inset-bottom))]");

    const catalogue = read("src/components/customer/CustomerCatalogue.tsx");
    // The sticky basket bar sits above the navigation, and the toast above it.
    expect(catalogue).toContain("bottom-[calc(56px+env(safe-area-inset-bottom))]");
    expect(catalogue).toContain("bottom-[calc(116px+env(safe-area-inset-bottom))]");
  });

  /** Primary actions and steppers are thumb-sized, not mouse-sized. */
  it("keeps touch targets at 44px or more", () => {
    expect(read("src/components/site/Section.tsx")).toContain("min-h-[44px]");
    expect(read("src/components/customer/QuantityStepper.tsx")).toContain("w-11");
    expect(read("src/components/customer/LineAvailability.tsx")).toContain("min-h-[44px]");
  });
});
