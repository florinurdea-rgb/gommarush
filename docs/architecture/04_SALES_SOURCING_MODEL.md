# Sales & Sourcing Model

**Status: PLANNED.** No sales order, sourcing allocation or supplier purchase
entity exists in `main` (verified 2026-09-21). The only customer-facing intake
today is `quote_requests`, which is free-text and not catalogue-backed.

## The four entities

Collapsing any two of these corrupts accounting. They are separate.

| Entity | Answers | Status |
| --- | --- | --- |
| **Sales order** | What the customer bought from GommaRush | PLANNED |
| **Sourcing allocation** | Where each unit will come from | PLANNED |
| **Supplier purchase** | What GommaRush bought, from whom | PLANNED |
| **Transport job** (`orders`) | What physically moves, and who pays to move it | IMPLEMENTED |

## Sales order

Represents what GommaRush sold.

- **It must not require a supplier at creation.** A customer buys from
  GommaRush, not from Inter-Sprint.
- May begin in a `NEEDS_SOURCING` state.
- Sources: public website, customer portal, quote conversion, WhatsApp,
  email, phone, admin/manual entry, and a future AI sales agent.
- Carries the immutable price snapshot (see
  [`03_PRICING_PFU_VAT.md`](03_PRICING_PFU_VAT.md)).

## Sourcing

Determines where GommaRush obtains each tyre, during or after preparing the
customer offer.

One sales item may be fulfilled from Inter-Sprint, Deldo, the Italian manual
supplier, a future supplier, or own stock.

- **Split allocation must be possible.** A customer ordering 8 identical tyres
  may be served 4 from one supplier and 4 from another.
- **Never encode the supplier as the immutable identity of the customer sales
  item.** The customer's purchase does not change because sourcing did.

## Supplier purchase

Separate from the sales order. May be `MANUAL`, `TEST_ONLY`, or `API_ENABLED`
later.

**Automated supplier ordering is out of scope until explicitly approved.** It is
an OWNER_DECISION, and every supplier lane currently has production ordering
deliberately disabled.

Supplier commercial terms gate this step — minimum release quantities and
prepaid-balance rules are read from supplier commercial rules as data.

## Boundary with existing logistics

Once goods are expected inbound, a supplier purchase connects to the existing
`orders` flow for warehouse receipt, storage, loading and delivery.

> **`orders` is the transport entity.** It carries `supplier_id`,
> `customer_id`, `transport_rate_snapshot` and `transport_revenue` — a
> consignment moved on someone else's behalf. Do not remove its supplier
> relationship and do not repurpose it into a customer sales-order table. The
> sales layer sits **above** logistics.

**Do not destabilise the live warehouse, loading, driver and delivery system
while building the sales layer.** It is in daily use — 26 orders, 102 inventory
units, 3 drivers, 10 vehicles in production.

## Relationship to the two business flows

- **SALES**: sales order → sourcing → supplier purchase → inbound → delivery to
  the customer. GommaRush owns the goods and earns product margin.
- **TRANSPORT**: a distributor's goods move to *their* customer. There is no
  sales order and no product margin — the revenue is the transport fee.

Both may produce a transport job. **Only the first produces a sales order.**
