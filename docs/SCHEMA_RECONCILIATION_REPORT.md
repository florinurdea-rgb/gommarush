# Schema Reconciliation Report

**Date:** 2026-09-21 · **Method:** direct read-only introspection of production
and staging, plus applying every repository migration to a disposable local
PostgreSQL. **No production or staging object was modified.**

Reproduce the central finding yourself:

```bash
bash scripts/verify-migration-baseline.sh
```

---

## 1. Headline finding

> **The repository does not contain a complete schema history.**
>
> Applying `supabase/migrations/*.sql` in order to an empty database produces
> **10 of 32 tables**. Eleven of twenty migrations fail. Fourteen production
> tables — including `orders`, `order_items`, `customers`, `suppliers`,
> `inventory_units` and `warehouse_zones` — are **never created by any
> migration in git**.

This is a stronger statement than the one in
[`DATABASE_BASELINE.md`](DATABASE_BASELINE.md) §1, which described a ledger
whose *version numbers* disagreed. The ledger mismatch is real but secondary.
The actual problem is that most of the commercial core has no DDL in version
control at all: it was created directly against the database, and the
repository has only ever contained migrations that *alter* it.

**Consequence for the plan:** a canonical baseline cannot be assembled by
squashing the existing migrations, because they do not describe the schema. It
must be **captured from production**, which is the only place the intended
schema exists in full.

---

## 2. Evidence: migrations applied to an empty database

PostgreSQL 16.13 local (production runs 17.6 — see §6). Supabase's
pre-existing `extensions` schema, `pgcrypto`, `uuid-ossp` and the `anon` /
`authenticated` / `service_role` roles were created first, so that failures
are genuine defects rather than "this is not Supabase".

| Result | Count |
| --- | --- |
| Migrations applied cleanly | 9 |
| Migrations failed | **11** |
| Tables created from empty | **10** of 32 |

The first failure is the root cause of most of the rest:

```
FAIL 20260817000000_logistics_phase1_schema.sql
     ERROR: relation "public.orders" does not exist
```

That migration creates `drivers` and `vehicles`, then immediately alters and
indexes `public.orders` — a table nothing in the repository creates. Every
later migration that touches the order graph fails behind it.

`20260830000000_tyre_catalogue.sql` fails independently on
`relation "public.suppliers" does not exist`, so the catalogue layer has the
same defect and is not merely a downstream casualty.

---

## 3. Inventory: production as it actually is

| Object | Count |
| --- | --- |
| Tables | 32 |
| Columns | 541 |
| Primary keys | 32 |
| Foreign keys | 51 |
| Check constraints | 56 |
| Unique constraints | 12 |
| Indexes | 141 |
| Functions | 28 |
| Triggers | 23 |
| Sequences | 2 (`client_offer_request_sequence`, `quote_request_number_seq`) |
| Enums | 0 |
| Extensions | 5 (`pg_stat_statements`, `pgcrypto`, `plpgsql`, `supabase_vault`, `uuid-ossp`) |
| **RLS enabled** | **32 of 32 tables** |
| **RLS policies** | **0** |

RLS on every table with no policy anywhere is deliberate, not an oversight: the
anon key can reach nothing, and all access goes through server-side code using
the service-role key. It is worth restating because a future migration that
adds a policy would silently open a table that is currently closed.

---

## 4. Object-level classification

### 4.1 Exists in production, never created by any repository migration — 14

```
customers              customer_locations     suppliers       supplier_locations
supplier_customer_refs orders                 order_items     order_documents
order_status_history   inventory_units        inventory_scans inventory_incidents
warehouse_zones        print_jobs
```

These are the transport/logistics core and the party model. They carry live
business data (26 orders, 44 order items, 102 inventory units, 14 customers,
16 suppliers). **This is the reconciliation's real subject.**

### 4.2 Created by repository migrations, absent from production — 4

```
document_analyses  document_extracted_lines  document_party_mappings  document_import_idempotency
```

The document-analysis pipeline. `src/lib/server/document-analysis-jobs.ts`
queries the first two, and is reached by `/api/admin/ddt-import/status` and
`/api/cron/document-analysis`. **Those routes cannot work against production
today.** Carried as risk R2; confirming whether the feature is in use decides
whether these migrations are urgent or merely missing.

### 4.3 Applied outside the ledger — 5 tables

`quote_requests`, `quote_request_items`, `quote_request_events`,
`quote_request_webhook_events`, `quote_request_reference_counter` exist with
data (2 requests, 10 events) but no ledger entry names them. Their repository
migrations (`20260826000000`, `20260827000000`) do apply cleanly from empty, so
here the *code* is fine and only the *ledger* is wrong.

### 4.4 Obsolete but still present — 2

`print_jobs` (2 rows) and `client_offer_requests` (0 rows) both have retirement
migrations in the repository (`20260828000000`, `20260826000100`) that have not
been applied. Safe to retire **only** after confirming no deployed code reads
them.

### 4.5 Functions — fully explained, no unknowns

All 28 production functions are defined somewhere in the repository. Eight
repository functions are absent from production, and both groups are accounted
for:

- `gorush_assign_stand`, `gorush_first_free_stand`, `gorush_stand_is_occupied`,
  `gorush_stand_holding_statuses` — deliberately dropped by
  `20260825000000_remove_stand_allocation.sql`. Correctly absent.
- `gorush_enqueue_document_analysis`, `gorush_lease_document_analysis`,
  `gorush_store_document_analysis_result`, `gorush_fail_document_analysis` —
  part of the unapplied document pipeline (§4.2).

### 4.6 Unexplained objects

**None.** Every production object is either created by a repository migration,
or falls into §4.1 where the explanation is "created outside version control".
No object was found that nobody can account for, which is the one category that
would have blocked progress outright.

---

## 5. Staging

Staging (`ltdwabkitplicyiwucsp`) runs a **third** lineage: four reconstructed
baseline migrations plus three supplier-foundation migrations from
`claude/sleepy-gauss-lezg26`, none of which are in `main`. It carries
`supplier_capabilities` and `supplier_commercial_rules`, which exist in neither
`main` nor production.

Its baseline was captured *from production*, which is why staging has the 14
tables that the repository cannot create — further confirmation that production
is the only complete source.

Assessment from Mission 1 is unchanged: **disposable**, contents fully
enumerated and reproducible from migrations held in git. Not modified.

---

## 6. Caveats on this report

- The disposable database is **PostgreSQL 16.13**; production is **17.6**. This
  is sufficient to prove that migrations fail to create tables, which is a
  structural defect independent of version. It is **not** sufficient to certify
  a future baseline byte-for-byte — step 5 of the plan must run on a Supabase
  project of the same major version.
- Column-level comparison between production and a repo-built database was not
  performed, because the repo-built database is missing 22 of 32 tables. It
  becomes meaningful only once a captured baseline exists.
- Index, trigger and constraint definitions were counted, not diffed, for the
  same reason.

---

## 7. What this changes in the plan

[`DATABASE_BASELINE.md`](DATABASE_BASELINE.md) §4 stands, with step 4's choice
now settled by evidence rather than preference:

- **Capture the baseline from production.** Not a squash of the existing
  migrations — they demonstrably do not describe the schema.
- The baseline is a generated artefact committed to `supabase/migrations/` as a
  single dated file, replacing the existing 20 as history. The existing files
  are kept in git history, not deleted, so the intent behind each remains
  readable.
- Afterwards, the repository's migrations must be the *only* way the schema
  changes. The defect this report documents was caused by changing production
  directly, and a baseline does not prevent a recurrence on its own.
- `scripts/verify-migration-baseline.sh` should run in CI once the baseline
  exists, so the invariant cannot silently break again.

**Nothing in this report has been applied. No migration was written.**
