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

---

## 8. The baseline: captured, proved, compared (2026-09-21)

The plan in §7 has been carried out. `supabase/baseline/` now contains the
canonical schema, and `supabase/post-baseline/` the first migration on top of
it.

### Method

Captured from production by read-only introspection, then applied from empty to
a disposable **PostgreSQL 17.6** instance — the same minor version production
runs, so expression deparsing matches. The instance came from
`@embedded-postgres/linux-x64@17.6.0-beta.15`, which needs neither Docker nor
root. Neither production nor staging was used as the target.

Supabase's environment was reproduced first: the `extensions` schema with
pgcrypto and uuid-ossp, `search_path = public, extensions`, and the `anon` /
`authenticated` / `service_role` roles. Several functions call
`gen_random_bytes` unqualified and fail without it, and isolating that up front
keeps "this is not Supabase" out of the results.

### Result: the counts match exactly

| Object | Production | From baseline |
| --- | --- | --- |
| Tables | 32 | **32** |
| Columns | 541 | **541** |
| Primary keys | 32 | **32** |
| Foreign keys | 51 | **51** |
| Check constraints | 56 | **56** |
| Unique constraints | 12 | **12** |
| Indexes | 141 | **141** |
| Functions | 28 | **28** |
| Triggers | 23 | **23** |
| RLS-enabled tables | 32 | **32** |
| RLS policies | 0 | **0** |

### Result: five of six object classes are byte-identical

Comparing md5 fingerprints of the deparsed definitions, read on both sides with
`search_path = public`:

| Class | Fingerprint match |
| --- | --- |
| Columns (type, nullability, default) | ✅ identical |
| Constraints (all four kinds) | ✅ identical |
| Indexes | ✅ identical |
| Triggers | ✅ identical |
| RLS flags | ✅ identical |
| Functions | ⚠️ see below |

### The one class that differs: function source text

12 of 28 functions differ textually. **All 28 are semantically identical**, and
the differences fall into exactly three explained categories:

1. **Comments stripped in production.** The repository's definitions carry
   their explanatory comments; production's stored copies do not. Production's
   functions were evidently applied through something that stripped them.
2. **Whitespace and line wrapping.** `declare v_count integer;` on one line
   versus two; a `select ... from x where y` wrapped differently.
3. **One syntactic equivalence.** In `gorush_refresh_order_status`, the
   repository has `v_target in ('partially_received')` where production has
   `v_target = 'partially_received'`. A single-element `IN` list is exactly
   equality in PostgreSQL.

Proof: with comments and all whitespace removed, 27 of 28 hash identically, and
a full line-by-line diff of the 28th shows only the three differences above.

**The baseline keeps the repository's commented versions.** They are the same
code, and they carry the reasoning. A baseline whose function bodies had been
stripped of every explanation would be a worse artefact than the one being
replaced.

> This is itself a finding: production's functions were not created purely from
> the repository's migrations. It is consistent with R15 — the schema was
> changed directly — and is one more reason the practice has to stop.

### Zero unexplained differences

Every difference between a fresh database built from source control and
production is accounted for above. Nothing was found that could not be
explained.

---

## 9. Observed inconsistencies, documented rather than tidied

The baseline reproduces production faithfully, including the things that look
like accidents. Silently "fixing" them would mean a baseline that does not
match the database it claims to describe. Each needs an owner decision, not an
agent's judgement.

1. **`orders` has two overlapping unique indexes on the document number.**
   `orders_supplier_doc_number_key` on `(supplier_id,
   normalized_document_number)` and `orders_supplier_document_unique` on
   `(supplier_id, supplier_document_number)`, both partial. The normalized one
   presumably supersedes the raw one, but both are enforced, so a document
   number that normalises to a duplicate is rejected twice over — and a
   supplier who reuses a raw number with different normalisation is rejected by
   only one. Reproduced as-is.

2. **`print_jobs` and `client_offer_requests` are still present** with
   retirement migrations in the repository that were never applied.
   `print_jobs` holds 2 rows, `client_offer_requests` none. Reproduced as-is;
   retiring them is a separate decision (see §4.4).

3. **`quote_request_items.delivery_speed` allows `'48h'`, not `'24h'`.** The
   original migration wrote `'24h'`; `20260829000000_delivery_48h.sql` changed
   it. Production is correct and the constraint is reproduced from production,
   not from the older file.

4. **The document-analysis tables and functions are absent from the baseline.**
   Their migrations exist in the repository but have never reached production,
   so they are not part of the current schema. They stay as pending work, and
   the live routes that query them still cannot work (R2).

---

## 10. What must happen next

The baseline exists and is proved, but **nothing has been applied to production
and the ledger has not been reconciled.** Remaining, in order:

1. Owner approves the baseline (this report).
2. Verified, restorable backup of production — an untested backup is not one.
3. Reconcile production's migration ledger to the baseline. The expected change
   is **to the ledger only**; production's schema must not change. Any step
   that would alter live schema means something above is wrong.
4. Rebuild staging from the baseline (assessed disposable in §5).
5. Apply `supabase/post-baseline/0001_deldo_classification.sql`, which unblocks
   Deldo persistence.
6. Run `scripts/verify-migration-baseline.sh` in CI so R15 cannot recur.
