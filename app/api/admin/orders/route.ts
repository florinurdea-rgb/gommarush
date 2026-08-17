import { NextRequest } from "next/server";
import { createOrderSchema } from "@/lib/validation/logistics";
import { createOrder } from "@/lib/server/orders";
import { resolveCustomerForOrder } from "@/lib/server/customers";
import { findOrCreateSupplier } from "@/lib/server/reference";
import { formatOrderNumber } from "@/lib/logistics/order-number";
import { fail, ok, readJsonBody, runAdminRoute, zodDetails } from "@/lib/server/route-helpers";
import type { CreateOrderItemInput } from "@/lib/server/orders";

export const runtime = "nodejs";

/**
 * POST /api/admin/orders — "Salvează" on the review screen.
 *
 * Order of operations matters:
 *   1. resolve the supplier (orders.supplier_id is NOT NULL)
 *   2. apply the Admin's explicit customer/location decision
 *   3. create order + items + inventory units + stand claim in ONE transaction
 *
 * Steps 1–2 are individually meaningful and idempotent, so they sit outside the
 * transaction; step 3 is all-or-nothing inside `gorush_create_order`, which is
 * what prevents an order existing without its physical units.
 */
export async function POST(request: NextRequest) {
  return runAdminRoute(async (session) => {
    const body = await readJsonBody(request);
    if (body === null) return fail(400, "VALIDATION_FAILED");

    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) return fail(400, "VALIDATION_FAILED", zodDetails(parsed.error));
    const input = parsed.data;

    // 1. Supplier.
    let supplierId = input.supplier_id ?? null;
    if (!supplierId && input.supplier_name) {
      const supplier = await findOrCreateSupplier({
        name: input.supplier_name,
        vatNumber: input.supplier_vat_number ?? null,
      });
      supplierId = supplier.id;
    }
    if (!supplierId) return fail(400, "SUPPLIER_REQUIRED");

    // 2. Customer + location, exactly as the Admin chose. Nothing here
    //    overwrites master data unless `update_existing_location` was picked.
    const resolved = await resolveCustomerForOrder({
      customerId: input.customer_id ?? null,
      newCustomer: input.new_customer ?? null,
      customerLocationId: input.customer_location_id ?? null,
      resolution: input.location_resolution,
      address: input.address,
      supplierId,
      supplierCustomerCode: input.supplier_customer_code ?? null,
    });

    const items: CreateOrderItemInput[] = input.items.map((item) => ({
      item_type: item.item_type,
      is_physical: item.is_physical,
      quantity: item.quantity,
      supplier_sku: item.supplier_sku ?? null,
      raw_description: item.raw_description ?? null,
      description: item.description ?? null,
      brand: item.brand ?? null,
      model: item.model ?? null,
      width: item.width ?? null,
      aspect_ratio: item.aspect_ratio ?? null,
      rim_diameter: item.rim_diameter ?? null,
      load_index: item.load_index ?? null,
      speed_rating: item.speed_rating ?? null,
      season: item.season ?? null,
      extra_load: item.extra_load ?? null,
      run_flat: item.run_flat ?? null,
      unit_price: item.unit_price ?? null,
      tax_rate: item.tax_rate ?? null,
      pfu_fee: item.pfu_fee ?? null,
      logistics_fee: item.logistics_fee ?? null,
      notes: item.notes ?? null,
      needs_review: item.needs_review ?? false,
      review_fields: item.review_fields ?? [],
      confidence: item.confidence ?? null,
    }));

    // 3. The atomic write.
    const result = await createOrder(
      {
        supplier_id: supplierId,
        supplier_document_number: input.supplier_document_number ?? null,
        supplier_document_date: input.supplier_document_date ?? null,
        supplier_reference: input.supplier_reference ?? null,
        source_type: input.source_type,
        customer_id: resolved.customerId,
        customer_location_id: resolved.customerLocationId,
        delivery_recipient: resolved.addressSnapshot.recipient_name ?? null,
        delivery_address_line1: resolved.addressSnapshot.address_line1 ?? null,
        delivery_address_line2: resolved.addressSnapshot.address_line2 ?? null,
        delivery_city: resolved.addressSnapshot.city ?? null,
        delivery_province: resolved.addressSnapshot.province ?? null,
        delivery_postal_code: resolved.addressSnapshot.postal_code ?? null,
        delivery_country: resolved.addressSnapshot.country_code ?? null,
        delivery_notes: resolved.addressSnapshot.delivery_notes ?? null,
        planned_delivery_date: input.planned_delivery_date ?? null,
        stand_code: input.stand_code ?? null,
        auto_allocate_stand: input.auto_allocate_stand && !input.stand_code,
        driver_id: input.driver_id ?? null,
        vehicle_id: input.vehicle_id ?? null,
        requires_payment_on_delivery: input.requires_payment_on_delivery,
        payment_method: input.payment_method ?? null,
        amount_to_collect: input.amount_to_collect ?? null,
        collection_method: input.collection_method ?? null,
        currency: input.currency,
        notes: input.notes ?? null,
        source_document_id: input.source_document_id ?? null,
        items,
      },
      session.subject
    );

    return ok(
      {
        orderId: result.orderId,
        orderNumber: result.orderNumber,
        orderNumberLabel: formatOrderNumber(result.orderNumber),
        standCode: result.standCode,
        // 'STAND_OCCUPIED' / 'NO_STAND_AVAILABLE' — the UI must show this, not
        // pretend the order got a stand.
        standWarning: result.standWarning,
        inventoryUnitCount: result.inventoryUnitCount,
      },
      201
    );
  });
}
