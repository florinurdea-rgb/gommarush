import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { getCopy } from "@/lib/i18n/site-content";

/**
 * The public homepage (M22 redesign).
 *
 * Pins the commercial decisions: the customer area is the primary action,
 * registration (not open) never is, every public/operational route still
 * resolves, and the homepage makes no claim the business cannot back.
 */

const read = (path: string) => readFileSync(path, "utf8");
const PAGE = "app/page.tsx";

describe("the primary action is the customer area", () => {
  const page = read(PAGE);

  it("puts Area clienti before the quote route in the hero", () => {
    const hero = page.slice(page.indexOf("1. HERO"), page.indexOf("2. HOW GOMMARUSH HELPS"));
    const primary = hero.indexOf("href={CUSTOMER_ROUTES.account} className={BUTTON_STYLES.primary}");
    const secondary = hero.indexOf("href={ROUTES.quote} className={BUTTON_STYLES.secondary}");
    expect(primary).toBeGreaterThan(-1);
    expect(secondary).toBeGreaterThan(primary);
  });

  it("never makes the closed registration a primary action", () => {
    expect(page).not.toContain("REGISTER_HREF");
    expect(page).not.toContain("ctaRegisterFree");
  });

  it("keeps Area clienti in the header at every breakpoint", () => {
    const header = read("src/components/site/GlobalHeader.tsx");
    const cta = header.slice(header.indexOf("href={CUSTOMER_ROUTES.account}"));
    expect(cta.slice(0, 200)).toContain("BUTTON_STYLES.primary");
    expect(cta.slice(0, 200)).not.toMatch(/\bhidden\b/);
  });

  it("keeps copy in the locale object, never literal in the page", () => {
    expect(page).toContain("const { copy } = useLocale();");
    expect(page).not.toMatch(/>\s*[A-ZÀ-Ý][a-zà-ÿ]+(\s+[a-zà-ÿ]+){4,}\s*</);
  });
});

describe("required public and operational routes remain available", () => {
  for (const route of [
    "app/page.tsx",
    "app/pneumatici",
    "app/come-funziona",
    "app/perche-gommarush",
    "app/per-fornitori",
    "app/richiedi-offerta",
    "app/registrati",
    "app/account/login/page.tsx",
    "app/account/attiva/page.tsx",
    "app/admin",
    "app/driver",
  ]) {
    it(`${route} exists`, () => expect(existsSync(route)).toBe(true));
  }

  it("still offers admin, driver and language access from the menu", () => {
    const menu = read("src/components/site/HamburgerMenu.tsx");
    expect(menu).toContain('href: "/admin"');
    expect(menu).toContain('href: "/driver"');
    expect(menu).toContain("copy.language");
  });
});

describe("the homepage claims only what the business can back", () => {
  const page = read(PAGE);
  const lp = (locale: "it" | "en") =>
    Object.entries(getCopy(locale))
      .filter(([key]) => key.startsWith("lp"))
      .map(([, value]) => value)
      .join(" | ")
      .toLowerCase();

  it("uses no placeholder art, mock order, brand strip or fake status", () => {
    for (const banned of ["ImagePlaceholder", "OrderMockup", "BrandMarquee", "OverlayStatus", "TyreFinder"]) {
      expect(page, banned).not.toContain(banned);
    }
  });

  it("names no supplier and no internal vocabulary", () => {
    for (const locale of ["it", "en"] as const) {
      const text = lp(locale);
      for (const word of ["inter-sprint", "intersprint", "deldo", "supabase", "database", "api", "feed", "margin", "margine"]) {
        expect(text, `${locale}: ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
      }
    }
  });

  it("makes no unsupported commercial claims", () => {
    for (const locale of ["it", "en"] as const) {
      const text = lp(locale);
      for (const claim of [
        "più basso", "lowest", "garantit", "guarantee", "leader", "migliaia", "thousands",
        "più fornitori", "several suppliers", "vicenza", "verona", "km",
      ]) {
        expect(text, `${locale}: ${claim}`).not.toContain(claim);
      }
    }
  });

  it("states the fulfilment promises exactly as the order engine defines them", async () => {
    const { FULFILMENT_PROMISES } = await import("@/lib/commerce/fulfilment");
    expect(FULFILMENT_PROMISES.standard.maxDays).toBe(7);
    expect(FULFILMENT_PROMISES.express).toMatchObject({ minHours: 24, maxHours: 48 });
    expect(getCopy("it").lpFactStandard).toContain("7 giorni");
    expect(getCopy("it").lpFactExpress).toContain("24–48h");
  });

  it("names only the V1 payment methods", () => {
    const text = lp("it");
    expect(text).toContain("bonifico");
    expect(text).toContain("contanti alla consegna");
    expect(text).not.toMatch(/\bpos\b/);
  });
});

describe("mobile and accessibility structure", () => {
  const page = read(PAGE);

  it("has one h1 and section headings below it", () => {
    expect(page.match(/<h1\b/g)?.length).toBe(1);
    expect(page).toContain("<h2");
  });

  it("stacks the hero CTAs full-width on a phone and uses 44px buttons", () => {
    expect(page).toContain('className="mt-7 flex flex-col gap-3 sm:flex-row"');
    expect(read("src/components/site/Section.tsx")).toContain("min-h-[44px]");
  });

  it("puts the hero copy before the photograph in source order", () => {
    expect(page.indexOf("copy.lpHeroTitle")).toBeLessThan(page.indexOf("src={heroVanFleet}"));
  });
});
