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

## Deldo — SECONDARY — BLOCKED

Nothing is implemented. No code, no parser, no credentials, no sample file and
no specification exist in this repository.

### What is known, from supplier correspondence only

- Stock/price files can be supplied and/or pushed to GommaRush via FTP.
- The supplier supplied XML/API documentation for order communication.
- Initial CSV samples were described by the supplier as **structural/test data**
  and may contain fictional or non-current price, quantity and availability.
- The supplier asked that first XML payloads be generated for validation before
  test-environment ordering.
- Production ordering comes only after successful testing and explicit approval.

### Missing inputs

| Class | Needed |
| --- | --- |
| **BLOCKING NOW** | Feed format and column contract; a real sample file; the XML order schema |
| **CAN BUILD BEFORE ACCESS** | Lane registration, capability rows, normalization into the shared offer shape, test-data flagging, freshness control |
| **LIVE VALIDATION ONLY** | FTP host/credentials/path, test-environment endpoint, supplier sign-off on generated XML |

### Rules

- **Never invent a column layout.** A fabricated parser silently mis-maps real
  commercial data — the failure is invisible until it reaches a customer or an
  invoice.
- Deldo normalizes into the **same** offer shape as Inter-Sprint. No separate
  Deldo product architecture.
- Every offer derived from files the supplier described as fictional must carry
  a test-data flag and must **never** be shown to a customer as real
  availability or price.
- Order XML generation stays a local fixture exercise. Sending a real order or
  enabling production ordering is an OWNER_DECISION.

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
