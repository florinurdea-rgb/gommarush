// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderIt } from "./harness";
import { CustomerEditor } from "@/components/logistics/CustomerEditor";
import { CustomerCreateForm } from "@/components/logistics/CustomerCreateForm";
import { CustomerAccountsPanel } from "@/components/logistics/CustomerAccountsPanel";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import { CustomerActivationForm } from "@/components/customer/CustomerActivationForm";
import type { CustomerLocationRow, CustomerRow } from "@/lib/types/logistics";

/**
 * REGRESSION: "some fields only accept one character at a time".
 *
 * Root cause: CustomerEditor declared its LocationFields component INSIDE its
 * render, so every keystroke produced a new component type and React
 * remounted every delivery-location input, dropping focus after the first
 * character. Each test here clicks a field ONCE, types a whole address, and
 * asserts the full value arrived and focus never left.
 */

const ADDRESS = "Via Giuseppe Garibaldi 123";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function typeOnce(field: HTMLElement, text: string) {
  const user = userEvent.setup();
  await user.click(field);
  await user.type(field, text);
  expect(field).toBe(document.activeElement);
  return user;
}

const customer = {
  id: "c-1",
  name: "Officina Rossi",
  legal_name: null,
  vat_number: null,
  fiscal_code: null,
  email: null,
  phone: null,
  notes: null,
  active: true,
} as unknown as CustomerRow;

const location = {
  id: "l-1",
  customer_id: "c-1",
  location_name: "Sede",
  recipient_name: null,
  address_line1: "Via Roma 1",
  address_line2: null,
  city: "Verona",
  province: "VR",
  region: null,
  postal_code: "37100",
  country_code: "IT",
  phone: null,
  email: null,
  contact_name: null,
  delivery_notes: null,
  is_primary: true,
  active: true,
} as unknown as CustomerLocationRow;

describe("Admin customer editor", () => {
  it("types a whole address into a NEW delivery location without losing focus", async () => {
    renderIt(<CustomerEditor customer={customer} locations={[]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Aggiungi/ }));

    // The new-location block's inputs, in order; address is the third.
    const inputs = screen.getAllByRole("textbox");
    const address = inputs[inputs.length - 7];
    await typeOnce(address, ADDRESS);
    expect((address as HTMLInputElement).value).toBe(ADDRESS);
  });

  it("types into an EXISTING location's fields, including select-all + replace and backspace", async () => {
    renderIt(<CustomerEditor customer={customer} locations={[location]} />);
    const field = screen.getByDisplayValue("Via Roma 1");
    const user = await typeOnce(field, " bis");
    expect((field as HTMLInputElement).value).toBe("Via Roma 1 bis");

    await user.tripleClick(field);
    await user.keyboard(ADDRESS);
    expect((field as HTMLInputElement).value).toBe(ADDRESS);
    await user.keyboard("{Backspace}{Backspace}{Backspace}");
    expect((field as HTMLInputElement).value).toBe("Via Giuseppe Garibaldi ");
    expect(field).toBe(document.activeElement);

    const city = screen.getByDisplayValue("Verona");
    await typeOnce(city, "  Città");
    expect((city as HTMLInputElement).value).toBe("Verona  Città");
  });

  it("types into the company fields", async () => {
    renderIt(<CustomerEditor customer={customer} locations={[location]} />);
    const name = screen.getByDisplayValue("Officina Rossi");
    await typeOnce(name, " & Figli S.r.l.");
    expect((name as HTMLInputElement).value).toBe("Officina Rossi & Figli S.r.l.");
  });

  it("accepts a paste", async () => {
    renderIt(<CustomerEditor customer={customer} locations={[location]} />);
    const field = screen.getByDisplayValue("37100");
    const user = userEvent.setup();
    await user.tripleClick(field);
    await user.paste("37121");
    expect((field as HTMLInputElement).value).toBe("37121");
    expect(field).toBe(document.activeElement);
  });
});

describe("Admin customer creation and portal access", () => {
  it("types every new-customer field in full", async () => {
    renderIt(<CustomerCreateForm />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Nuovo cliente" }));
    for (const id of ["name", "legal_name", "vat_number", "fiscal_code", "email", "phone"]) {
      const field = document.getElementById(`new-customer-${id}`) as HTMLInputElement;
      await typeOnce(field, id === "email" ? "officina@example.it" : ADDRESS);
      expect(field.value).toBe(id === "email" ? "officina@example.it" : ADDRESS);
    }
  });

  it("types the portal login email in full", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { "content-type": "application/json" } })
    );
    renderIt(<CustomerAccountsPanel customerId="c-1" deliverableLocationCount={1} />);
    const field = await screen.findByLabelText("Email di accesso del cliente");
    await typeOnce(field, "banco.officina@example.it");
    expect((field as HTMLInputElement).value).toBe("banco.officina@example.it");
  });
});

describe("Customer sign-in and activation", () => {
  it("types email and password in full", async () => {
    renderIt(<CustomerLoginForm />);
    const email = document.getElementById("customer-email") as HTMLInputElement;
    const password = document.getElementById("customer-password") as HTMLInputElement;
    await typeOnce(email, "titolare@officina.it");
    await typeOnce(password, "una password lunga è ok");
    expect(email.value).toBe("titolare@officina.it");
    expect(password.value).toBe("una password lunga è ok");
  });

  it("types both activation passwords in full", async () => {
    renderIt(<CustomerActivationForm tokenHash="token-hash-123456" type="invite" />);
    const pw = document.getElementById("activation-password") as HTMLInputElement;
    const confirm = document.getElementById("activation-confirm") as HTMLInputElement;
    await typeOnce(pw, "Garibaldi-123-àèì");
    await typeOnce(confirm, "Garibaldi-123-àèì");
    expect(pw.value).toBe("Garibaldi-123-àèì");
    expect(confirm.value).toBe("Garibaldi-123-àèì");
  });
});

describe("approved Admin copy fixes (2026-09-26)", () => {
  it("labels the company-name field 'Nome azienda' and keeps 'Ragione sociale' for the legal name only", () => {
    renderIt(<CustomerEditor customer={customer} locations={[location]} />);
    expect(screen.getAllByText("Nome azienda")).toHaveLength(1);
    expect(screen.getAllByText("Ragione sociale")).toHaveLength(1);
  });

  it("confirms a save in Italian", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/logistics/CustomerEditor.tsx", "utf8");
    expect(source).toContain('setNotice("Salvato.")');
    expect(source).not.toContain('"Salvat."');
  });
});
