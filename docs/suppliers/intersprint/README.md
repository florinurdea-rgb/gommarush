# Inter-Sprint — supplier reference

Lane code `intersprint`. Status: **catalogue parser implemented**; transport and
live lookup blocked. See
[`../../SUPPLIER_INTEGRATION.md`](../../SUPPLIER_INTEGRATION.md).

## Documents held

| Document | Provenance | In this repo? |
| --- | --- | --- |
| Inter-Sprint integration / FTP documentation | `PRIMARY` | **NO** |
| Gateway protocol specification (incl. Protocol 103, 104) | `PRIMARY` | **NO** |
| `GommaRush_ISB_Tyre_Catalogue_Import-3.xlsx` | `PRIMARY` | **NO** — but its parsed contents survive in production (see below) |

## The catalogue contract is known, unusually

The ISB catalogue parser is **not** written from second-hand description. The
real file was ingested into production on 2026-09-08, and every source row was
preserved untouched in `catalogue_import_rows.raw_payload` — 9,559 of them.

Under the precedence rule, that is a proven production fact and therefore top
authority. The full verified contract, including every field, every enum domain,
the `GTIN:<ean>` vs `ISB:<article_id>` identity rule and the review-reason
vocabulary, is documented in
[`../../SUPPLIER_INTEGRATION.md`](../../SUPPLIER_INTEGRATION.md) §1 and
implemented in `src/lib/suppliers/adapters/isb/parse.ts`.

**The ISB catalogue file carries no price and no stock column.** Every offer the
parser emits reports both as unknown. That is a property of the feed.

## What is still blocked

- **FTP delivery.** No host, credentials, directory path or cadence. The parser
  is complete; only transport is missing.
- **Gateway / Protocol 103.** No protocol documentation. `02_SUPPLIER_RULES.md`
  *references* Protocol 103 for extended stock search, but a reference is not a
  specification. `lookupLive` is absent from the adapter rather than stubbed,
  and undocumented protocol behaviour must not be inferred.
- **Protocol 104 ordering.** Not implemented, deliberately. `OWNER_DECISION`.

## Commercial terms

Recorded as data in `supplier_commercial_rules`, not as hard-coded checks:

| Rule | Scope | Value | Provenance |
| --- | --- | --- | --- |
| `min_order_qty` | `pcr` | 60 tyres | `SECOND-HAND` (supplier correspondence) |
| `min_order_qty` | `truck` | 10 tyres | `SECOND-HAND` |
| `prepayment_required` | `all` | — | `SECOND-HAND` |
| `balance_gated` | `all` | — | `SECOND-HAND` |

PFU is **not** supplied in the ISB feed, so every Inter-Sprint offer carries
`pfu_status = TO_CONFIRM`.
