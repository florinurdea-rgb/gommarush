# Supplier Integration

Phase 1 of the supplier integration program: the minimum clean supplier-neutral
foundation needed to carry Inter-Sprint and Deldo, plus the unified internal
search layer that sits on top of it.

Canonical specification: [`architecture/`](architecture/).
Working rules: [`../CLAUDE.md`](../CLAUDE.md).

---

## 1. What is blocked, and why

Two of the three headline objectives cannot be completed in this repository as
it stands, because the material they depend on does not exist here. Nothing has
been invented to paper over that.

| Blocked | Exact missing prerequisite |
| --- | --- |
| **Inter-Sprint FTP delivery** | FTP host, credentials, directory path and file cadence. None present in the repo or the environment. |
| **Inter-Sprint Gateway / Protocol 103** | The Inter-Sprint protocol documentation. `02_SUPPLIER_RULES.md` *references* Protocol 103 for extended stock search, but referencing a protocol is not documenting it. Undocumented protocol behaviour must not be inferred. |
| **Deldo ingestion (any)** | Deldo's feed documentation: file/FTP mechanism, delivery path, file format and column contract. Without the column contract a parser would silently mis-map real commercial data. |
| **Deldo order XML** | The XML schema. Out of scope regardless — sending a real order is an `OWNER_DECISION`. |

What this means in practice: **no supplier feed can currently be fetched.** The
ingestion pipeline, the adapter contract, the observation model, the freshness
logic and the search layer are all complete and tested; they are waiting on
credentials and format documentation, not on code.

### What was buildable, and on what authority

The Inter-Sprint **catalogue parser is real**, because production contains the
real thing: 9,559 ISB rows ingested on 2026-09-08, with their untouched source
preserved in `catalogue_import_rows.raw_payload`. Under the precedence rule in
`CLAUDE.md` §0 a proven production fact outranks the specification, so the
parser is written against that verified contract rather than against a guess.

Verified field domains, observed across all 9,559 rows:

```
data_status      NEEDS_EAN | NEEDS_EAN_AND_WEIGHT | NEEDS_WEIGHT | READY | REVIEW_REQUIRED
product_class    light_truck_van | motorcycle | old_dot | passenger_car |
                 passenger_car_runflat | scooter | spare | suv_4x4
season           all_season | not_applicable | summer | winter
weight_status    missing_or_zero | supplier_reported
weight_category  1 | 2 | 3 | 4
european         J | N          booleans  "0" / "1"
product_key      GTIN:<ean> when trustworthy, else ISB:<article_id>
```

**The ISB catalogue file carries no price and no stock column.** Every offer the
parser emits therefore has `purchasePriceNet = null` and
`stockStatus = "unknown"`. That is a fact about the feed, not a defect.

---

## 2. Architecture

```
supplier file / feed / operator
            ↓
     SupplierAdapter          parse + normalize, facts only
            ↓
      SupplierOffer           one shape for every lane
            ↓
   ingestion pipeline         fetch → validate → normalize → stage → verify → commit
            ↓
  supplier_listing_prices     time-series observations (incl. test data)
            ↓
supplier_commercial_observations   ← THE QUERY BOUNDARY (excludes test data)
            ↓
    search / ranking          internal operator view only
```

Pricing is deliberately **not** in this chain. Supplier integration ends at
supplier facts; markup, PFU and VAT are a separate layer that has not been built
(`03_PRICING_PFU_VAT.md`).

### Modules

| Path | Purpose |
| --- | --- |
| `src/lib/suppliers/types.ts` | `SupplierOffer`, `SupplierAdapter`, capability vocabulary |
| `src/lib/suppliers/ean.ts` | GS1 check digit, leading-zero recovery, identity keys |
| `src/lib/suppliers/capabilities.ts` | Capability resolution; ordering hard-blocked |
| `src/lib/suppliers/freshness.ts` | Deterministic FRESH / AGEING / STALE / UNKNOWN |
| `src/lib/suppliers/adapters/isb/` | Inter-Sprint catalogue parser + adapter |
| `src/lib/suppliers/adapters/deldo/` | Deldo lane registration only — no parser |
| `src/lib/suppliers/ingest/pipeline.ts` | Idempotent, observable ingestion |
| `src/lib/suppliers/search.ts` | Pure shaping + ranking of sourcing options |
| `src/lib/suppliers/queries.ts` | Server-only reads. **Not wired to any route** |

---

## 3. Supplier ordering is structurally impossible

Three independent layers, so no single mistake can enable it:

1. **No method exists.** `SupplierAdapter` has no `placeOrder`, `submitOrder`,
   `purchase` or equivalent. Not disabled, not commented out — absent. A method
   that does not exist cannot be called by mistake. A test asserts this across
   every registered adapter.
2. **Code refuses the capability.** `resolveCapabilities` drops
   `production_ordering` and `test_ordering` even when a row says `enabled`, and
   `hasCapability` returns false for them unconditionally.
3. **The database forbids the row.** `supplier_capabilities_no_ordering_chk`
   rejects any insert or update setting `enabled = true` for either capability.
   Enabling ordering would require deliberately dropping a named constraint.

Inter-Sprint Protocol 104 and Deldo production ordering are covered by
`production_ordering`. Enabling either is an `OWNER_DECISION`.

---

## 4. Test data cannot reach a commercial result

Deldo supplied sample files the supplier described as fictional and non-current.
The guard is structural, not a UI warning.

- `supplier_listing_prices.is_test_data` marks the row.
- `catalogue_import_runs.is_test_data` marks a whole ingestion run, so sample
  files cannot leak in row by row.
- **`supplier_commercial_observations`** filters `is_test_data = false`. It is
  the only sanctioned source of supplier offers. A caller cannot forget the
  predicate because the predicate is not theirs to write.
- `toSourcingOption` **throws** if a test-data row reaches it — a breach fails
  loudly rather than silently pricing fictional stock.

Verified on staging with the hardest case: a fictional Deldo row at €0.01 with
99,999 units, timestamped *newer* than the real one. The view still returns the
real €79.90, because the exclusion happens before "latest wins", not after. That
row is left on staging on purpose, as a live regression fixture.

---

## 5. Freshness

Deterministic, computed from stored timestamps and per-lane TTL configuration.
No AI, no heuristics at call time.

| State | Condition |
| --- | --- |
| `FRESH` | age ≤ `ttlHours` |
| `AGEING` | `ttlHours` < age ≤ `ttlHours × staleMultiplier` |
| `STALE` | age > `ttlHours × staleMultiplier` |
| `UNKNOWN` | no timestamp, no configured TTL, unparseable, or a future timestamp |

`UNKNOWN` is never treated as fresh. A stale option is still *shown* — with its
age — because for a manual lane a three-day-old price is often the best
information available. The operator decides; the system does not silently
discard.

Current per-lane defaults (engineering defaults, tune as real cadence is
observed — not business policy):

| Lane | price TTL | stock TTL | delivery |
| --- | --- | --- | --- |
| `intersprint` | 24h | 24h | unknown |
| `deldo` | 24h | 12h | 5_7d |
| `it_48h` | 24h | 8h | 48h |

---

## 6. Ingestion pipeline

`fetch → validate → normalize → stage → verify → commit`

Live normalized state is never mutated while parsing. A run is staged and
verified first, and only a verified run commits — so **a failed feed cannot
corrupt the last known good catalogue**; the previous data simply stays current.

**Idempotent by file checksum.** Re-ingesting a file that already committed for
the same lane and adapter is a no-op reporting `replayed: true`, so a retried or
scheduled feed cannot double-apply.

Verification refuses to commit when the file is empty, when nothing parsed, when
duplicate supplier listing keys would make the commit ambiguous, or when a
`complete` snapshot lost more than half its rows — because committing that as
complete could wrongly deactivate live listings. The same lossy file is accepted
as `partial`, which may never deactivate anything.

Every run records: source rows, accepted, rejected, missing/invalid/recovered
EAN, missing weight, review-required, duplicate keys, price observations, stock
observations, plus per-row rejection reasons and an error summary.

---

## 7. Schema added (staging only)

| Object | Notes |
| --- | --- |
| `suppliers.lane_code`, `integration_type`, `is_sourcing_lane`, `default_lead_time_days`, `delivery_class`, `price_ttl_hours`, `stock_ttl_hours`, `stale_multiplier` | Additive. `is_sourcing_lane` separates sourcing lanes from logistics-only counterparties without deleting or merging any existing row. |
| `supplier_capabilities` | Explicit rows. Absence = unavailable. Ordering blocked by CHECK. |
| `supplier_commercial_rules` | Inter-Sprint PCR 60 / truck 10 minimums, prepayment, balance gating — as data, not hard-coded checks. |
| `supplier_listing_prices` + 14 columns | The observation model. Reused deliberately: it already *is* the time-series observation table. |
| `catalogue_import_runs.is_test_data` | Whole-run test flag. |
| `supplier_commercial_observations` | The query boundary view. |

Every change is additive and nullable or defaulted, so `gorush_commit_catalogue_batch`
and the existing logistics flows keep working untouched. Production has not been
modified.

---

## 8. Not built, on purpose

- **Pricing / markup / PFU / VAT engine.** Supplier integration ends at supplier
  facts. Building it needs the two `OWNER_DECISION` items still open (PFU inside
  the VAT base; rounding scope).
- **Sales orders, sourcing allocation, supplier purchases.** Later phases.
- **Customer checkout or any public surface.** Internal first.
- **An operator route or page.** `queries.ts` returns supplier identity and
  supplier purchase cost. This repository has no authentication, so an exposed
  route would be publicly reachable and would leak supplier cost to anyone who
  found the URL. It follows the precedent of `src/lib/offers/admin-queries.ts`:
  the query layer exists and is tested; wiring it requires auth first.
