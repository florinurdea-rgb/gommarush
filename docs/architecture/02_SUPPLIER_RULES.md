# Supplier Rules

Per-lane rules. Commercial facts here come from supplier correspondence recorded
by the owner; technical facts are verified against the repository and databases.
Where the two disagree, the conflict is stated rather than resolved.

---

## Inter-Sprint — PRIMARY

Not to be confused with **Deldo**, **EuroSprint**, **Eurospaint** or
**Inter-Tyre**. Inter-Sprint and Inter-Tyre are separate partners with separate,
non-interchangeable logins.

### Catalogue feed — IMPLEMENTED (manual upload)

The `isb` adapter parses the supplier's XLSX contract: Dutch `J`/`N` booleans,
`0`/`1` flags, `;`-separated review reasons, group-derived class and season.
Proven in production: 9,559 rows committed 2026-09-08 from
`GommaRush_ISB_Tyre_Catalogue_Import-3.xlsx`, 0 conflicts, 0 rejected rows.

Ingestion is an **admin file upload** (analyze → commit), not an automated feed.

### Price and stock — BLOCKED

**The catalogue file carries no price column and no stock column.** The adapter
supports them optionally (`purchase_price` / `nett-price`, `stock_raw` /
`available`) but they are not in its required set, and the delivered file had
neither. Production holds 9,559 price rows, every one of them `NULL`.

A priced/stocked feed, or live Gateway lookup, is required before this lane can
support any commercial decision.

### FTP transport — PARTIAL

An FTP drop point is provisioned (`infra/ftp/`, Hetzner, plain FTP, user
`intersprint`, drop `/incoming`). **It is not connected to ingestion** — no code
reads from it. Needed: supplier's delivery confirmation, directory path, file
cadence, and their egress IPs so the port can be firewalled to them.

### Gateway (HTTP protocols) — PARTIAL, NEVER LIVE-VERIFIED

Implemented as transport only: per-partner configuration, protocol registry,
URL builder, response parser, typed errors, audit records, retry on reads and
**never** on orders. Protocol 104 is refused before any network call unless
live ordering is explicitly enabled.

**No application code calls it.** There is no caller, no catalogue refresh path
and no order payload builder. **Nothing has ever reached the supplier** — the
gated probe (`tests/intersprint-live-probe.test.ts`) has never been run with
credentials, which do not exist in any environment file.

> ### ⚠ Unresolved conflict — the Gateway Manual
>
> `src/lib/suppliers/gateway/protocols.ts` cites *Gateway Manual v2.2
> (Moerdijk, August 2018)* with paragraph references (§1.1, §2.1, §4.1, §5.x)
> for every protocol code and for the `test=1` dry-run parameter.
>
> **That document is not in this repository**, and the supplier-capability notes
> seeded on `claude/sleepy-gauss-lezg26` assert the opposite: *"Protocol 103 is
> referenced in supplier correspondence but no verified protocol documentation
> is available."*
>
> Both cannot be true. Either the manual was available to the session that wrote
> the registry and was never committed, or the protocol details were inferred.
> **Until this is settled, the protocol registry must be treated as unverified**
> and no Gateway behaviour may be inferred from it. Resolving it costs one
> question to the owner or one email to the supplier.
>
> Recorded in `.ai/handoff.json` → `risks`.

### Commercial terms — from correspondence, not yet modelled

- Advance-payment / deposit model; order release depends on sufficient paid
  balance.
- Minimum release quantities: **passenger/PCR 60 tyres**, **truck 10 tyres**.

These belong in supplier commercial rules as data, not as scattered checks.

### Rules

- Catalogue ingestion and live Gateway lookup are **separate capabilities**.
  Neither implies the other.
- **Do not enable Protocol 104 production ordering.** OWNER_DECISION.
- The ISB article id (`supplier_article_id`) must never be sent where an
  Inter-Sprint system number is expected (`artc=S=`). The identifier spaces are
  unrelated; EAN is the only field that bridges them.

---

## Deldo NV — SECONDARY

**Authority for this lane:** the official integration documentation supplied by
Jan Van Dyck (Deldo NV) as `API documentation.pdf`, together with the sample
feed `26933TEST.csv`, under the subject *"RE: Connect platform and orders for -
026933 (Go Rush Trasporti srl)"*. GoRush customer number **026933**.

Nothing in this section is taken from another supplier's protocol or from a web
source. Not to be confused with Inter-Sprint, EuroSprint or Inter-Tyre.

### The documented flow — three distinct steps

The documentation defines an order process that must **not** be collapsed into
one operation:

| Step | Purpose | Status |
| --- | --- | --- |
| **Hourly CSV feed** | Catalogue, discovery, working supplier state | IMPLEMENTED (parser) |
| **GET_STOCK** | Final availability **and price** verification before ordering | IMPLEMENTED |
| **CREATE_ORDER** | Consequential external action — creates an order in Deldo's ERP | NOT IMPLEMENTED, by design |
| GET_ORDER_STATUS | Order state — **parcel service only** | PLANNED |
| GET_TRACKING | Tracking number — **parcel service only** | PLANNED |

Deldo's own words: *"before sending a final order we advise to call our API
method get_stock to be sure that the goods are there"*, to avoid cancellations
from insufficient stock.

### Price & stock feed — IMPLEMENTED (parser only)

- CSV, pushed by Deldo to **the client's** FTP server, **hourly**. Email
  delivery is possible; FTP is the supplier's preference.
- The documentation deliberately does **not** describe the columns: *"Step 1:
  we send you 1 file in CSV format so that you can examine file header and
  structure."* **The file is the column contract.**

**Verified structure**, read from the supplier's own 26933TEST.csv:

| Property | Value |
| --- | --- |
| Delimiter | `;` |
| Quoting | none present (RFC 4180 quoting supported defensively) |
| Encoding / line endings | pure ASCII, no BOM, LF |
| Shape | perfectly rectangular, **35 columns**, 6,729 data rows |
| Empty convention | empty string between delimiters |
| Unique key | `Article` (0 duplicates) |
| `EAN` | **NOT unique** — 35 duplicate values |

**Parser results against the full real file:** 6,729 rows, 0 malformed,
0 rejected, 6,199 clean, 530 flagged for review, 113 old-DOT listings,
6,671 valid EANs, 1 recovered leading zero, 57 absent.

#### Conventions that would have been mis-mapped by a guessed schema

- **Duplicate EAN = old-DOT variant, not a duplicate.** EAN `3286340672719` is
  article `BR6727` (current, €82.50) and `BR672722` (`Dot=2022`, €61.00) — the
  same tyre at two prices. They are two **listings** of one product, which the
  shared model already expects via `old_dot`. Treating EAN as unique would have
  produced the wrong price for one of them.
- **`Rim` holds two conventions.** 2 digits are inches (`16` = 16"); 3 digits
  are tenths (`225` = 22.5"). Every 3-digit row is a truck tyre.
- **`Height = 0` is not a zero profile** — it marks sizes with no aspect ratio,
  such as `195 R14`. 69 rows.
- **`Width` is not always numeric** — `31X` is imperial sizing (31x10.50R15).
- **`Loadindex` is not always clean** — 454 rows are parenthesised (`(100Y)`)
  and some are damaged (`143/141j-`). Only unambiguous forms are split.
- **`PR/RF` mixes kinds** — `XL`, but also ply ratings (`16PR`) and load/speed
  pairs (`103 H`). Only an exact `XL` is read as extra load.
- **No weight column.** Weight drives PFU, so it is recorded as absent rather
  than defaulted.
- **No currency column**, in the feed or in the API.

> **`Discount` is carried verbatim and never applied.** Its meaning is
> undocumented and the sample makes the obvious reading untenable: values range
> from **-407.69 to +78.33**, and a plain percentage discount cannot be
> negative. `purchasePrice` is the `Price` column exactly as supplied. See
> handoff decision **D7**.

#### Two commercial feed modes — UNCONFIRMED

The documentation describes two pricing options:

1. pure tyre prices, transport invoiced separately, with a specific cost per
   parcel per country;
2. transport included in the tyre price, valid only for a specified destination
   country, adjusting when another country is selected.

**Which one GoRush receives is not stated anywhere.** The same number means
different things under each, so every Deldo observation carries
`commercialMode: "unknown"` and is therefore **not commercially usable** until
confirmed. See handoff decision **D8**.

### GET_STOCK — IMPLEMENTED

`GET` · test endpoint `https://api-test.deldo.be/gaston/dotcube_cgi`
· `?token=…&request=GET_STOCK&article=…`

Documented responses, all values as JSON **strings**:

```
success   {"success":"1","product-id":"BS7623","amount":"50","price":"85.50"}
unknown   {"success":"0","error-message":"Unknown article"}
```

It returns **`amount` AND `price`** — a final price verification as much as a
stock check. This is what will let the order flow detect *stock changed*,
*price changed* or *product unavailable* between the feed and commitment.

Implemented safety: HTTPS enforced, server-side only, token never logged or
returned, unrecognised environment resolves to `test`, incomplete configuration
fails closed before any network call, malformed responses fail closed, unknown
article is a typed commercial outcome rather than an exception, and no retry —
a silently repeated pre-order check would be older than it appears.

> ⚠ **Documentation conflict, unresolved.** The PDF's "URL Parameters" section
> lists `productId=[integer|string] OR ean=[string]`, but **both** worked
> examples use `article=`. `article=` is implemented because it is the only
> form demonstrated. Confirm with Deldo before the first live call —
> handoff risk **R10**.

### CREATE_ORDER — DELIBERATELY NOT IMPLEMENTED

`POST` XML (EAN.UCC `multiShipmentOrder`) — creates an order directly in
Deldo's ERP. **No request has been generated or transmitted.**

The supplier's required rollout, which governs when this may change:

1. develop the XML;
2. send two example request/response pairs to Jan@deldo.com for validation;
3. after approval, test against the test environment;
4. receive the green light: live URL, live token, live customer number;
5. only then use live ordering;
6. notify Deldo after the first live order for a final check.

**`Customer Order Number 1` must be unique for every order** — Deldo checks for
duplicates. GommaRush must not rely on that alone: idempotency belongs on our
side too, so a retry cannot create a second supplier purchase.

### After-sales — PLANNED

After shipment, via FTP, **once per day in the evening**: PDF invoice, CSV
invoice, CSV tracking file. Order cut-off is 15:00 on Belgian working days.
Belongs to a later fulfilment/accounting mission.

### Rules

- **Never invent a column layout or a protocol detail.** Where the sample and
  the PDF are silent, the answer is unknown and the capability is unavailable.
- Deldo normalizes into the **same** shared model as every other lane. No
  parallel Deldo product architecture.
- Test data must never become customer-facing availability, a real purchase
  price, a sourcing input or a production order input.
- Ordering stays disabled. Enabling it is an OWNER_DECISION.

---

## Italian ~48h supplier — MANUAL

No integration exists and none is planned for V1.

**Flow:** customer request → operator searches the supplier manually → operator
records the price/stock observation → pricing produces the customer price →
customer receives the offer → on acceptance the operator re-checks the supplier
→ operator purchases manually → normal inbound/logistics flow.

**Recorded per observation, where available:** EAN, supplier article code,
matched catalogue product, purchase price, currency, stock/availability,
expected delivery, `checked_at`, and the operator/source note.

A manual observation uses the **same normalized model** as an automated one. The
fact that a human typed it is a source-type attribute, not a different schema.
