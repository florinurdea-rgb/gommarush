# Supplier Architecture

**Objective:** let GommaRush search one tyre and compare real sourcing options
across suppliers, without ever exposing supplier identity or cost to a customer.

## Canonical flow

```
supplier source (API / FTP / XLSX / manual)
  → supplier adapter                    IMPLEMENTED for ISB only
  → catalogue product identity          IMPLEMENTED
  → supplier listing                    IMPLEMENTED
  → price / stock observation           IMPLEMENTED (schema) · EMPTY (no data)
  → internal sourcing                   PLANNED
  → pricing                             PLANNED
  → customer offer                      PLANNED
  → sales order                         PLANNED
  → sourcing allocation                 PLANNED
  → supplier purchase                   PLANNED
  → logistics order                     IMPLEMENTED (transport flow)
```

Everything from *internal sourcing* rightwards is absent from `main`.

## Product identity — IMPLEMENTED

`catalogue_products` is supplier-independent: canonical specifications only, no
price, no stock, no physical unit. A product is never deleted because a supplier
file stopped listing it.

EAN is the strongest bridge between suppliers and is validated against its own
GS1 check digit at ingestion — a supplier's own `ean_status` column is treated
as evidence, never authority. `product_identifiers` records every code that has
ever resolved to a product (EAN/GTIN, manufacturer code, supplier article code)
with a `normalized_value` that the warehouse scanner queries.

Also retained: brand, model/pattern, width, aspect ratio, rim, load index, speed
index, season, class, run-flat, XL, EPREL id, and `weight_kg` with
`weight_status` (`supplier_reported` | `missing_or_zero`).

**A supplier listing is not a catalogue product.** `supplier_product_listings`
is one supplier's commercial listing of one product; two listings may share a
product (for example new stock versus old DOT).

## Normalized offer / observation — PARTIAL

`supplier_listing_prices` holds one row **per observation**, deliberately
separated from the product so a price refresh cannot rewrite specifications and
a product query cannot leak a cost.

Present today: `purchase_price`, `currency`, `stock_raw`, `stock_exact`,
`stock_minimum`, `observed_at`, `import_run_id`.

> **The table is populated but empty of commercial data.** All 9,559 rows in
> production have `purchase_price = NULL` and no stock. The ISB catalogue file
> carried no price or stock column. Verified 2026-09-21.

Not yet modelled, needed before sourcing: stock confidence, lead time / delivery
class, separate `price_verified_at` and `stock_verified_at`, source type, PFU
data, DOT, and per-observation ordering status.

## Capabilities — PLANNED on `main`

Capabilities are **explicit rows, never inferred** from the existence of an
integration, a file or a credential. **Absence means unavailable.**

Capability vocabulary: `catalogue_feed`, `price_feed`, `stock_feed`,
`live_stock_lookup`, `live_price_lookup`, `test_ordering`,
`production_ordering`, `order_status`, `delivery_documents`, `invoices`.

A working implementation of this model exists on `claude/sleepy-gauss-lezg26`
and is live in the **staging** database (`supplier_capabilities`,
`supplier_commercial_rules`), including a check constraint that makes enabling
supplier ordering structurally impossible in V1. It is **not** in `main` and
requires a migration. See [`../DATABASE_BASELINE.md`](../DATABASE_BASELINE.md)
§5 for the proposed port.

Supplier commercial terms (minimum order quantities, prepayment/balance gating)
belong in that model as data — read by sourcing, never by an adapter, and never
scattered as hard-coded checks.

## Search strategy — PLANNED

Search queries GommaRush's **local** normalized catalogue. Do **not**
synchronously call every supplier on every search: it is slow, it leaks intent,
and it fails when a supplier does.

Bulk feeds populate searchable data. Live supplier lookups selectively validate
freshness, and should be used before automated purchasing where available.

An observation without a recent `observed_at` is **not** a customer promise. A
freshness control must gate what may be shown as available.

## Customer confidentiality — IMPLEMENTED at the schema boundary

Public and customer-facing queries must never expose supplier identity, supplier
purchase price, supplier credentials, internal sourcing score, or integration
metadata.

`supplier_listing_prices` is documented as supplier cost data that must never be
reachable from a customer-facing query, and the public lookup
(`publicTyreLookup`) enforces a fixed projection as its security boundary —
that projection, not the caller, is what keeps costs out of a response.

Customer-facing choices describe **GommaRush service levels**, never suppliers.
