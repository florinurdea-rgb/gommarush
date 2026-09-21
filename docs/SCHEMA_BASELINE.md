# Schema Baseline

Phase 0 deliverable. How GommaRush's database schema got into version control,
what staging now contains, and how migrations must be handled from here.

**Production was not modified.** No production migration, no production write,
no ledger repair. Every production interaction was a catalog read over the
read-only connector.

---

## 1. What production contains

Project `sfvaqextratpnprcamwd`, captured 2026-09-21.

| Component | Count |
| --- | --- |
| Tables (`public`) | 32 |
| Columns | 541 |
| Constraints (PK / UNIQUE / CHECK / FK) | 151 (32 / 12 / 56 / 51) |
| Indexes (incl. constraint-backed) | 141 |
| Functions | 28 |
| Triggers (user) | 23 |
| Tables with RLS enabled | 32 |
| **RLS policies** | **0** |
| Sequences | 3 (2 standalone + 1 identity-owned) |
| Comments (table + column) | 18 |
| Enums / views / materialized views | 0 / 0 / 0 |
| Migration ledger rows | 14 |

Four subsystems: **logistics** (live, real data — `orders` 26, `order_items` 44,
`inventory_units` 102), **tyre catalogue** (`catalogue_products` 9,550,
`supplier_product_listings` 9,559, `supplier_listing_prices` 9,559,
`product_identifiers` 28,632), **quote intake** (`quote_requests` 2,
`client_offer_requests` 0), and **supplier master** (`suppliers` 16).

RLS on with zero policies is a deliberate deny-by-default posture: no `anon` or
`authenticated` INSERT/UPDATE/DELETE grants exist on any table. Do not "fix" the
`rls_enabled_no_policy` advisory by adding permissive policies.

## 2. What staging contains

Project `ltdwabkitplicyiwucsp`. Was completely empty (0 tables, 0 migrations)
before Phase 0.

Staging now holds **the application schema and nothing else**: all 32 tables
exist and **all 32 are empty**. No production business or customer data was
copied. Synthetic rows created during validation were deleted and the identity
column and both sequences were reset.

### Parity with production

Verified by definition-level fingerprint, not row counts. Both sides were read
under an identical `search_path` so no deparse artifact could mask or fabricate a
difference.

| Component | Production | Staging | Match |
| --- | --- | --- | --- |
| Columns | 541 `bc18a49d…` | 541 `bc18a49d…` | identical |
| Constraints | 151 `84a1081c…` | 151 `84a1081c…` | identical |
| Indexes | 141 `41c6a26f…` | 141 `41c6a26f…` | identical |
| Functions | 28 `e3cc30db…` | 28 `e3cc30db…` | identical |
| Triggers | 23 `31825266…` | 23 `31825266…` | identical |
| RLS | 32 `87a88dad…` | 32 `87a88dad…` | identical |
| Policies | 0 | 0 | identical |
| Comments | 18 `c818d1d2…` | 18 `c818d1d2…` | identical |
| Sequences | 3 `6f617024…` | 3 `6f617024…` | identical |

The fingerprint covers, per object: column name, full type with modifiers,
nullability, default expression, identity flag; full constraint definitions;
full index definitions; function body hash, identity arguments and language;
full trigger definitions; RLS enabled/forced flags; and comment text.

## 3. Baseline methodology

There is no `supabase` CLI in this environment, and production database
credentials are deliberately not available (obtaining them would be an
`OWNER_DECISION`). `pg_dump` therefore could not be used against production.

The baseline was instead built by **catalog introspection over the existing
read-only connector** — `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`,
`pg_index`, `pg_proc`, `pg_trigger`, `pg_description`, `pg_sequence` — and
assembled into ordered migration files.

**Load order matters** and is encoded in the file numbering:

```
extensions → sequences → tables → functions → constraints → indexes
           → triggers → RLS → comments
```

Functions precede constraints because `client_offer_requests`'
`valid_client_offer_request_tyres` CHECK calls `is_valid_tyre_request()`.

Before anything touched staging, the whole baseline was **applied to a throwaway
local PostgreSQL 16 instance** and exercised: `gorush_create_order` produced an
order, its items, two inventory units and a status-history row;
`gorush_schema_health()` returned `ok=true`. The same smoke test was then re-run
on staging and its synthetic rows removed.

### Two defects the dry-run caught

1. **`orders.order_number` is `GENERATED ALWAYS AS IDENTITY`.** A naive capture
   reads it as a plain `bigint not null` with no default, because `pg_attrdef`
   does not describe identity columns — you must read `pg_attribute.attidentity`.
   Had that been missed, every `gorush_create_order` call would have failed with
   a not-null violation. Its owning sequence `orders_order_number_seq` is created
   implicitly and must NOT be declared standalone.

2. **`gorush_new_unit_token()` is `LANGUAGE sql` and calls `gen_random_bytes()`
   unqualified.** SQL-language bodies are validated at creation time, so it
   fails to create on a database where `extensions` is not on the `search_path`.
   See "Known fragility" below.

## 4. Exclusions

Deliberately **not** captured, and why:

| Excluded | Reason |
| --- | --- |
| `auth`, `storage`, `realtime`, `vault`, `graphql`, `cron` schemas | Supabase-managed; recreated by the platform per project |
| `pg_stat_statements`, `supabase_vault` extensions | Platform-managed |
| Roles, grants, role/database `search_path` settings | Environment-specific; managed by Supabase |
| Publications, webhooks, secrets | Environment-specific |
| `supabase_migrations.schema_migrations` rows | Ledger state is per-environment; copying it would falsify history |
| **All table data** | Schema only. No production business or customer data is copied to staging |

`pgcrypto` and `uuid-ossp` **are** included (both `with schema extensions`,
matching production) because application objects depend on them:
`gen_random_uuid()` for primary keys and `extensions.gen_random_bytes()` for
`qr_token` defaults on `orders`, `inventory_units` and `warehouse_zones`.

The `realtime` schema is excluded but the three `gorush_broadcast_*` trigger
functions call `realtime.send()`. They are `plpgsql`, so the reference resolves
at run time, and each wraps the call in `exception when others then return new`
— realtime never blocks the underlying write. On a plain PostgreSQL instance
without Supabase, stub `realtime.send(jsonb, text, text, boolean)` to run them.

## 5. Migration-history discrepancies

### 5.1 The repository was never a valid migration source for production

Before Phase 0 the repository contained exactly **one** migration,
`20260804000000_client_offer_requests.sql`, while production's ledger contained
**14**, none of which were in the repository.

### 5.2 The `client_offer_requests` version discrepancy

The same logical migration is recorded under two different versions:

| Source | Version | Name |
| --- | --- | --- |
| Repository file | `20260804000000` | `client_offer_requests` |
| Production ledger | `20260820124105` | `client_offer_requests` |

Consequence: `supabase db push` from this repository would treat
`20260804000000` as unapplied and attempt to apply it. Its SQL is idempotent, so
the likely outcome is a spurious ledger row rather than data loss — but the
repository is not a trustworthy migration source for production and must not be
used as one until this is resolved.

### 5.3 The repository file and production had drifted textually

`public.is_valid_tyre_request` differs between the two: production keeps the
season check on a single line, the repository file spreads it over five. The
bodies are semantically identical. This is direct evidence that the repository
file and what was actually applied to production diverged.

Per the precedence rule in `CLAUDE.md` §0 — a proven production fact outranks the
repository — the baseline carries **production's** exact body. Migration
`20260921074036_baseline_04_function_fidelity_fix` records the correction, because
it is in the staging ledger and the repository must mirror the ledger.

### 5.4 Recommended reconciliation procedure — NOT EXECUTED

Repairing production's ledger is a production write and therefore
`OWNER_DECISION`. Nothing below has been run. Recommended sequence, for approval:

1. **Take a production backup** and confirm it is restorable. Non-negotiable
   first step.
2. **Adopt "production is baselined at `20260908142622`."** Treat every existing
   production ledger row as historical fact. Do not attempt to replay,
   reconstruct or reorder them.
3. **Reconcile the repository, not production.** Keep the four baseline files as
   the reproducible definition of the schema. Retire
   `20260804000000_client_offer_requests.sql` as a migration — its content is
   already inside the baseline — by moving it to `supabase/migrations/archive/`
   with a header explaining it was superseded. This removes the version
   discrepancy **without writing to production**, and is the lowest-risk option.
4. **Only if a CLI-driven workflow against production is later required**, mark
   the baseline files as already-applied rather than running them:
   `supabase migration repair --status applied <version>` for each of the four.
   This writes to `supabase_migrations.schema_migrations` in production and needs
   its own explicit approval on top of step 3.
5. **Verify** afterwards by re-running the §2 parity fingerprint. It must still
   show all nine components identical.

**Preferred: steps 1–3 only.** They achieve a trustworthy repository with zero
production writes. Step 4 is optional and should be deferred until something
concretely requires it.

## 6. Future migration procedure

Every schema change follows this order. No exceptions.

1. **Write** a new migration file in `supabase/migrations/`. Never edit an
   applied migration — applied files are history.
2. **Apply to staging first** (`ltdwabkitplicyiwucsp`), never to production.
3. **Name the repository file after the version the staging ledger actually
   recorded.** Staging assigns its own timestamp on apply; if the file name and
   the ledger version disagree, the repository stops being a faithful mirror.
   This already happened once in Phase 0 and the files were renamed to match.
4. **Verify on staging** — see §7.
5. **Re-run the parity fingerprint** (§2) against production. Understand every
   difference: after a deliberate change the two are *expected* to differ, in
   exactly the ways the migration describes and no others.
6. **Update documentation in the same change** (`CLAUDE.md` §10).
7. **AI review.** Schema additions are `REVIEW` level.
8. **Production is `OWNER_DECISION`.** Applying anything to production requires
   explicit owner approval, every time.

### Warning: never run a blind `supabase db push` against production

```
supabase db push   # ← NOT against sfvaqextratpnprcamwd
```

Production's ledger holds 14 migrations whose SQL this repository does not
contain, and the repository holds baseline files that production's ledger does
not list. A `db push` would compare those sets and attempt to apply files
describing objects that **already exist**, against a live database carrying real
warehouse, delivery and catalogue data. Do not run it until §5.4 is approved and
completed, and even then apply migrations individually and deliberately.

The same caution applies to `supabase db reset` (destroys data) and
`supabase db pull` (rewrites local migration history from the remote).

## 7. How to test a migration in staging

1. **Apply** to staging via the staging connector's `apply_migration`.
2. **Parity-check**: run the §2 fingerprint on both projects. Every difference
   must be one the migration intends.
3. **Smoke-test the affected paths with synthetic data.** Creating synthetic
   staging data is `AUTO`. What Phase 0 ran, as a template:
   - `gorush_schema_health()` returns `ok = true`
   - `gorush_create_order(...)` creates the order, its items, one
     `inventory_units` row per unit of quantity, and a status-history row
   - `orders.order_number` increments (identity intact)
   - `gorush_new_unit_token()` returns a `GRU…` token
   - `gorush_next_quote_reference()` returns `GR-YYMMDD-NNNN` in Europe/Rome
   - `is_valid_tyre_request(...)` accepts a valid tyre and rejects an invalid one
4. **Clean up**: delete synthetic rows and reset identity/sequences, so staging
   stays schema-only unless seed data is deliberately wanted.
5. **Record the result in `.ai/handoff.json`** — what was verified and how.
   "Verified" without evidence is not verification.

Optionally, validate against a throwaway local PostgreSQL 16 first (stub
`realtime.send`). It is faster than staging and catches ordering and dependency
errors before anything remote is touched — it is how both defects in §3 were
found.

## 8. Known fragility (production, pre-existing — not introduced here)

`public.gorush_new_unit_token()` is `LANGUAGE sql` and calls `gen_random_bytes()`
**unqualified**, while the function lives in `extensions`. It therefore resolves
only when `extensions` is on the caller's `search_path`.

Observed role settings in production:

| Role | `search_path` |
| --- | --- |
| `postgres` | `"$user", public, extensions` ✅ |
| `anon`, `authenticated`, `authenticator` | *(no override — inherits `"$user", public`)* ❌ |

Migrations run as `postgres` and work. A call arriving through PostgREST as
`anon`/`authenticated` would resolve `search_path` without `extensions` and
fail with `function gen_random_bytes(integer) does not exist` — which also
breaks `gorush_create_order`, since it calls this function for every unit.

This was reproduced on a local instance, both failing and passing depending only
on `search_path`. **It has not been verified against production via a real
PostgREST call, and must not be — that would be a production write.** It is
recorded as a risk, not a confirmed production outage.

The baseline deliberately preserves the function body **exactly as production
has it** and reproduces the creation environment with
`set search_path = "$user", public, extensions;`. Rewriting the body to qualify
the call would be a behaviour change requiring review, and is out of Phase 0
scope. Suggested fix, for a later phase: either qualify the call as
`extensions.gen_random_bytes(12)` or attach `SET search_path` to the function.

## 9. Files

| File | Contents |
| --- | --- |
| `supabase/migrations/20260921072323_baseline_01_schema.sql` | extensions, 2 sequences, 32 tables |
| `supabase/migrations/20260921072712_baseline_02_functions.sql` | 28 functions |
| `supabase/migrations/20260921073103_baseline_03_constraints_indexes.sql` | 151 constraints, 97 standalone indexes, 23 triggers, 32 RLS, 18 comments |
| `supabase/migrations/20260921074036_baseline_04_function_fidelity_fix.sql` | `is_valid_tyre_request` corrected to production's exact body (§5.3) |
| `supabase/migrations/20260804000000_client_offer_requests.sql` | Pre-existing. Superseded by the baseline; see §5.4 step 3 |

The four baseline file names match the staging ledger versions exactly.
