import "server-only";
import { createOrder } from "@/lib/server/orders";
import { findOrCreateSupplier, listVehicles } from "@/lib/server/reference";
import { logEvent } from "@/lib/logger";

/**
 * Explicitly requested test/demo data for trying out the new driver route
 * viewer (/driver/route) and the Livrări board — NOT something this app
 * normally does (the rest of the system deliberately never fabricates
 * operational data). Every demo order is clearly labeled so it's trivial
 * to find and delete later:
 *   - supplier: "Furnizor Demo (test)" — a single dedicated supplier record
 *   - supplier_document_number: "DEMO-…" prefix
 *   - delivery_notes: "DEMO — comandă de test, poate fi ștearsă"
 *   - customer name: "Client Demo — …" prefix
 * One or two orders land on each active van (today's date, so they show up
 * on /driver/route/[vehicleId] immediately) and a couple stay unassigned
 * for the Livrări board's "Neasignate" lane.
 */

const DEMO_TYRES = [
  { brand: "Michelin", model: "Primacy 4", width: 205, aspect_ratio: 55, rim_diameter: 16, quantity: 4 },
  { brand: "Pirelli", model: "P Zero", width: 225, aspect_ratio: 45, rim_diameter: 17, quantity: 4 },
  { brand: "Continental", model: "PremiumContact 6", width: 195, aspect_ratio: 65, rim_diameter: 15, quantity: 4 },
  { brand: "Bridgestone", model: "Turanza T005", width: 215, aspect_ratio: 60, rim_diameter: 16, quantity: 2 },
  { brand: "Goodyear", model: "EfficientGrip", width: 185, aspect_ratio: 60, rim_diameter: 15, quantity: 4 },
  { brand: "Dunlop", model: "SP Sport", width: 235, aspect_ratio: 40, rim_diameter: 18, quantity: 4 },
];

const DEMO_CUSTOMERS = [
  { name: "Client Demo — Rossi Gomme Srl", address: "Via Roma 12", city: "Verona", postal: "37121" },
  { name: "Client Demo — Bianchi Auto Service", address: "Via Milano 45", city: "Vicenza", postal: "36100" },
  { name: "Client Demo — Officina Verdi", address: "Corso Garibaldi 8", city: "Padova", postal: "35100" },
  { name: "Client Demo — Neri Pneumatici", address: "Via Torino 30", city: "Verona", postal: "37122" },
  { name: "Client Demo — Gialli Trasporti", address: "Via Napoli 3", city: "Legnago", postal: "37045" },
  { name: "Client Demo — Blu Gomme Express", address: "Via Firenze 17", city: "San Bonifacio", postal: "37047" },
  { name: "Client Demo — Verdi Truck Center", address: "Via Bologna 22", city: "Villafranca di Verona", postal: "37069" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function seedDemoOrders(changedBy: string): Promise<{ created: number }> {
  const supplier = await findOrCreateSupplier({ name: "Furnizor Demo (test)" });
  const vehicles = await listVehicles();
  const today = todayIso();

  let created = 0;

  async function createOne(vehicleId: string | null) {
    const customer = DEMO_CUSTOMERS[created % DEMO_CUSTOMERS.length];
    const tyre = DEMO_TYRES[created % DEMO_TYRES.length];
    const rawDescription = `${tyre.width}/${tyre.aspect_ratio} R${tyre.rim_diameter} ${tyre.brand} ${tyre.model}`;

    await createOrder(
      {
        supplier_id: supplier.id,
        supplier_document_number: `DEMO-${Date.now()}-${created}`,
        source_type: "manual",
        customer_id: null,
        customer_location_id: null,
        delivery_recipient: customer.name,
        delivery_address_line1: customer.address,
        delivery_city: customer.city,
        delivery_postal_code: customer.postal,
        delivery_country: "IT",
        delivery_notes: "DEMO — comandă de test, poate fi ștearsă",
        planned_delivery_date: today,
        auto_allocate_stand: true,
        vehicle_id: vehicleId,
        items: [
          {
            item_type: "tyre",
            quantity: tyre.quantity,
            raw_description: rawDescription,
            description: rawDescription,
            brand: tyre.brand,
            model: tyre.model,
            width: tyre.width,
            aspect_ratio: tyre.aspect_ratio,
            rim_diameter: tyre.rim_diameter,
          },
        ],
      },
      changedBy
    );
    created += 1;
  }

  for (const vehicle of vehicles.slice(0, 5)) {
    await createOne(vehicle.id);
  }
  // A couple unassigned too, for the Livrări board's "Neasignate" lane.
  await createOne(null);
  await createOne(null);

  logEvent("demo_orders_seeded", { created, changedBy });
  return { created };
}
