# Database Baseline & Migration Reconciliation

All facts verified 2026-09-21 by direct query against the production and staging
databases. **No schema was modified.** Re-verify before acting on anything here:
these are observations with a date, not permanent truths.

---

## 1. The problem

Three migration lineages exist and none of them agree.

| Lineage | Migrations | Reality |
| --- | --- | --- |
| **Repository** (`supabase/migrations/`) | 20 files, `2026080400…`–`2026090200…` | The intended history |
| **Production** (`sfvaqextratpnprcamwd`) | 14 ledger entries, different timestamps *and* different names | Live business data |
| **Staging** (`ltdwabkitplicyiwucsp`) | 7 ledger entries, rebuilt 2026-09-21 | Synthetic fixtures only |

Not one repository filename matches a production ledger version. Production's
ledger was written by a different process (dashboard or CLI push with generated
timestamps), so **the ledger cannot be compared to the repo by version number**
— only by name and by inspecting the schema itself.

**Consequence:** `supabase db push` against production today would be
unpredictable. Nothing should be pushed until this is reconciled.

> **Updated 2026-09-21 — the problem is worse than a ledger mismatch.**
> Applying the repository's migrations to an empty database produces **10 of
> 32 tables**; 11 of 20 migrations fail, and 14 production tables including
> `orders`, `customers` and `suppliers` are **never created by any migration
> in git**. Full evidence, reproducible with
> `bash scripts/verify-migration-baseline.sh`, is in
> [`SCHEMA_RECONCILIATION_REPORT.md`](SCHEMA_RECONCILIATION_REPORT.md).

---

## 2. Production: what is actually there

Live business data — this database is in daily use.

| | Rows |
| --- | --- |
| `orders` / `order_items` / `inventory_units` | 26 / 44 / 102 |
| `customers` / `customer_locations` | 14 / 16 |
| `suppliers` | 16 |
| `drivers` / `vehicles` | 3 / 10 |
| `quote_requests` / `_items` / `_events` | 2 / 2 / 10 |
| `catalogue_products` | 9,550 |
| `supplier_product_listings` | 9,559 |
| `supplier_listing_prices` | 9,559 — **all `purchase_price` NULL, no stock** |
| `product_identifiers` | 28,632 |
| `catalogue_import_runs` | 1 (committed 2026-09-08) |

### Applied but not recorded in the ledger

These tables exist with data, yet no ledger entry names them. They were applied
outside the migration system:

- `quote_requests`, `quote_request_items`, `quote_request_events`,
  `quote_request_webhook_events`, `quote_request_reference_counter`
  → repo `20260826000000_quote_requests.sql`, `20260827000000_quote_requests_production.sql`

### In the repository, absent from production

| Repo migration | Effect of being unapplied |
| --- | --- |
| `20260901000000_document_pipeline_core.sql` | `document_analyses`, `document_extracted_lines`, `document_party_mappings`, `document_import_idempotency` **do not exist** |
| `20260902000000_document_analysis_queue.sql` | analysis queue does not exist |
| `20260828000000_retire_print_jobs.sql` | `print_jobs` still present (2 rows) |
| `20260826000100_retire_client_offer_requests.sql` | `client_offer_requests` still present (0 rows) |

> **RISK — a deployed feature cannot work in production.**
> `src/lib/server/document-analysis-jobs.ts` queries `document_analyses` and
> `document_extracted_lines`. It is reached by `/api/admin/ddt-import/status`
> and `/api/cron/document-analysis`. Both will fail at runtime against the
> current production schema. Either the feature is unused, or it is broken and
> nobody has reported it. **Confirm before the reconciliation window** — it
> changes whether these migrations are urgent or merely missing.

### Objects that may be obsolete

`print_jobs` and `client_offer_requests` both have retirement migrations in the
repo. `print_jobs` holds 2 rows; `client_offer_requests` is empty. Retiring them
is safe **only** after confirming no deployed code reads them.

---

## 3. Staging: assessment — DISPOSABLE

Rebuilt 2026-09-21 from `claude/sleepy-gauss-lezg26`, whose baseline was
reconstructed from production's schema. **Its ledger is that branch's, not
`main`'s.**

Contents, fully enumerated:

- 3 lane suppliers: Inter-Sprint, Deldo, Italian 48h — **seeded by migration**
- `supplier_capabilities` 19 rows, `supplier_commercial_rules` 4 rows —
  **seeded by migration**
- 1 synthetic catalogue product (NANKANG 205/55 R16), 2 listings, 3 price
  observations — including one deliberately fictional row (€0.01, `is_test_data`)
  kept as a regression fixture for the test-data exclusion boundary
- No customers, orders, drivers, vehicles or real commercial data

**Conclusion: staging contains nothing expensive or impossible to reconstruct.**
No unique data, no credentials, no supplier configuration beyond what the seed
migrations produce. Every row is reproducible by re-running migrations held in
git.

**One caveat:** staging is currently the only proof that the supplier-foundation
migrations apply cleanly. That evidence is reproducible, but the migration files
must stay in git — **do not delete `claude/sleepy-gauss-lezg26`.**

Staging is therefore safe to rebuild from a canonical baseline when approved. It
was **not** modified during this mission.

**Staging is not authoritative.** It is a development environment. Schema or
business truth is established by the repository, production and supplier
documentation — never by what happens to be in staging.

---

## 4. Reconciliation plan — PREPARED, NOT EXECUTED

**Goal:** `fresh environment + canonical migrations = expected schema`.

Do not execute any step without explicit owner approval. Steps 1–4 are
read-only and safe to begin.

### Step 1 — Capture ground truth (read-only)
Dump the full production schema: tables, columns, constraints, indexes,
functions, triggers, RLS policies, enums, sequences, extensions. Store it as a
dated artefact in the repository. This is the reference every later step is
checked against.

### Step 2 — Three-way diff (read-only)
Diff production schema against (a) the repository migrations applied in order to
an empty database, and (b) staging. Produce an explicit object-level inventory:
matching · in repo only · in production only · same name/different definition.
The last category is the dangerous one.

### Step 3 — Classify each divergence (read-only)
For every difference: applied-outside-the-ledger · genuinely unapplied ·
obsolete · unexplained. **Unexplained objects block progress** until explained —
an object nobody can account for must not be carried into a canonical baseline
or dropped from one.

### Step 4 — Decide the baseline strategy (OWNER_DECISION)
**Settled by evidence, no longer a preference.** The baseline must be
**captured from production**, because the repository's migrations do not
describe the schema — they only alter tables created outside version control
(see [`SCHEMA_RECONCILIATION_REPORT.md`](SCHEMA_RECONCILIATION_REPORT.md) §1).

A squash of the existing migrations was the earlier recommendation and is now
**rejected**: squashing files that produce 10 of 32 tables would produce a
baseline that is equally incomplete.

Repairing the ledger entry by entry is also rejected — it would leave the 14
missing tables still absent from git.

The captured baseline lands as a single dated file in `supabase/migrations/`,
replacing the existing 20 as *history*. The old files stay in git history
rather than being deleted, so the intent behind each remains readable.

### Step 5 — Prove it on a throwaway environment
Apply the canonical baseline to a **new, empty** Supabase project. Diff the
result against the Step 1 production dump. **Zero unexplained differences is the
pass condition.** Iterate here, never against production or staging.

### Step 6 — Backup and recovery, before touching anything shared
- Verified point-in-time-recovery window, or a fresh logical dump, confirmed
  **restorable** — an untested backup is not a backup.
- A written rollback procedure and the decision point for using it.
- A maintenance window; the warehouse and driver app are in daily use.
- Recovery rehearsed on the throwaway environment from Step 5.

### Step 7 — Apply
Staging first, rebuilt from the canonical baseline. Then production — where the
expected change is **to the ledger only**, never to the schema. Any step
proposing to alter production's live schema means Step 5 has not passed.

### Step 8 — Validate
- Schema diff versus the Step 1 dump: zero unexplained differences.
- Row counts on every business table unchanged.
- `npx vitest run`, `npx tsc --noEmit`, `npm run build` all green.
- Smoke-test the live paths: admin login, order list, driver session, catalogue
  lookup, quote request submission.
- A fresh empty project + canonical migrations reproduces the schema.

---

## 5. Proposed port: supplier lanes & capabilities — NOT IMPLEMENTED

`claude/sleepy-gauss-lezg26` carries a working capability model, proven in
staging. It is **not** ported in this mission: doing so needs a migration, and
adding a migration while the ledger is divergent would deepen the problem this
document exists to solve.

**Port after reconciliation, taking the concept and not the baseline:**

- `supplier_capabilities` — `(supplier_id, capability, enabled, verified_at,
  notes)`. Absence means unavailable. Keep the check constraint that makes
  enabling supplier ordering structurally impossible in V1.
- `supplier_commercial_rules` — `(supplier_id, rule_type, scope, numeric_value,
  currency, source_note, effective_from, effective_to)`. This is where
  Inter-Sprint's 60 PCR / 10 truck minimums and prepayment gating belong.

**Explicitly rejected:** that branch's reconstructed baseline migrations
(`20260921072323`–`20260921074036`). `main`'s catalogue schema is richer, is
what production actually runs, and must remain the normalized core.

---

## 6. Supplier identity: `"asdas"` — evidence only, no action taken

The supplier owning the **entire** production catalogue is named `asdas`,
`vat_number = "ads"`. All other fields are null.

### Provenance

| Fact | Evidence |
| --- | --- |
| Created **2026-08-18 10:22:30** | `suppliers.created_at` |
| A test order was created **one second later**, `ORD-10856`, now **cancelled**, 1 item, 8 inventory units | `orders` where `supplier_id = 4ce0b557-…` |
| The catalogue was imported against it **three weeks later**, 2026-09-08 | `catalogue_import_runs.committed_at` |
| Import: adapter `isb`, file `GommaRush_ISB_Tyre_Catalogue_Import-3.xlsx`, mode `partial`, 9,559 rows, 0 conflicts, 0 rejected | `catalogue_import_runs` |

So the record was created as a throwaway test supplier, then **reused** as the
target of a real catalogue import.

### Evidence about the real supplier's identity

Pointing to Inter-Sprint:
- `supplier_listing_key` values are prefixed `ISB:` (e.g. `ISB:286099`)
- The adapter parses **Dutch** `J`/`N` (*ja*/*nee*) booleans; Inter-Sprint is a
  Dutch company
- `brand_code` is a two-letter code (`CO` for Continental), and descriptions are
  fixed-width (`"3.25    -19 TL 54H  CO CONTIGO! F"`) — the same shape as the
  description format cited for the Inter-Sprint gateway
- The filename contains `ISB`

**Against treating this as settled:** no document in this repository defines what
`ISB` stands for. The identification is consistent circumstantial evidence, not
a supplier-confirmed fact, and the instruction not to infer identity from a
filename applies to the other signals too — they are all from the same file.

### Dependencies on the supplier id `4ce0b557-9575-4784-aa80-99e78af4da2f`

9,559 listings · 9,559 identifier rows · 1 import run · 1 cancelled order ·
1 customer ref · 0 locations.

> **OWNER_DECISION — not taken.** Renaming in place preserves all catalogue
> links but also relabels a cancelled test order as that supplier's. Creating a
> proper supplier and re-importing leaves the test record clean but rewrites
> 9,559 listings. **Nothing was renamed, merged or deleted.**

### Related: duplicate supplier records

16 suppliers include apparent duplicates — `ZUIN GOMME S.P.A.` / `Zuin Gomme` /
`Z.U.I.N. GOMME S.p.A.` / `ZUIN S.p.A.`, `FIN TYRE SPA` / `FINTYRE SPA`,
`CARLINI GOMME S.R.L.` / `CARLINI GOMME TYRES DISTRIBUTION` — plus placeholders
`Name` and `Furnizor Demo (test)`. Deduplication is an OWNER_DECISION; merging
supplier records affects existing orders and accounting.

---

## 7. Proposed migration: Deldo lane — SPECIFIED, NOT WRITTEN, NOT APPLIED

Mission 2 built the Deldo feed parser, the observation model and GET_STOCK
entirely in the application layer, so nothing here has been applied to any
database. The schema gaps below are real but must wait for the reconciliation
gate in §4 — adding a migration while three ledgers disagree would deepen the
problem rather than solve it.

### What the existing schema already covers

More than expected. `NormalizedCatalogueRow` already carries `purchasePrice`,
`stockRaw`, `stockExact` and `stockMinimum`, and `supplier_product_listings`
already carries `old_dot` with the comment *"Two listings may share a product
(new stock vs old DOT)"*. That is exactly Deldo's duplicate-EAN case, so the
Deldo lane needs **no new product or listing structure at all**.

### The one genuine gap: test/live classification — FAIL-CLOSED

There is no `data_classification` column anywhere in the schema. Deldo's sample
feed carries fictional prices and quantities, and the supplier's test API
endpoint serves the same, so an observation's classification must survive into
the database — otherwise a fictional price becomes indistinguishable from a
real one the moment it is persisted.

> **Revised 2026-09-21. The earlier draft of this section proposed
> `not null default 'live'`. That was wrong and is replaced.**
>
> A default of `'live'` means the failure mode of *forgetting* to classify is
> *"it silently became commercial data"*. That is exactly backwards: the whole
> purpose of the column is to stop fictional data being mistaken for real, and
> a default that resolves omission in favour of `live` re-creates the hazard it
> was added to remove. An `INSERT` written before the Deldo work existed, a
> future adapter, a manual backfill, a `COPY` — any of them omitting the column
> would produce commercial-looking rows.
>
> The column is now `not null` **with no default**, so omission is an error at
> the database level rather than a silent reclassification.

```sql
-- One vocabulary, used by every table that carries the classification.
create domain public.data_classification as text
  check (value in ('live', 'test'));

-- Provenance of an import run: which environment and file it came from.
-- NOT NULL, NO DEFAULT: an import that does not say what it is, fails.
alter table public.catalogue_import_runs
  add column data_classification public.data_classification;

-- Backfill EXPLICITLY, as a deliberate statement about known rows, never as a
-- default that would also apply to rows nobody has thought about yet.
-- The single existing run is the real Inter-Sprint upload of 2026-09-08.
update public.catalogue_import_runs
   set data_classification = 'live'
 where data_classification is null;

alter table public.catalogue_import_runs
  alter column data_classification set not null;

-- Carried onto the observation too, so a query never has to join to find out
-- whether a price is real.
alter table public.supplier_listing_prices
  add column data_classification public.data_classification,
  -- Deldo's two documented pricing modes. 'unknown' is a legitimate, explicit
  -- state meaning "not yet confirmed with the supplier" — it is NOT a default
  -- for omission, and classifyObservation() treats it as unusable.
  add column commercial_mode text
    check (commercial_mode in ('transport_separate', 'transport_included', 'unknown')),
  add column observation_source text
    check (observation_source in ('bulk_feed', 'live_lookup', 'manual'));

update public.supplier_listing_prices
   set data_classification = 'live',
       commercial_mode     = 'unknown',
       observation_source  = 'bulk_feed'
 where data_classification is null;

alter table public.supplier_listing_prices
  alter column data_classification set not null,
  alter column commercial_mode     set not null,
  alter column observation_source  set not null;
```

**The three-step shape — add nullable, backfill explicitly, then set not null —
is the point**, not incidental. It is what allows `not null` with no default on
a table that already has rows, and it forces the backfill to be a reviewable
statement about *specific known rows* rather than a rule silently applied to
every future one.

`commercial_mode = 'unknown'` deserves the same distinction. It is an explicit
assertion that the supplier has not yet told us which pricing mode applies (see
handoff D8), and the application always writes it deliberately. It is not a
fallback for a caller that forgot.

The application already enforces the same rule above the database:
`SupplierObservation.classification` is a required field with no default, and
`classifyObservation()` checks it before completeness and before age.

### Deferred, not needed yet

Separate `price_verified_at` / `stock_verified_at`, stock confidence, and lead
time / delivery class. All are in the target model in
[`architecture/01_SUPPLIER_ARCHITECTURE.md`](architecture/01_SUPPLIER_ARCHITECTURE.md)
but none is required to ingest a feed or verify stock, and adding columns
nothing writes is how schemas rot.
