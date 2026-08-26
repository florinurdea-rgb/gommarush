#!/usr/bin/env node
/**
 * Development seed data for GoRush Logistics Phase 1.
 *
 * Creates:
 *   Driver 1 / Driver 2 / Driver 3
 *   Van 1 / Van 2 / Van 3
 *   one demo supplier and one demo customer with three delivery locations
 *   three active orders — GR-001 -> Driver 1 / Van 1
 *                         GR-002 -> Driver 2 / Van 2
 *                         GR-003 -> Driver 3 / Van 3
 *   with realistic tyre products.
 *
 * SAFETY
 * This script refuses to run unless you pass --confirm, and it refuses outright
 * when NODE_ENV=production unless you additionally pass --force. Seeding fake
 * orders into a live warehouse database would put phantom work in the real
 * warehouse queue.
 *
 * Everything it creates is tagged (see SEED_TAG) so `--clean` can remove it
 * again without touching anything real.
 *
 *   node scripts/seed-dev.mjs --confirm
 *   node scripts/seed-dev.mjs --clean --confirm
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SEED_TAG = "[seed:gorush-dev]";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnvFile(file) {
  try {
    const content = readFileSync(resolve(process.cwd(), file), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local is fine when the variables come from the shell.
  }
}

loadEnvFile(".env.local");

const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const cleaning = args.has("--clean");
const forced = args.has("--force");

if (!confirmed) {
  console.error(
    "\nRefusing to run without --confirm.\n" +
      "  Seed:  node scripts/seed-dev.mjs --confirm\n" +
      "  Clean: node scripts/seed-dev.mjs --clean --confirm\n"
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production" && !forced) {
  console.error(
    "\nRefusing to seed with NODE_ENV=production.\n" +
      "  This creates fake orders in the real warehouse queue.\n" +
      "  Pass --force only if you are certain this database is not live.\n"
  );
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "\nMissing Supabase configuration.\n" +
      "  Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local\n"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const DRIVERS = [
  { name: "Driver 1", slug: "driver-1" },
  { name: "Driver 2", slug: "driver-2" },
  { name: "Driver 3", slug: "driver-3" },
];

const VEHICLES = [
  { name: "Van 1", slug: "van-1", registration: "VR 100 AA" },
  { name: "Van 2", slug: "van-2", registration: "VR 200 BB" },
  { name: "Van 3", slug: "van-3", registration: "VR 300 CC" },
];

const SUPPLIER = {
  name: "Pneus Distribuzione SpA",
  vat_number: "IT01928374650",
  notes: SEED_TAG,
};

const CUSTOMER = {
  name: "Rossi Gomme SRL",
  legal_name: "Rossi Gomme Società a Responsabilità Limitata",
  vat_number: "IT04455667788",
  email: "ordini@rossigomme.example",
  phone: "+39 0444 123456",
  notes: SEED_TAG,
};

const LOCATIONS = [
  {
    location_name: "Filiale Vicenza",
    address_line1: "Via Torino 42",
    postal_code: "36100",
    city: "Vicenza",
    province: "VI",
    is_primary: true,
    delivery_notes: SEED_TAG,
  },
  {
    location_name: "Filiale Padova",
    address_line1: "Via Venezia 118",
    postal_code: "35131",
    city: "Padova",
    province: "PD",
    delivery_notes: SEED_TAG,
  },
  {
    location_name: "Filiale Verona",
    address_line1: "Viale del Lavoro 7",
    postal_code: "37135",
    city: "Verona",
    province: "VR",
    delivery_notes: SEED_TAG,
  },
];

/** Realistic tyre lines, plus the fee lines a real invoice carries. */
const ORDERS = [
  {
    document: "FT-2026-4471",
    reference: "ORD-88121",
    cash: false,
    items: [
      {
        item_type: "tyre", brand: "Michelin", description: "Primacy 4+",
        supplier_sku: "MI2255518PR4", width: 225, aspect_ratio: 55, rim_diameter: 18,
        load_index: "98", speed_rating: "V", quantity: 4, unit_price: 112.5, season: "summer",
        raw_description: "MICHELIN PRIMACY 4+ 225/55 R18 98V",
      },
      {
        item_type: "tube", description: "Camera d'aria 15\"", quantity: 2, unit_price: 6.4,
        raw_description: "CAMERA D'ARIA 15 POLLICI",
      },
      {
        item_type: "fee", description: "PFU - contributo ambientale", quantity: 1,
        unit_price: 2.61, raw_description: "CONTRIBUTO PFU",
      },
    ],
  },
  {
    document: "FT-2026-4472",
    reference: "ORD-88122",
    cash: true,
    amount: 486.4,
    items: [
      {
        item_type: "tyre", brand: "Pirelli", description: "P Zero PZ4",
        supplier_sku: "PI2454019PZ4", width: 245, aspect_ratio: 40, rim_diameter: 19,
        load_index: "98", speed_rating: "Y", quantity: 4, unit_price: 168.9, season: "summer",
        raw_description: "PIRELLI P ZERO PZ4 245/40 R19 98Y XL",
      },
      {
        item_type: "service", description: "Montaggio e equilibratura", quantity: 1,
        unit_price: 40, raw_description: "MONTAGGIO + EQUILIBRATURA",
      },
    ],
  },
  {
    document: "FT-2026-4473",
    reference: "ORD-88123",
    cash: false,
    items: [
      {
        item_type: "tyre", brand: "Continental", description: "WinterContact TS 870",
        supplier_sku: "CO2055516TS870", width: 205, aspect_ratio: 55, rim_diameter: 16,
        load_index: "91", speed_rating: "H", quantity: 4, unit_price: 94.2, season: "winter",
        raw_description: "CONTINENTAL WINTERCONTACT TS 870 205/55 R16 91H",
      },
      {
        item_type: "accessory", description: "Valvole TPMS", quantity: 4, unit_price: 12,
        raw_description: "VALVOLE TPMS UNIVERSALI",
      },
      {
        item_type: "fee", description: "Trasporto", quantity: 1, unit_price: 15,
        raw_description: "SPESE DI TRASPORTO",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Clean
// ---------------------------------------------------------------------------

async function clean() {
  console.log("Removing seed data…");

  const { data: customers } = await supabase
    .from("customers")
    .select("id")
    .eq("notes", SEED_TAG);

  const customerIds = (customers ?? []).map((row) => row.id);

  if (customerIds.length > 0) {
    // Orders cascade to items -> units -> scans, so deleting the
    // orders is enough to remove everything downstream.
    const { data: orders } = await supabase
      .from("orders")
      .select("id")
      .in("customer_id", customerIds);

    const orderIds = (orders ?? []).map((row) => row.id);
    if (orderIds.length > 0) {
      await supabase.from("orders").delete().in("id", orderIds);
      console.log(`  removed ${orderIds.length} orders`);
    }

    await supabase.from("customer_locations").delete().in("customer_id", customerIds);
    await supabase.from("customers").delete().in("id", customerIds);
    console.log(`  removed ${customerIds.length} customers`);
  }

  await supabase.from("suppliers").delete().eq("notes", SEED_TAG);
  await supabase.from("drivers").delete().in("slug", DRIVERS.map((d) => d.slug));
  await supabase.from("vehicles").delete().in("slug", VEHICLES.map((v) => v.slug));

  console.log("  removed drivers, vehicles, supplier");
  console.log("\nDone.\n");
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function upsertBySlug(table, rows) {
  const result = [];
  for (const row of rows) {
    const { data: existing } = await supabase
      .from(table)
      .select("id, name")
      .eq("slug", row.slug)
      .maybeSingle();

    if (existing) {
      result.push(existing);
      continue;
    }

    const { data, error } = await supabase.from(table).insert(row).select("id, name").single();
    if (error) throw error;
    result.push(data);
  }
  return result;
}

async function seed() {
  console.log(`Seeding development data into ${supabaseUrl}\n`);

  const drivers = await upsertBySlug("drivers", DRIVERS);
  console.log(`  drivers:  ${drivers.map((d) => d.name).join(", ")}`);

  const vehicles = await upsertBySlug("vehicles", VEHICLES);
  console.log(`  vehicles: ${vehicles.map((v) => v.name).join(", ")}`);

  // Supplier
  let { data: supplier } = await supabase
    .from("suppliers")
    .select("id")
    .eq("vat_number", SUPPLIER.vat_number)
    .maybeSingle();

  if (!supplier) {
    const { data, error } = await supabase.from("suppliers").insert(SUPPLIER).select("id").single();
    if (error) throw error;
    supplier = data;
  }
  console.log(`  supplier: ${SUPPLIER.name}`);

  // Customer + its three branches
  let { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("vat_number", CUSTOMER.vat_number)
    .maybeSingle();

  if (!customer) {
    const { data, error } = await supabase.from("customers").insert(CUSTOMER).select("id").single();
    if (error) throw error;
    customer = data;
  }

  const locations = [];
  for (const location of LOCATIONS) {
    const { data: existing } = await supabase
      .from("customer_locations")
      .select("id")
      .eq("customer_id", customer.id)
      .eq("location_name", location.location_name)
      .maybeSingle();

    if (existing) {
      locations.push(existing);
      continue;
    }
    const { data, error } = await supabase
      .from("customer_locations")
      .insert({ ...location, customer_id: customer.id })
      .select("id")
      .single();
    if (error) throw error;
    locations.push(data);
  }
  console.log(`  customer: ${CUSTOMER.name} (${locations.length} locations)`);

  // Orders — created through the real RPC, so they exercise exactly the same
  // path the Admin UI uses, including item/unit generation.
  const today = new Date().toISOString().slice(0, 10);
  console.log("");

  for (const [index, spec] of ORDERS.entries()) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id, order_number")
      .eq("supplier_document_number", spec.document)
      .maybeSingle();

    if (existing) {
      console.log(`  order GR-${String(existing.order_number).padStart(3, "0")} already exists`);
      continue;
    }

    const location = locations[index % locations.length];

    const { data, error } = await supabase.rpc("gorush_create_order", {
      payload: {
        supplier_id: supplier.id,
        supplier_document_number: spec.document,
        supplier_document_date: today,
        supplier_reference: spec.reference,
        source_type: "manual",
        customer_id: customer.id,
        customer_location_id: location.id,
        delivery_recipient: CUSTOMER.name,
        delivery_address_line1: LOCATIONS[index % LOCATIONS.length].address_line1,
        delivery_postal_code: LOCATIONS[index % LOCATIONS.length].postal_code,
        delivery_city: LOCATIONS[index % LOCATIONS.length].city,
        delivery_province: LOCATIONS[index % LOCATIONS.length].province,
        planned_delivery_date: today,
        driver_id: drivers[index].id,
        vehicle_id: vehicles[index].id,
        requires_payment_on_delivery: spec.cash,
        amount_to_collect: spec.amount != null ? String(spec.amount) : null,
        collection_method: spec.cash ? "numerar" : null,
        payment_method: spec.cash ? "contrassegno" : null,
        created_by: "seed-script",
        items: spec.items.map((item) => ({
          ...item,
          quantity: String(item.quantity),
          width: item.width != null ? String(item.width) : null,
          aspect_ratio: item.aspect_ratio != null ? String(item.aspect_ratio) : null,
          rim_diameter: item.rim_diameter != null ? String(item.rim_diameter) : null,
          unit_price: item.unit_price != null ? String(item.unit_price) : null,
        })),
      },
    });

    if (error) throw error;

    const label = `GR-${String(data.order_number).padStart(3, "0")}`;
    console.log(
      `  ${label} -> ${drivers[index].name} / ${vehicles[index].name}` +
        `  (${data.inventory_unit_count} obiecte fizice)`
    );
  }

  console.log("\nDone. Sign in at /admin with test / test.\n");
}

try {
  await (cleaning ? clean() : seed());
} catch (error) {
  console.error("\nSeed failed:", error?.message ?? error, "\n");
  process.exit(1);
}
