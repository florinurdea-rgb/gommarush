# Deldo — supplier reference

Lane code `deldo`. Supplier priority **#1**.

Implementation: feed parser, GET_STOCK client, capability registry and
observation model all exist and are tested. Persistence remains gated. See
[`../../DELDO_ACTIVATION.md`](../../DELDO_ACTIVATION.md).

---

## Primary artefacts

| Artefact | Detail | Committed here? |
| --- | --- | --- |
| `API documentation.pdf` | 18 pages, supplied by Jan Van Dyck / Deldo | No — held outside the repository |
| `26933TEST.csv` | Price & Stock test file, 1,322,596 bytes, sha256 `5e384ccf45d06ec3…` | No — held outside the repository |

**Both have been read directly.** Every `PRIMARY` fact below was verified
against them, most recently on 2026-09-22 by independent re-analysis of the two
files. The implementation was built from the same artefacts.

They are not committed because the CSV carries account-specific commercial
pricing for customer 026933. If they are ever committed, they belong somewhere
access-controlled, not beside application code.

---

## PRIMARY — verified in `26933TEST.csv`

### File format

| Property | Verified value |
| --- | --- |
| Delimiter | `;` |
| Quoting / text qualifier | **None.** Zero `"` and zero `'` characters in the entire 1.3 MB file |
| **Decimal separator** | **`.` (point).** All 6,729 `Price` values use a point; **zero** use a comma |
| Decimal places | Always exactly 2 on `Price` |
| Thousands separator | None. Max price 1221.00, written without a separator |
| Encoding | Pure ASCII — **0** bytes above 0x7F. No BOM |
| Line endings | LF only, no CR anywhere |
| Header row | Present, 35 columns |
| Rows | 6,729 data rows, **0** malformed (every row has exactly 35 fields) |

The decimal separator matters more than it looks. A Dutch-formatted `79,90`
parsed as `79.90` becomes `7990`, a 100× error that passes every validation.
In this file the separator is a point. **That is verified for the test file;
whether the live feed is generated identically is `UNCONFIRMED`.**

### The 35 columns

`Article` `Brand` `Width` `Height` `Speed` `Rim` `Loadindex` `Pattern` `Spec`
`PR/RF` `Demo` `Dot` `Extra` `Quality` `Vehicle` `Stock` `Price` `Discount`
`EAN` `IPCODE` `Fuel` `Wet` `Noise` `Decibel` `C Class` `URL_Pattern`
`Per parcel` `RFT` `Eprel_code` `Eprel_RR` `Eprel_Wet` `Eprel_Noise`
`Eprel_decibel` `Eprel_severe_snow` `Eprel_Ice_Tyre`

Naming traps, both verified:

- **`Quality` is the season**, not a condition grade. Its only values are
  `Summer` (4,098), `Winter` (1,471), `All Season` (1,154) and empty (6).
- **`Vehicle` is the vehicle class**: `Passenger car` (4,871), `Jeep / 4x4`
  (1,162), `Light Truck` (626), `Truck` (70).
- **`Extra` is empty on all 6,729 rows** in this file. Its purpose is unknown.

### Identity — `Article` is the key, `EAN` is not

| Fact | Value |
| --- | --- |
| `Article` distinct | **6,729 of 6,729 — unique** |
| `EAN` 13-digit and GS1-valid | 6,671 |
| `EAN` empty | 57 |
| `EAN` present but invalid | 1 (an 11-digit value) |
| **EANs shared by more than one article** | **34, covering 69 rows** |

Of those 34 shared EANs, **all 34** differ in `Price`, **all 34** differ in
`Dot`, and **all 34** differ in `Stock`. The pattern is consistent: a base
article and a DOT-year variant with a `22` suffix, cheaper, separately stocked.

```
EAN 3286340672719
  Article=BR6727      Price= 82.50  Stock=63  Dot=-      BRIDGESTONE
  Article=BR672722    Price= 61.00  Stock=20  Dot=2022   BRIDGESTONE

EAN 3528702412794
  Article=MI241279    Price=178.50  Stock=41  Dot=-      MICHELIN
  Article=MI24127922  Price=167.00  Stock= 3  Dot=2022   MICHELIN
```

This is the evidence for the identity rule:

> **PRODUCT IDENTITY ≠ SUPPLIER LISTING IDENTITY.**
> EAN is for cross-supplier product matching. It must never replace exact
> supplier listing identity in sourcing, persistence or order execution.

Collapsing these onto EAN would let GommaRush order the wrong stock at the
wrong price. `supplierListingKey` (`DELDO:<Article>`) and `supplierArticleId`
carry the exact identity through the chain.

### Commercial columns

**`Price`** — 6,729 values, range 20.00 to 1221.00. Whether it is already the
final purchase price is `UNCONFIRMED`.

**`Discount`** — 3,639 non-zero values, 1,812 distinct, range **−407.69 to
+78.33**. Two are negative, both on the dearest rows (1221.00, and a
placeholder-looking 999.99). Positive values span 29.72–78.33 and never exceed
100. A plain percentage discount cannot be negative, so the obvious reading does
not hold. **The parser carries this column verbatim and never applies it to
arithmetic.** That is the correct fail-closed behaviour and must not be
relaxed until Deldo confirms the meaning in writing.

**`Stock`** — always an integer, never empty, **minimum 3, maximum 100**, 98
distinct values, **zero** rows at zero stock. 464 rows (6.9%) sit at exactly
100 and nothing exceeds it. A hard floor at 3 and a hard ceiling at 100 both
look like deliberate banding rather than true counts, so treating this as an
exact quantity would overstate what the supplier actually said. Semantics are
`UNCONFIRMED`.

**`Dot`** — populated on 113 rows only: 2019 (1), 2020 (3), 2021 (23), 2022
(85), 2023 (1). Empty on the other 6,616. The exact year is preserved as
supplied. **This is not an open question.**

**`Demo`** — 47 rows carry the literal `DEMO`; the rest are empty. Only 1 of
those 47 also carries a DOT year, so Demo and older-DOT are largely independent
conditions. What `DEMO` means commercially is `UNCONFIRMED`.

**Other observed distributions**: `RFT` 0/1 (336 run-flat), `Per parcel` 0/1/2,
`PR/RF` 24 distinct values including load/speed pairs and `10PR`-style strings.

---

## PRIMARY — verified in `API documentation.pdf`

| Fact | Value |
| --- | --- |
| Test endpoint | `https://api-test.deldo.be/gaston/dotcube_cgi` |
| Live endpoint | Issued only after the test procedure completes — **not yet known** |
| Transport | HTTPS required |
| Authentication | Organization access token, passed as a **URL parameter** |
| `create_order` auth | Token **plus** customer number |
| Feed transport | FTP, `.CSV`, **transferred every hour** |
| Documented methods | `get_stock`, `create_order` |
| Contact | `Jan@deldo.com` |

**The parameter-name ambiguity, resolved as far as the document allows.** The
"URL Parameters" section lists `productId=[integer|string] OR ean=[string]`,
but **both** worked examples — the success case and the unknown-article case —
use `article=`:

```
…?token=token&request=GET_STOCK&article=BS7623
…?token=token&request=GET_STOCK&article=BS762311111   → {"success":"0","error-message":"Unknown article"}
```

and the prose states the request parameter "can be 'Deldo product id' or
'EAN'". The most defensible reading is that `article` is the parameter *name*
and it accepts either value type. The client uses `article=` because it is the
only form the documentation actually demonstrates. Written confirmation is
still requested.

**Two pricing modes are documented**, which is why `commercialMode` exists and
why `unknown` blocks commercial use:

1. Pure tyre prices, transport invoiced separately, at a specific cost per
   parcel per country.
2. Transport included in the price, valid for one destination country, adjusted
   by Deldo when another country is selected.

Which mode applies to account 026933 is `UNCONFIRMED`. Marking up a price
without knowing which mode produced it silently mixes a transport cost into
margin.

**The documentation deliberately does not describe the CSV columns.** It says
Deldo sends a file "so that you can examine file header and structure". The
column contract therefore *is* the file — which is why the parser was written
from `26933TEST.csv` and why that is legitimate `PRIMARY` grounding.

---

## SECOND-HAND

Relayed through correspondence, not verified in a primary artefact:

- Customer number `026933`, account Go Rush Trasporti srl.
- Supplier contact named as Jan Van Dyck.
- The test file contains fictional / non-current commercial values. Deldo has
  described sample material this way, but nothing *inside* `26933TEST.csv`
  marks itself as test data. This is precisely why classification is applied at
  ingestion and never inferred from file content.

---

## UNCONFIRMED — awaiting Jan

1. What `Discount` means.
2. Whether `Price` already incorporates `Discount`.
3. Pricing mode, transport treatment and currency for 026933.
4. CSV format for the **live** feed: delimiter, quoting, decimal separator,
   thousands separator, encoding, header presence. *(All verified for the test
   file above; confirmation sought that the live generator matches.)*
5. EAN coverage guarantees, and whether Deldo article numbers are stable over
   time or may be reassigned.
6. `Stock` semantics — is the floor of 3 and ceiling of 100 deliberate banding?
   Is it one total or per warehouse? Does it include incoming stock? Expected
   delivery lead time.
7. Test API token.
8. Recommended `GET_STOCK` parameter name.
9. SFTP / FTPS support instead of plain FTP.
10. Feed snapshot vs delta, filename, target directory.
11. How live files will be distinguishable from test files.
12. What `Demo` means for condition, warranty and disclosure.
13. Whether PFU is supplied in the feed or handled by GommaRush.
14. `GET_STOCK` rate limits or fair-use guidance.

**DOT encoding is not on this list.** The CSV supplies the year and it is
preserved exactly.

---

## What is implemented

| Component | Path |
| --- | --- |
| Feed column contract + row mapping | `src/lib/suppliers/deldo/feed/parse.ts` |
| CSV reader (exact header match) | `src/lib/suppliers/deldo/feed/csv-reader.ts` |
| Import orchestration | `src/lib/suppliers/deldo/feed/import.ts` |
| Capability registry | `src/lib/suppliers/deldo/capabilities.ts` |
| GET_STOCK client | `src/lib/suppliers/deldo/get-stock/client.ts` |
| Observation model + identity + freshness | `src/lib/suppliers/observation.ts` |
| Classification migration (**unapplied**) | `supabase/post-baseline/0001_deldo_classification.sql` |

Tests: `tests/deldo-feed-parse.test.ts`, `tests/deldo-import.test.ts`,
`tests/deldo-get-stock.test.ts`, `tests/deldo-observation.test.ts`.

### The import safety boundary

Deldo input → **explicit data classification** → parse → validate →
observation → persistence plan → persistence boundary.

`buildDeldoImport` validates `classification` and `commercialMode` at **run
time**, before it reads a single byte of the file. The TypeScript types are
erased at build time and protect nothing once data arrives over HTTP, from an
upload form, from a scheduler payload or from JSON on disk, so the guard is a
real check rather than a type annotation.

It fails closed:

- no default, and no fallback to `live`;
- exact, case-sensitive matching — `"LIVE"`, `"Live"`, `"production"` and
  `" live"` are all refused rather than coerced. Coercing them is exactly how
  fictional data would acquire a real label;
- nothing is inferred from filename, directory, FTP location, environment
  variable or supplier account. A test file can sit in a live directory and a
  live file can be replayed from a laptop;
- `"unknown"` is a **valid, explicit** commercial mode. Stating that we do not
  know is not the same as omitting the field, and only the first is accepted.

`planDeldoListingPersistence` re-asserts both at the persistence boundary —
the last point before a database write where refusing is still cheap — and
surfaces `dataClassification`, `commercialMode` and `observationSource`
directly on the plan. They map one-to-one onto the columns in
`DELDO_REQUIRED_SCHEMA`, so the eventual write reads them explicitly and
derives nothing at the moment it matters.

### Fail-closed behaviour that must not be relaxed

- `Discount` is carried verbatim and never applied.
- `commercialMode: "unknown"` blocks commercial use of a price.
- Demo stock is not commercially usable (`unverified_demo`). The rule is that
  **unverified** Demo stock must not reach a customer offer — do not broaden
  this into a general claim about what Demo means.
- Test-classified observations are rejected before completeness and before age,
  so a fresh well-formed fictional row cannot be classified `current`.
- Classification is validated at run time and again at the persistence plan;
  there is no path to a default.
- `freshnessPolicyForLane` **throws** for an unconfigured lane rather than
  applying a default, because a default would invent a commercial tolerance
  nobody approved. Deldo's documented hourly cadence is a supplier fact and is
  deliberately *not* used as a freshness policy.
