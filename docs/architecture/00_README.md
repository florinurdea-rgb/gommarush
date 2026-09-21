# GommaRush — Architecture

What the system **is**, and what it is **meant to become**. Read before
proposing supplier, pricing or sourcing implementation.

## Status markers

Every architectural claim in this package carries one. A claim without a marker
should be treated as unverified.

| Marker | Meaning |
| --- | --- |
| **IMPLEMENTED** | Exists in `main`, exercised by tests or proven in production |
| **PARTIAL** | Exists but incomplete or not wired end to end |
| **PLANNED** | Agreed direction. No code. |
| **BLOCKED** | Cannot proceed; the blocker is named |
| **DEPRECATED** | Exists but is being retired |

**Do not document planned behaviour as implemented.** This package was
reconciled on 2026-09-21 against the repository at `main`, the production
database and the staging database, precisely because an earlier version of it
described integrations that did not exist.

## Files

| File | Covers |
| --- | --- |
| [`01_SUPPLIER_ARCHITECTURE.md`](01_SUPPLIER_ARCHITECTURE.md) | Canonical flow, product identity, normalized offer, capabilities, search, confidentiality |
| [`02_SUPPLIER_RULES.md`](02_SUPPLIER_RULES.md) | Per-lane rules: Inter-Sprint, Deldo, Italian ~48h |
| [`03_PRICING_PFU_VAT.md`](03_PRICING_PFU_VAT.md) | Markup, PFU, VAT, rounding, price snapshots |
| [`04_SALES_SOURCING_MODEL.md`](04_SALES_SOURCING_MODEL.md) | Sales order, sourcing, supplier purchase, transport boundary |

Database reality and the migration plan are in
[`../DATABASE_BASELINE.md`](../DATABASE_BASELINE.md).

## The two business flows

These are **separate businesses sharing one warehouse and one fleet.** Their
commercial and accounting logic must never merge.

| | SALES | TRANSPORT |
| --- | --- | --- |
| Goods | GommaRush buys and owns them | Belong to the distributor/supplier |
| Revenue | Product margin | Transport fee |
| Customer | Tyre shop / end customer buying tyres | Distributor paying for delivery |
| Status | **PLANNED** — no sales entity exists | **IMPLEMENTED** — live, 26 orders |

The existing `orders` table is the **TRANSPORT** entity. It carries both
`supplier_id` and `customer_id` plus `transport_rate_snapshot` and
`transport_revenue`: a consignment moved on someone else's behalf. It is **not**
a customer sales order, and must not be repurposed into one. A sales layer has
to exist *above* logistics, not inside it.

## Supplier lanes

1. **Inter-Sprint** — PRIMARY. Catalogue feed ingested (manual upload).
   Gateway transport code exists, never live-verified. Ordering disabled.
2. **Deldo** — SECONDARY. **BLOCKED**: no feed documentation available.
   Nothing implemented. Not to be confused with Inter-Sprint or EuroSprint.
3. **Italian ~48h supplier** — manual. Operators search and record
   observations by hand, into the same normalized model.

## Key principle

**Source technology must not dictate the business model.** API, FTP, CSV/XLSX
and manual observation all normalize into the same supplier / product / offer
model.
