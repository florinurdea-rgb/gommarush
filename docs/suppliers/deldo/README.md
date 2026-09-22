# Deldo — supplier reference

Lane code `deldo`. Status: **registered, not ingesting.** See
[`../../SUPPLIER_INTEGRATION.md`](../../SUPPLIER_INTEGRATION.md) §1.

## Documents held

| Document | Provenance | In this repo? |
| --- | --- | --- |
| Deldo API documentation | `PRIMARY` — supplied by Deldo (Jan) | **NO — not yet provided to the engineering side** |
| Test Price & Stock file (CSV) | `PRIMARY` — supplied by Deldo (Jan) | **NO — not yet provided to the engineering side** |
| Order XML specification | `PRIMARY` | **NO** |

Both primary documents are reported as received by GommaRush, but neither has
reached this repository. **Until they are committed here, no Deldo parser can be
written.** That is the whole of the Deldo blocker.

## Account

| Field | Value | Provenance |
| --- | --- | --- |
| Customer number | `026933` | `SECOND-HAND` |
| Account name | Go Rush Trasporti srl | `SECOND-HAND` |
| Supplier contact | Jan | `SECOND-HAND` |

## Known integration surface

Everything below is `SECOND-HAND`: relayed through our own outbound
correspondence, not read from Deldo's documentation. It is recorded so the
knowledge is not lost, and so the eventual `PRIMARY` document can be diffed
against it. **It is not sufficient to build a parser from.**

### Price & Stock feed

- Delivered as CSV.
- Refreshed **hourly**. `UNCONFIRMED`: whether each file is a complete snapshot
  or a delta/update file. This determines whether an import may ever deactivate
  listings — a `partial` import must never deactivate anything.
- Transport currently expected over FTP. GommaRush has requested SFTP or FTPS.
  `UNCONFIRMED`: which Deldo supports.
- `UNCONFIRMED`: filename convention, target directory, credentials.

Observed CSV field names, relayed:

| Field | What we know | What is unconfirmed |
| --- | --- | --- |
| `Price` | A price figure | Whether it is already the final purchase price for account 026933, or whether `Discount` must still be applied. **Decimal separator unknown.** |
| `Discount` | A discount figure | Its meaning entirely: percentage or amount, already applied or not. |
| `Dot` | DOT year | Resolved on our side: we preserve the supplied DOT year. |
| `Demo` | Carries the literal value `DEMO` on some rows | What DEMO denotes: condition, warranty, or disclosure obligations when selling. |

Not mentioned in correspondence and therefore entirely unknown: whether an
**EAN** column exists at all, what the **stock** column is called or means,
lead time, currency, PFU, character encoding, delimiter, quoting, header row.

### API

- Endpoint `GET_STOCK`.
- Documented lookup parameters `productId` or `ean`; the documentation's own
  examples reportedly use `article`. `UNCONFIRMED`: which is authoritative for
  lookup by Deldo article number.
- `UNCONFIRMED`: base URL, authentication scheme, rate limits. A **test API
  token has been requested and not yet issued.**

### Ordering

Order XML documentation exists. **Not implemented and deliberately out of
scope.** `production_ordering` and `test_ordering` are registered disabled, and
the database constraint `supplier_capabilities_no_ordering_chk` prevents either
being enabled. Sending a real order is an `OWNER_DECISION`.

## Test data

Deldo has described previously supplied sample material as structural/test data
that may contain fictional price, quantity and availability values.

**Anything derived from a Deldo sample file must be ingested with
`is_test_data = true`,** which excludes it from `supplier_commercial_observations`
and therefore from every commercial and operator-facing result. `UNCONFIRMED`,
and explicitly asked: whether the current test Price & Stock file contains
non-current values, and how live files will be distinguishable from test files
once the feed is activated.

## Open questions with Deldo

Sent to Jan, awaiting reply:

1. `Discount` semantics — is `Price` already final for 026933?
2. Pricing setup for 026933: transport separate or included; currency.
3. Test API token for `GET_STOCK`.
4. `GET_STOCK` parameter for lookup by Deldo article number.
5. SFTP or FTPS instead of plain FTP.
6. Hourly feed: snapshot vs delta, filename, target directory.
7. What `DEMO` means for condition, warranty and disclosure.

Recommended additions before sending, none yet answered:

8. **CSV dialect** — delimiter, quoting, **decimal separator**, thousands
   separator, encoding, header row. A Dutch-formatted `79,90` parsed as
   `79.90` becomes `7990`: a 100x price error that passes every validation.
   This is the highest-risk unknown in the entire Deldo integration.
9. **EAN coverage** — supplied on every row? Always full GTIN-13? Is the Deldo
   article number stable over time, or can it be reassigned? Our cross-supplier
   product key is `GTIN:<ean>`; without EAN, Deldo products cannot be matched
   against Inter-Sprint products, which is the milestone.
10. **Stock semantics** — exact count, banded indicator, or boolean flag? One
    total or per warehouse? Does it include incoming stock? Expected lead time
    in working days. This maps directly to `stock_confidence`, which is what
    stops us rendering a precise quantity we cannot stand behind.
11. **Test vs live** — confirmed in writing, per "Test data" above.
12. **PFU** — supplied in the feed, or handled entirely on our side?
13. **`GET_STOCK` rate limits** or fair-use guidance.
