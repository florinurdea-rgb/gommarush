# Inter-Sprint — price & stock feed

Provenance markers follow `docs/suppliers/README.md`: **PRIMARY** (read
directly from a supplier artefact), **SECOND-HAND** (reported, not verified
here), **UNCONFIRMED** (no citable source).

---

## 1. Source artefacts

**PRIMARY.** Two sample workbooks sent by Antonello Moio (Inter-Sprint) on
**5 August 2026**, described in his covering email as samples of the files
their integration places on the GommaRush FTP folder:

| File | Sheet | Columns | Data rows |
| --- | --- | --- | --- |
| `vrd-pcr.csv.xlsx` | `vrd-pcr` | 34 | 9,559 |
| `vrd-truck.csv.xlsx` | `vrd-truck` | 33 | 134 |

On **18 September 2026** he added: *"The integration has been completed; you
can probably already check it now."* **SECOND-HAND** — we have not observed a
file arriving.

The `vrd-` prefix is **UNCONFIRMED**. It is presumably an account or route
code; nothing states it will be `vrd` for GommaRush's own deliveries, so the
importer matches the sheet by its `-pcr` / `-truck` suffix.

### These files built the current catalogue

**PRIMARY, proven.** The sorted `sysnr` set of `vrd-pcr` and the sorted
`supplier_article_id` set of production's 9,559 listings have the **same MD5**
(`4901cdbd6bb6b4a3be9ef1db0ba9314b`), the same sum, the same min and max, and
production's `source_row` range 2–9,560 matches the file's data rows exactly.
`supplier_item_code` reproduces `itemcode` byte for byte, spacing included.

This is why the catalogue has specifications but no prices: the file that was
imported, `GommaRush_ISB_Tyre_Catalogue_Import-3.xlsx`, was a **pre-normalised
derivative** of this feed with `nett-price` and `available` dropped. The
commercial data was in the supplier's file all along.

---

## 2. Column contract

**PRIMARY**, read off the sample header. Headers are trimmed on read, so
`'description '` and `'Type '` arrive without their trailing spaces.

| Column | Meaning | Mapped to |
| --- | --- | --- |
| `sysnr` | **Supplier listing identity.** 9,559 unique, no blanks | `supplier_article_id`, and `ISB:<sysnr>` as `supplier_listing_key` |
| `itemcode` | Supplier item code, 9,559 unique | `supplier_item_code`, verbatim |
| `description` | Free text | `description` |
| `Type` | Pattern code (`WINTRACXL`) | `model_pattern` |
| `brand` | Two-letter code (`VR`) | `brand_code` |
| `brand description` | Brand name (`VREDESTEIN`) | `brand` |
| `group`, `group description` | Dutch merchandising group | **not mapped** — see §4 |
| `E-mark`, `European` | `J`/`N` | `e_mark`, `european` |
| `width tyre`, `aspect ratio`, `diameter` | Dimensions | `width_mm`, `aspect_ratio`, `rim_inch` |
| `LI/SI` | Load index + speed rating (`94V`) | `load_index`, `speed_rating` |
| **`nett-price`** | **Supplier price.** Present on all 9,559 rows, 41.13–655.70, no zeros | `purchase_price` observation |
| `gross` | Inter-Sprint list/consumer price. **0 on 2,227 rows** | **not mapped** — it is not our cost |
| **`available`** | **Stock.** See §3 | `stock_raw` / `stock_exact` / `stock_minimum` |
| `eancode` | Barcode. 12 blank, 9 shared across rows | revalidated, then `ean` |
| `ip-code` | Manufacturer reference. 15 blank, 24 duplicated | `manufacturer_product_code` |
| `weight` | Kilograms. Blank or `0` on some rows | `weight_kg` + `supplier_reported` |
| `Fuel effeciency`, `Wet grip`, `Rollnoise`, `Noiselevel`, `Snowgrip`, `Icegrip` | EU label. Present on 8,981 rows | **not mapped** — no columns exist |
| `EPREL-id`, `EPREL-url` | EU label registration | `eprel_id` |
| `wcat` | Supplier weight bucket `1`–`4`. **PCR only** | `weight_category` (text, **not** kilograms) |

### Listing identity is `sysnr`, not EAN

`eancode` is nearly unique but **9 EANs appear on more than one row and 12
rows have none**. An EAN identifies the *tyre*; `sysnr` identifies
Inter-Sprint's *offer* of it — and a price, a stock figure and a purchase
order all belong to the offer. `ip-code` is not an identity either (24
duplicates, 15 blanks).

---

## 3. `available` — exact vs banded

**PRIMARY.** Two forms, and the distinction is commercial:

| Form | Rows (PCR) | Meaning |
| --- | --- | --- |
| `>  20` | 7,991 | At least 21. Quantity **not disclosed** |
| `4` … `20` | 1,568 | Exact count |

There are **no zero rows and no exact value above 20** — the band absorbs
everything above it.

`>  20` sets `stock_minimum = 20` and leaves `stock_exact` **null**. Resolving
it to 21, 50 or 100 would invent availability on 84% of the catalogue.

This required a change to the observation layer: `classifyObservation`
previously treated a missing exact count as unknown stock, which would have
made the banded majority unusable while leaving only the *low*-stock rows
usable. A known minimum now counts as known stock.

---

## 4. What the feed does NOT state

Never fill these from the column names.

- **Season.** No column. `group description` carries merchandising groups
  (`LUXE BANDEN`, `BESTELWAGEN BANDEN`, `4 X 4`, `TRUCKBANDEN`,
  `LUXE BANDEN M&S`) which describe the segment. `Snowgrip` is a 3PMSF
  marking shared by winter and many all-season tyres. Left null.
- **Vehicle class.** No column. Left null.
- **XL / run-flat.** Not flags. They appear inside `description` prose
  (`... WINTRAC XL`). Not parsed.
- **Currency.** No column anywhere. Inter-Sprint is Dutch and euros are the
  obvious guess; the observation carries `currency: null` regardless.
- **PFU.** **PRIMARY** — the 5 August email states PFU is *not* included in
  the feed and its handling is ours under local rules. No PFU value is
  derived, and the tyre weight in the feed must not become one.
- **Whether `nett-price` is Go Rush's actual cost.** Not stated. It may be a
  list net before account discount, and transport inclusion is unstated. The
  number is carried; the claim is not. See §6.
- **Snapshot or delta.** Not stated. A listing missing from a file therefore
  means nothing about its stock, and only an operator declaring a file a
  complete snapshot may propose deactivations.
- **Refresh cadence.** Not stated, so the lane declares **no** freshness
  threshold. `INTERSPRINT_FRESHNESS_POLICY` is `null` and callers must supply
  one as an explicit GommaRush business policy.

---

## 5. Spreadsheet padding

**PRIMARY.** Both samples are saved to Excel's full 1,048,576-row grid.
**1,039,016 PCR rows** past the data carry a stray **`20` in the `nett-price`
column** and nothing else.

Read naively that is a million €20 tyres with no identity. The adapter's
`isPaddingRow` drops any row with neither `sysnr` nor `itemcode` before
validation, so they are counted (`summary.paddingRows`) and never staged.

The real FTP delivery is likely a true `.csv` — the sample names are
`*.csv.xlsx`, i.e. a CSV opened in Excel — in which case the padding will not
exist. The commercial mapping lives in the adapter and is independent of the
container, so a CSV reader can be wired to the same adapter. **The CSV dialect
(delimiter, quoting, encoding) is UNCONFIRMED** and must be read off a real
file, not assumed.

---

## 6. Commercial status

| Question | State |
| --- | --- |
| Price present | **Yes**, all 9,559 rows |
| Price is Go Rush's cost | **UNCONFIRMED** — `feed_nett_price_unconfirmed` |
| Currency | **UNCONFIRMED**, carried as null |
| Stock present | **Yes**, exact or banded |
| PFU | **Absent by supplier statement** → `TO_CONFIRM` |
| Commercially usable today | **No** — `commercialMode: "unknown"` fails closed |

The sample prices are **August 2026 samples**, not current prices. They must
be imported with `classification: "test"` unless a genuinely live file is
being read.

---

## 7. FTP (updated M9)

The endpoint **is** provisioned by this repository:
`infra/ftp/provision-intersprint-ftp.sh` creates a chrooted, single-user
plain-FTP drop point with `incoming/` writable by Inter-Sprint and
`processing/`, `processed/`, `failed/` owned by root and read-only to them —
so the supplier cannot alter the record of what we did with their files.

**SECOND-HAND** (owner-verified from correspondence, not observed here):
plain FTP, port 21, passive, upload directory `/incoming`, a dedicated
Inter-Sprint account, credentials supplied privately, delivery three times a
day, and a 18 September statement that the integration is complete.

**Credentials live only in the environment.** `INTERSPRINT_FTP_*` in
`.env.local.example` documents the names; no value belongs in this repository.
Note that `INTERSPRINT_GATEWAY_*` is a different channel — the ordering/stock
API, not this feed.

### Not verified from here

This session had **no credentials and no network route to port 21** (HTTPS
egress works; FTP times out). So:

- **We do not know whether Inter-Sprint has uploaded anything.** Nothing in
  this repository has ever listed `/incoming`.
- **No real CSV has been seen**, so the delimiter, quoting and encoding remain
  **UNCONFIRMED**. The reader detects the dialect against the verified column
  contract and refuses what it cannot prove, rather than defaulting.
- **The FTP client has never run against the real server.** It is therefore
  read-only unless `INTERSPRINT_FTP_ALLOW_WRITES=true`.

### The chain, as it now stands

```
incoming/  →  list + download        FtpFeedTransport (unverified)
           →  checksum + dedupe      lifecycle.ts      (tested)
           →  claim                  lifecycle.ts      (tested)
           →  CSV dialect detection  csv-reader.ts     (tested)
           →  commercial mapping     intersprint-feed-adapter.ts (M8, tested)
           →  observations           observation.ts    (tested)
           →  pricing                src/lib/pricing/  (M7, tested)
           →  processed/ | failed/   lifecycle.ts      (tested)
```

Everything except the FTP socket itself is exercised by tests against an
in-memory transport.

---

## 8. Commercial policy (M9) — OWNER DECISIONS, not supplier statements

`src/lib/suppliers/intersprint/commercial-policy.ts`. Every item here is
**`POLICY_OWNER`**: a GommaRush business decision recorded on 2026-09-22.
Inter-Sprint has not written any of it down for us, and it must never be
cited as though they had.

| Decision | Value |
| --- | --- |
| `nett-price` is the net purchase cost | Yes |
| Transport included at minimum release | PCR **60**, truck **10** |
| Currency | still **UNCONFIRMED**, carried as null |

Transport inclusion is a property of the **release**, not the row, so the
commercial mode is resolved per order: at or above the minimum it is
`transport_included`, below it `transport_separate`, and with no quantity yet
decided it is `unknown` and fails closed. The internal preview prices on the
consolidated-release basis and says so on screen.

Currency is deliberately still open. The owner confirmed what `nett-price`
**is**, not what it is denominated in, and no Inter-Sprint document in this
repository states a currency.

---

## 9. Selling policy (M9) — minimum offer quantity

`src/lib/commerce/selling-policy.ts`. **A GommaRush selling rule, not an
Inter-Sprint stock semantic.**

- Fewer than **5** units → not offered to customers.
- The supplier's real figure is **never** altered. A listing showing 3 keeps
  showing 3 internally; it simply does not reach the customer projection.
- A band satisfies the floor **on its floor**: `>  20` clears 5 without any
  exact quantity being resolved.
- Unknown stock is not sellable, and is a different reason code from
  out-of-stock.

The floor is a lookup, not a constant, so it can later vary by supplier,
customer or channel without the importer, adapter or catalogue query changing.
Filtering happens in `searchCatalogue`, not in the UI, so a future export or
API cannot accidentally publish a suppressed listing.
