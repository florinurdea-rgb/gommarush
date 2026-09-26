// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { renderIt } from "./harness";
import { CustomerCatalogue } from "@/components/customer/CustomerCatalogue";
import { CustomerBasket } from "@/components/customer/CustomerBasket";
import { CustomerCheckout } from "@/components/customer/CustomerCheckout";
import { readBasket } from "@/lib/customer/basket";

/**
 * Catalogue → basket, as the customer uses it (owner decisions 2026-09-26).
 *
 *  - No supplier verification while browsing, adding, editing quantities,
 *    viewing the basket or entering checkout: the only endpoints the browser
 *    calls are the catalogue and the catalogue-only basket preview. The final
 *    order POST is the only path to the live check.
 *  - Brand, model and size are distinct elements.
 *  - Quantity defaults to 1, types normally, steps with +/-, and Aggiungi adds
 *    it in ONE store write; the basket rail reflects it at once.
 *  - Nothing on screen shows verification state, timestamps or suppliers.
 */

const OFFER = (i: number, brand: string, model: string) => ({
  tyre: {
    productId: `p${i}`,
    brand,
    modelPattern: model,
    sizeDisplay: "175/65 R15",
    loadIndex: "84",
    speedRating: "H",
    loadSpeedRaw: "84H",
    season: "summer",
    xl: false,
    runFlat: false,
    oldDot: false,
  },
  availability: "in_stock",
  tyreSaleNetCents: 3826 + i,
  pfuStatus: "ESTIMATED",
  pfuEstimated: true,
  pfuAmountCents: 300,
  vatAmountCents: 900,
  customerTotalCents: 5000,
  priceAvailable: true,
});

const calls: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function previewFor(lines: { productId: string; oldDot: boolean; quantity: number }[]) {
  return {
    ok: true,
    basket: {
      lines: lines.map((l) => ({
        ...l,
        tyre: { brand: "LANDSAIL", modelPattern: "RAPIDDR", sizeDisplay: "175/65 R15", widthMm: 175, aspectRatio: 65, rimInch: 15, season: "summer", loadSpeedRaw: "84H" },
        availability: "in_stock",
        state: "available",
        availableQuantity: null,
        unavailableReason: null,
        unitTyreNetCents: 3826,
        pfuStatus: "ESTIMATED",
        unitVatCents: 900,
        unitTotalCents: 5000,
      })),
      currency: "EUR",
      tyreNetTotalCents: 3826,
      pfuTotalCents: 300,
      vatTotalCents: 900,
      vatRatePercent: 22,
      grandTotalCents: 5026,
      monetaryStatus: "complete",
      pfuInVatBase: true,
      pfuEstimated: true,
      pfuEstimateVersion: "v1",
      orderable: true,
      fulfilment: { class: "standard", maxDays: 7 },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    if (url.startsWith("/api/account/catalogue")) {
      return json({
        offers: [OFFER(1, "LANDSAIL", "RAPIDDR"), OFFER(2, "NEXEN", "N'BLUE HD PLUS")],
        total: 2,
        facets: { brands: ["LANDSAIL", "NEXEN"] },
        tiersConfigured: false,
        fulfilment: { maxDays: 7 },
      });
    }
    if (url.startsWith("/api/account/basket/preview")) {
      return json(previewFor(JSON.parse(String(init?.body)).lines));
    }
    return json({ ok: false }, 500);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openResults() {
  const user = userEvent.setup();
  renderIt(<CustomerCatalogue widths={[175, 205]} aspectRatios={[55, 65]} rims={[15, 16]} />);
  await user.selectOptions(screen.getByLabelText(/Larghezza/), "175");
  await user.selectOptions(screen.getByLabelText(/Spalla/), "65");
  await user.selectOptions(screen.getByLabelText(/Cerchio/), "15");
  await screen.findByText("RAPIDDR", {}, { timeout: 3000 });
  return user;
}

describe("the catalogue waits for a complete size", () => {
  it("requests nothing until width, aspect and rim are all chosen", async () => {
    const user = userEvent.setup();
    renderIt(<CustomerCatalogue widths={[175]} aspectRatios={[65]} rims={[15]} />);
    await user.selectOptions(screen.getByLabelText(/Larghezza/), "175");
    await user.selectOptions(screen.getByLabelText(/Spalla/), "65");
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.filter((c) => c.includes("/api/account/catalogue"))).toHaveLength(0);
  });
});

describe("a result row", () => {
  it("renders brand, model and size as distinct elements", async () => {
    await openResults();
    const brand = screen.getByText("LANDSAIL", { selector: "div" });
    const model = screen.getByText("RAPIDDR");
    expect(brand).not.toBe(model);
    expect(brand.textContent).toBe("LANDSAIL");
    expect(model.textContent).toBe("RAPIDDR");
    const row = model.closest("article") as HTMLElement;
    expect(within(row).getByText(/175\/65 R15/)).not.toBe(model);
  });

  it("defaults quantity to 1, types a number, and steps with + and −", async () => {
    const user = await openResults();
    const field = screen.getByLabelText("Quantità LANDSAIL RAPIDDR 175/65 R15") as HTMLInputElement;
    expect(field.value).toBe("1");

    await user.tripleClick(field);
    await user.keyboard("12");
    expect(field.value).toBe("12");
    expect(field).toBe(document.activeElement);

    await user.click(screen.getByLabelText("+ Quantità LANDSAIL RAPIDDR 175/65 R15"));
    expect(field.value).toBe("13");
    await user.click(screen.getByLabelText("− Quantità LANDSAIL RAPIDDR 175/65 R15"));
    await user.click(screen.getByLabelText("− Quantità LANDSAIL RAPIDDR 175/65 R15"));
    expect(field.value).toBe("11");
  });

  it("adds the chosen quantity in ONE store write, without navigating, and resets to 1", async () => {
    const user = await openResults();
    const field = screen.getByLabelText("Quantità LANDSAIL RAPIDDR 175/65 R15") as HTMLInputElement;
    await user.tripleClick(field);
    await user.keyboard("4");

    const writes = vi.spyOn(Storage.prototype, "setItem");
    const row = screen.getByText("RAPIDDR").closest("article") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Aggiungi/ }));

    expect(writes.mock.calls.filter(([key]) => key === "gommarush_customer_basket_v1")).toHaveLength(1);
    expect(readBasket()).toEqual([{ productId: "p1", oldDot: false, quantity: 4 }]);
    expect(field.value).toBe("1");
  });

  it("shows no verification state and no supplier information", async () => {
    await openResults();
    const text = document.body.textContent ?? "";
    for (const banned of ["Verifica", "Verificato", "rilevata alle", "Inter-Sprint", "fornitore", "supplier"]) {
      expect(text, banned).not.toContain(banned);
    }
  });
});

describe("the basket rail", () => {
  it("shows the added line at once and edits it in place", async () => {
    const user = await openResults();
    const row = screen.getByText("RAPIDDR").closest("article") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Aggiungi/ }));

    const rail = screen.getByRole("complementary", { name: "Carrello" });
    await within(rail).findByText("1 pneumatico");
    await within(rail).findByText("RAPIDDR", {}, { timeout: 2000 });

    const plus = within(rail).getByLabelText(/^\+ Quantità/);
    await user.click(plus);
    await within(rail).findByText("2 pneumatici");
    expect(readBasket()[0].quantity).toBe(2);

    await user.click(within(rail).getByRole("button", { name: "Rimuovi" }));
    await within(rail).findByText("Il carrello è vuoto.");
    expect(readBasket()).toEqual([]);
  });

  it("shows no basket total (a catalogue total would read as a quote)", async () => {
    const user = await openResults();
    const row = screen.getByText("RAPIDDR").closest("article") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Aggiungi/ }));
    const rail = screen.getByRole("complementary", { name: "Carrello" });
    await within(rail).findByText("RAPIDDR", {}, { timeout: 2000 });
    expect(rail.textContent).not.toMatch(/Totale|IVA/);
  });
});

describe("dropdowns keep their selections", () => {
  it("keeps the size selected while results load and after a brand is chosen", async () => {
    const user = await openResults();
    const width = screen.getByLabelText(/Larghezza/) as HTMLSelectElement;
    const aspect = screen.getByLabelText(/Spalla/) as HTMLSelectElement;
    const rim = screen.getByLabelText(/Cerchio/) as HTMLSelectElement;
    expect([width.value, aspect.value, rim.value]).toEqual(["175", "65", "15"]);

    const brand = screen.getByLabelText(/Marca/) as HTMLSelectElement;
    await user.selectOptions(brand, "NEXEN");
    await screen.findByText("RAPIDDR");
    expect(brand.value).toBe("NEXEN");
    expect([width.value, aspect.value, rim.value]).toEqual(["175", "65", "15"]);
  });

  it("changes a dropdown from the keyboard", async () => {
    const user = await openResults();
    const sort = screen.getByLabelText(/Ordina per/) as HTMLSelectElement;
    sort.focus();
    await user.selectOptions(sort, "brand_asc");
    expect(sort.value).toBe("brand_asc");
    expect(sort).toBe(document.activeElement);
  });
});

describe("no supplier call while browsing, in the basket or entering checkout", () => {
  it("the browser only ever calls the catalogue and the catalogue-only preview", async () => {
    const user = await openResults();
    const row = screen.getByText("RAPIDDR").closest("article") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /Aggiungi/ }));
    await user.click(within(screen.getByRole("complementary", { name: "Carrello" })).getByLabelText(/^\+ Quantità/));
    await new Promise((r) => setTimeout(r, 400));
    cleanup();

    renderIt(<CustomerBasket />);
    await screen.findAllByText(/RAPIDDR/);
    cleanup();

    renderIt(
      <CustomerCheckout
        locations={[{ id: "l1", location_name: "Sede", address_line1: "Via Roma 1", city: "Verona", postal_code: "37100", is_primary: true }]}
      />
    );
    await screen.findAllByText(/RAPIDDR/);

    const endpoints = new Set(calls.map((c) => c.split(" ")[1]));
    expect([...endpoints].sort()).toEqual(["/api/account/basket/preview", "/api/account/catalogue"]);
    expect(calls.some((c) => c.includes("/api/account/orders"))).toBe(false);
  });

  it("types the basket quantity and the checkout note in full", async () => {
    localStorage.setItem("gommarush_customer_basket_v1", JSON.stringify([{ productId: "p1", oldDot: false, quantity: 1 }]));
    renderIt(<CustomerBasket />);
    const field = (await screen.findByLabelText("Quantità LANDSAIL RAPIDDR")) as HTMLInputElement;
    const user = userEvent.setup();
    await user.tripleClick(field);
    await user.keyboard("20");
    expect(field.value).toBe("20");
    expect(field).toBe(document.activeElement);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(readBasket()[0].quantity).toBe(20);
    cleanup();

    renderIt(
      <CustomerCheckout
        locations={[{ id: "l1", location_name: "Sede", address_line1: "Via Roma 1", city: "Verona", postal_code: "37100", is_primary: true }]}
      />
    );
    const note = (await screen.findByLabelText(/Note/)) as HTMLTextAreaElement;
    await user.click(note);
    await user.type(note, "Consegnare dopo le 14, Via Giuseppe Garibaldi 123");
    expect(note.value).toBe("Consegnare dopo le 14, Via Giuseppe Garibaldi 123");
    expect(note).toBe(document.activeElement);
  });
});

describe("layout structure", () => {
  const catalogue = readFileSync("src/components/customer/CustomerCatalogue.tsx", "utf8");
  const rail = readFileSync("src/components/customer/CatalogueBasketRail.tsx", "utf8");

  it("renders the rail only from lg and the phone bar only below md", () => {
    expect(rail).toContain('className="hidden lg:sticky lg:top-[81px] lg:block"');
    expect(catalogue).toContain('className="fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-30 px-3 pb-2 md:hidden"');
    expect(catalogue).toContain("lg:grid lg:grid-cols-[minmax(0,1fr)_300px]");
  });

  it("keeps the rail within the viewport, scrolling its own lines", () => {
    expect(rail).toContain("max-h-[calc(100vh-97px)]");
    expect(rail).toContain("overflow-y-auto");
  });

  it("widens only the catalogue page", () => {
    const width = readFileSync("src/components/customer/CustomerWidth.tsx", "utf8");
    expect(width).toContain('startsWith("/account/catalogue")');
  });
});
