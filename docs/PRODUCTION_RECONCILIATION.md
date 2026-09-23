# Production reconciliation (M11A)

Evidence-based classification of what is in the production database, what may
safely be removed, and what M11B needs from the catalogue layer.

**Everything in this document is the result of READ-ONLY inspection on
2026-09-22. No production data was mutated in M11A.**

---

## 1. Classification matrix

`PRESERVE` — real data or load-bearing configuration. Never reset.
`RESET` — provably dummy/test. Proposed, **not executed**.
`VERIFY` — cannot be classified from evidence available; needs an owner answer.

| Table | Rows | Class | Why |
| --- | ---: | --- | --- |
| `catalogue_products` | 13,183 | **PRESERVE** | 9,550 legacy + 3,633 from the two verified M10 runs |
| `supplier_product_listings` | 13,206 | **PRESERVE** | all `ISB:`-keyed, all traceable to an import run |
| `supplier_listing_prices` | 20,924 | **PRESERVE** | 11,365 are the real verified observations |
| `product_identifiers` | 40,993 | **PRESERVE** | EAN/article resolution; FK-dependent |
| `catalogue_import_runs` | 3 | **PRESERVE** | two verified M10 runs + the legacy run they reconcile against |
| `catalogue_import_rows` | 20,937 | **PRESERVE (retention candidate)** | committed staging; see §5 — 87 MB, 62% of the database |
| `catalogue_conflicts` | 1,555 | **PRESERVE** | reconciliation evidence, all `status='open'` |
| `suppliers` | 16 | **MIXED** | see §2 |
| `customers` | 14 | **PRESERVE / VERIFY** | real Italian tyre shops; 2 duplicate pairs to merge, not delete |
| `customer_locations` | 16 | **PRESERVE** | FK to customers |
| `orders` | 26 | **MIXED** | see §2 |
| `order_items` | 44 | follows `orders` | FK |
| `order_status_history` | 44 | follows `orders` | FK |
| `order_documents` | 57 | follows `orders` | FK + storage objects |
| `inventory_units` | 102 | follows `orders` | FK |
| `inventory_scans` | 0 | — | empty |
| `inventory_incidents` | 0 | — | empty |
| `drivers` | 3 | **VERIFY** | operational identities; not inspected for PII here |
| `vehicles` | 10 | **PRESERVE** | fleet configuration |
| `warehouse_zones` | 8 | **PRESERVE** | configuration |
| `quote_requests` / `_items` / `_events` | 2 / 2 / 10 | **VERIFY** | real customer enquiries or test submissions — undetermined |
| `supplier_customer_refs` | 13 | **PRESERVE** | supplier↔customer mapping |
| `app_settings` | 2 | **PRESERVE** | configuration |
| `print_jobs` | 2 | **VERIFY** | already scheduled for retirement by migration |
| `client_offer_requests` | 0 | — | already retired |
| `geocode_cache`, `supplier_locations`, `document_charges` | 0 | — | empty |

---

## 2. Suppliers and orders

**Every supplier except two is referenced by at least one order**, so almost
nothing is freely deletable.

### Proposed RESET — NOT EXECUTED

One set is provable:

| Record | Proof it is dummy |
| --- | --- |
| Supplier `Furnizor Demo (test)` `6edece30…` | Name states both *Demo* and *(test)* |
| Its 7 orders, numbers 83–89 | **All** have `customer_id NULL`, **all** `status='expected'`, **all** created 2026-08-18, sequential numbering, **zero** documents, uniform shape (1 item, 2–4 units) |
| ~26 `inventory_units`, 7 `order_items`, their `order_status_history` | FK children of those orders |

A real transport order has a customer. Seven consecutive customer-less orders
created in one batch against a supplier named "(test)" is a seeded fixture.

**Still not executed**, because deleting production business data requires a
backup this session cannot take, and the manifest should be confirmed by the
owner first.

### VERIFY — explicitly NOT reset

| Record | Why it is ambiguous |
| --- | --- |
| Supplier `Name` `0b31299b…` | Placeholder name, but its order #222 is **delivered** to a real customer (CARLOTTO PNEUMATICI). A real delivery with a mistyped supplier — a rename/merge, not a deletion |
| Supplier `asdas` `4ce0b557…` | **This is Inter-Sprint.** Rename only — see §3 |
| Order #60 on `asdas` | `cancelled`, real customer, has a document. Plausibly a genuine early trial |
| `Snipolti Srl`, `Zuin Gomme` | 0 orders, 0 listings. Orphans, but may be legitimate supplier definitions |
| ZUIN ×4, FINTYRE ×2, CARLINI ×2 variants | Duplicates (owner decision D2). **Merge candidates, not delete candidates** — each carries orders |
| `Rossi Gomme SRL`, `Autogomme Rossi` | "Rossi" is the Italian "Smith" and common in demos, but both carry orders. **Cannot be proven dummy from a name** |

Age was not used as evidence anywhere in this table.

---

## 3. Inter-Sprint identity — re-established

The M10 verification used a **listing count** (9,559) as its fingerprint. That
was mutable and is now stale. Identity is re-established here on **provenance**,
which does not change when a feed imports.

Verified 2026-09-22:

| Evidence | Result |
| --- | --- |
| Suppliers with an `intersprint-feed`/`isb` import run | **exactly 1** — `4ce0b557…` |
| Suppliers holding any `ISB:`-prefixed listing key | **exactly 1** — `4ce0b557…` |
| Listings on that supplier whose key is **not** `ISB:` | **0** of 13,206 |
| Import runs attached to it | 3 (both verified M10 runs + legacy) |
| Suppliers named `asdas` | exactly 1 |
| Suppliers already named Inter-Sprint | 0 — no collision possible |

The supplier is the one and only row the Inter-Sprint feed adapter writes to,
evidenced by committed import runs. That holds however many listings exist.

**Target name: `Inter-Sprint`** — the platform label the UI needs. No legal
entity name is asserted: nothing in this repository establishes one, and none
is required to label a supplier.

A replacement operation is prepared at
`supabase/pending-approval/0003_intersprint_supplier_rename.sql`. It is
**not applied**, is idempotent, and guards on provenance rather than counts.

---

## 4. What M11B needs from the catalogue layer

### 4.1 Car/Van vs Truck — deterministic, no inference required

`supplier_product_listings.last_import_run_id` is populated on **all 13,206**
rows, and `catalogue_import_runs.notes` carries `category=pcr|truck` written
from the feed header. Falling back to `product_class` for legacy rows gives
**100% coverage**:

| Source | Listings |
| --- | ---: |
| Run provenance (`category=pcr`) | 9,679 |
| Run provenance (`category=truck`) | 171 |
| Legacy `product_class` fallback | 3,356 |
| **Unclassifiable** | **0** |

### 4.2 Latest observation

`supplier_listing_prices_listing_idx (supplier_listing_id, observed_at DESC)`
already exists, so `DISTINCT ON (supplier_listing_id) … ORDER BY
supplier_listing_id, observed_at DESC` is an index-ordered scan. No change
needed; `catalogue-search.ts` already fetches it this way.

### 4.3–4.4 Supplier filter and All-Suppliers comparison

Supplier filtering is served by
`supplier_product_listings_supplier_active_idx (supplier_id, active)`.

For comparison, group on **`catalogue_product_id`** — the identity the
catalogue already guarantees, backed by a unique index on validated EAN and on
`product_key`. **No fuzzy matching is needed or permitted.** Two suppliers
offering the same tyre converge only when they resolve to the same product,
which is exactly the existing EAN rule. Where they do not converge, show them
as separate rows rather than merging on brand/size similarity.

### 4.5 Conflicts

1,555 rows, all `status='open'`, already carry
`supplier_listing_key`, both product ids, field, existing and incoming value.
Surface them as a review queue keyed on the listing. **Never** resolve one
using the `Type` column — see §6.

### 4.6 Listings with no current observation

1,841 active listings have no cost on their latest observation. They must be
**visibly flagged, not hidden and not deactivated** (D14 is open). Recommended
state: `stale_no_current_price`, excluded from customer projections by the
existing selling policy (unknown stock is already not sellable) but present and
labelled for an operator.

### 4.7 Freshness

Per listing, from `max(observed_at)`. Feed-level freshness already exists in
`src/lib/server/feed-status.ts`. Commercial freshness stays with
`classifyObservation`, which requires a caller-supplied policy — unchanged.

### 4.8 Index coverage

| Filter | Index | Status |
| --- | --- | --- |
| width / +aspect / +rim / +season | `catalogue_products_size_idx` | ✅ prefix-usable |
| brand | `catalogue_products_brand_idx` | ✅ |
| supplier | `supplier_product_listings_supplier_active_idx` | ✅ |
| latest observation | `supplier_listing_prices_listing_idx` | ✅ |
| EAN / article / manufacturer code | 3 dedicated indexes | ✅ |
| incomplete records | `catalogue_products_review_idx` (partial) | ✅ |
| **`product_class`** | — | ❌ **missing** |
| **season alone** | 4th column of the size index | ❌ not usable alone |
| **`catalogue_products.active`** | — | ❌ missing; every query filters it |

Two indexes are proposed in
`supabase/pending-approval/0004_m11b_catalogue_indexes.sql` — **not applied**.

---

## 5. Retention (designed, not executed)

Measured per-row cost and per-import growth:

| Table | Bytes/row | Rows per changed feed | Growth per import |
| --- | ---: | ---: | ---: |
| `catalogue_import_rows` | **4,348** | ~11,378 | **~47 MB** |
| `supplier_listing_prices` | 217 | ~11,378 | ~2.4 MB |

At three changed feeds a day: **~51 GB/year of staging rows** against ~2.6 GB
of price history. The database is 140 MB today and **87 MB of it (62%) is
already staging**.

**The retention problem is staging, not price history** — and staging is the
part whose value expires. `catalogue_import_rows` holds `raw_payload` plus
`normalized_payload` per row so a run can be previewed and resumed; once a run
is `committed` and its conflicts triaged, only the audit trail matters.

Proposed, for a later mission:

1. **`catalogue_import_rows`** — after a run is `committed` and older than N
   days, drop `normalized_payload` (derivable) and keep `raw_payload` only for
   rows whose action was `conflict` or `rejected`. Retains every row that
   explains a decision; discards the ~95% that were `unchanged`.
2. **`supplier_listing_prices`** — keep all observations for N days, then
   thin to one per listing per day, always retaining the latest. Price history
   stays useful for analysis at a fraction of the rows.
3. **`catalogue_conflicts`** — no time-based deletion. Retire on
   `status` transition, once a resolution workflow exists.

Nothing here runs automatically. Each needs a measured threshold and an owner
decision, and no history is deleted in M11A.

---

## 6. F1 — the 3,633 products missing season and class

M10 recorded that these carry NULL `season`, `product_class`, `size_display`
and `xl`, because the adapter refuses to invent them.

**New evidence found in M11A: the supplier does state both, in a column the
adapter does not currently map.**

`group description` is carried in the feed and preserved verbatim in
`catalogue_import_rows.raw_payload`. Correlating it against the 6,215 legacy
rows that have *both* a feed row and a populated `product_class`:

| `group description` | `product_class` | rows | seasons observed |
| --- | --- | ---: | --- |
| `LUXE BANDEN` | `passenger_car` | 2,880 | summer |
| `ALL-SEASON PW` | `passenger_car` | 1,409 | all_season |
| `4 X 4` | `suv_4x4` | 960 | summer |
| `LUXE BANDEN M&S` | `passenger_car` | 690 | winter |
| `ALL-SEASON 4X4/SUV` | `suv_4x4` | 469 | **all_season / summer** ⚠ |
| `MOTORFIETSBANDEN` | `motorcycle` | 285 | (null) |
| `4 X 4 M&S` | `suv_4x4` | 237 | winter |
| `BESTELWAGEN BANDEN` | `light_truck_van` | 226 | summer |
| `RUNFLAT BANDEN` | `passenger_car_runflat` | 203 | summer |
| `ALL-SEASON LIGHT-TRU` | `light_truck_van` | 202 | all_season |
| `RUNFLAT BANDEN M&S` | `passenger_car_runflat` | 58 | winter |
| `BESTELWAGEN BANDEN M` | `light_truck_van` | 49 | winter |
| `SCOOTER BANDEN` | `scooter` | 27 | (null) |
| `ALL-SEASON RUNFLAT` | `passenger_car_runflat` | 22 | all_season |

**`product_class` is 1:1 with `group description` on every group.** Season is
1:1 too, with one exception.

This is **not invention**. It is the supplier's own merchandising group, and
almost certainly how the legacy values were derived upstream in the first place.

Recommended, subject to owner sign-off:

1. Map `group` and `group description` in the adapter as real supplier fields,
   carried verbatim. They are currently discarded.
2. Derive `product_class` from an **explicit lookup table**, never a
   substring heuristic. An unrecognised group yields NULL, not a guess.
3. Derive `season` the same way. `ALL-SEASON*` is the supplier's own word.
   `MOTORFIETSBANDEN`/`SCOOTER BANDEN` correctly yield NULL.
4. **Resolve the `ALL-SEASON 4X4/SUV` inconsistency first.** 469 legacy rows in
   one group carry two different seasons, which is a legacy data-quality defect,
   not a feed ambiguity.

Two cautions:

- The mapping is empirical — proven across 6,215 of our own rows, **not stated
  in any Inter-Sprint document**. Record it as derived evidence, not supplier
  fact.
- `group description` is **truncated to 20 characters** by the feed
  (`BESTELWAGEN BANDEN M`, `ALL-SEASON LIGHT-TRU`), the same fixed-width
  truncation that makes `Type` unreliable. The lookup table must key on the
  truncated form exactly as delivered.

**UX rule for M11B:** a tyre with no season must remain findable. The admin
catalogue defaults to showing unclassified records with a badge, and
`catalogue_products_review_idx` already indexes exactly this set. Customer
projections may stay stricter.
