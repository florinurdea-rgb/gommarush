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

---

## Approved commercial decisions — 2026-09-21

Owner decisions, recorded so they are not re-litigated. **PLANNED: none of
this is implemented.** They constrain the design; they are not a work order.

### Customer-facing identity

- **The customer buys only from GommaRush.** There is no circumstance in which
  a customer contracts with a supplier.
- **Supplier identity is completely invisible to customers** — not obscured,
  not shown on request, not present in any customer-facing payload. This
  extends the confidentiality boundary in
  [`01_SUPPLIER_ARCHITECTURE.md`](01_SUPPLIER_ARCHITECTURE.md) from cost data
  to identity itself.

### Fulfilment classes

| Class | Promise | Sourcing |
| --- | --- | --- |
| **Standard** | up to ~7 days | Deldo / Inter-Sprint, consolidated |
| **Express** | ~24–48h | initially **manual**, from the Italian supplier |

> Express is currently expected to be roughly **15–20% of orders**. This is a
> **planning assumption for capacity, not a business rule** — nothing may
> enforce, cap or depend on it.

Customers choose a **GommaRush service level**, never a supplier. The same
tyre may be served by either class from different lanes.

### Purchasing is not ordering

- **Customer order acceptance and supplier purchase/release are separate
  events**, with separate lifecycles and separate timing.
- **Several customer orders may feed one supplier purchasing batch.**
- Suppliers impose **minimum order quantities and consolidation** (Inter-Sprint
  documents 60 PCR / 10 truck). These must be supported internally as supplier
  commercial rules read by sourcing — never as scattered checks, and never
  exposed to the customer.
- A customer order may therefore be **accepted before** the supplier batch that
  will fulfil it is released.

> **Delivery promises must eventually account for consolidation and cut-off
> timing, not raw supplier availability.** Showing a supplier's "in stock" as a
> delivery date ignores the batch the order is waiting for, and would promise a
> date GommaRush cannot keep. This is the mechanism behind the existing rule
> that an observation is not availability.

### Stock condition: normal, older-DOT, Demo

- **Normal, older-DOT and Demo stock must remain distinguishable** end to end.
- **Older-DOT may be offered as a clearly identified cheaper GommaRush
  option** — identified by condition and price, never by supplier.
- **The supplied DOT year is preserved** as the supplier gave it. The Deldo
  feed already supplies it (`Dot`, e.g. `2022`); it is not inferred.
- **What Deldo's `Demo` flag means is NOT verified and must not be inferred.**
  Until the supplier confirms it, Demo stock is carried as an unexplained
  supplier attribute and must not drive pricing or a customer-facing claim.
- **The exact supplier listing/article must survive through sourcing and
  ordering.** A cheaper older-DOT offer is a *specific* listing
  (`DELDO:BR672722`, not `DELDO:BR6727`), and buying the wrong one delivers
  stock the customer did not agree to. This is why `old_dot` lives on the
  listing and the listing identity is carried, not re-derived.

### Orders and money — V1

- **Payment methods:** bank transfer, POS on delivery, cash. No online card
  payment in V1.
- **Every customer order receives manual GommaRush review** before it is
  committed to a supplier. V1 is deliberately not straight-through.
- **Customer-specific pricing must be supported architecturally.** A default
  rule applies, with per-customer rules layered above it — see
  [`03_PRICING_PFU_VAT.md`](03_PRICING_PFU_VAT.md). The values themselves
  remain an OWNER_DECISION.

### One engine, several front doors

**The portal and WhatsApp must eventually use the same catalogue, pricing and
order engine.** They are channels, not systems. A second pricing path built
behind a chat interface would diverge from the portal's within weeks, and the
customer would be quoted two different prices for the same tyre.
