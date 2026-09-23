# Customer portal — production activation

## STATUS as of 2026-09-23

| Step | State |
| --- | --- |
| Code deployed to production | **DONE.** `main` is at the merge of PR #5 (+ PR #6). Vercel Production deployment succeeded. |
| `0005_customer_accounts.sql` | **NOT APPLIED.** |
| `0006_sales_orders.sql` | **NOT APPLIED.** |
| Production data | **UNCHANGED.** Verified identical before and after the deploy. |

**Why the migrations are not applied:** the production Supabase connector is
attached in **read-only** mode. It exposes no `apply_migration` tool and its
`execute_sql` runs inside a read-only transaction, which refuses DDL:

```
ERROR: 25006: cannot execute CREATE TABLE in a read-only transaction
```

This is a deliberate guardrail and was not worked around. Section 2 below has
the exact SQL to run, and two ways to run it.

**What production looks like right now:** the portal is deployed but inert.
Every surface that needs the new tables shows an explicit "module not
activated" message rather than an error, and existing admin, logistics and
catalogue functionality is untouched. Nobody can sign in, because no customer
account can exist until `customer_accounts` does.

---

Prepared 2026-09-23 against production as it stands at that date.

---

## 0. Where things actually are

**The code is on production.** `main` carried no customer portal until
2026-09-23; PR #5 (and then PR #6) merged it, and Vercel's Production
deployment succeeded. Vercel's production branch is `main` — confirmed by
inspecting the deployment history, where the only `Production` environment
deployments track `main`.

**The database is not.** The two migrations could not be applied from this
environment (see the status block above), so the portal is deployed and inert.

Applying 0005 and 0006 is therefore the last step, and it is still a safe one:
before the deploy no code referenced these objects at all, and after it the
only code that does is the portal itself, which currently degrades to an
explicit "module not activated" message.

---

## 1. Migration safety assessment

Checked directly against the production schema on 2026-09-23.

### Collisions — none

None of the objects 0005/0006 create already exist:

| Object | Kind | Exists in production? |
| --- | --- | --- |
| `customer_accounts` | table | No |
| `sales_orders` | table | No |
| `sales_order_items` | table | No |
| `sales_order_number_seq` | sequence | No |
| `create_portal_sales_order` | function | No |
| all five new indexes | index | No |

### Prerequisites — all present

| Requirement | Status |
| --- | --- |
| `customers.id` uuid primary key | present |
| `customer_locations.id` uuid primary key | present |
| `catalogue_products.id` uuid primary key | present |
| `supplier_product_listings.id` uuid primary key | present |
| `gen_random_uuid()` | available (pgcrypto installed) |
| `customers.active`, `customer_locations.active` | present |
| `anon` / `authenticated` roles | present, so the REVOKE applies |

### Shape of the change

* **Additive only.** Three `create table`, one `create sequence`, one
  `create or replace function`, five `create index`. No `ALTER` of any existing
  table, no `DROP`, no data mutation, no backfill.
* **RLS is enabled only on the two new tables**, with no policies — which denies
  `anon` and `authenticated` outright. Existing tables are untouched.
* **Idempotent.** Every statement is `if not exists` or `create or replace`, so
  a re-run is a no-op.
* **No existing functionality can break**, because no deployed production code
  names any of these objects. Verified by grep across `src/` and `app/`: every
  file referencing them is new in this branch.

**Assessment: SAFE and backward-compatible.**

### Verified against real PostgreSQL

`0005` + `0006` were applied to a disposable PostgreSQL 16 and the following
proven:

1. an order with an estimated PFU is created and records status + version;
2. `ESTIMATED` without an estimate version is **refused** by a check constraint;
3. a non-estimated status carrying an estimate version is **refused**;
4. `pos_on_delivery` is **refused** by the payment-method constraint;
5. an item FK failure rolls the header back too — 0 orphan headers;
6. replaying the same idempotency key returns the same order, creating no duplicate;
7. `select … where pfu_status='ESTIMATED'` finds exactly the orders priced on an estimate.

---

## 2. Activation sequence

Run in this order. Steps 1 and 2 are the owner's.

### Step 1 — apply the migrations — THE ONLY REMAINING BLOCKER

Either:

**(a) Run them yourself.** Supabase dashboard → SQL Editor → paste and run the
contents of, in order:

1. `supabase/pending-approval/0005_customer_accounts.sql`
2. `supabase/pending-approval/0006_sales_orders.sql`

Both are idempotent, so a re-run is a no-op.

**(b) Give the connector write access**, then ask for them to be applied:
claude.ai → Settings → Connectors → the production Supabase connector → allow
its migration/DDL tool. An organization admin may have capped it.

Order does not matter for safety — 0006 does not depend on 0005 — but the
portal needs both. The code is already deployed, so the portal starts working
the moment these run. No further deploy is needed.

### Step 2 — ship the code to production — ALREADY DONE

PR #5 merged `chatgpt/m12-customer-portal` into `main` on 2026-09-23, and PR #6
added the one follow-up fix. Vercel's Production deployment succeeded for both.

Nothing further is needed here: the portal starts working as soon as Step 1
runs, with no redeploy.

### Step 3 — create the Supabase Auth user and bind it

Two ways; the admin UI is the supported one.

**Via the admin UI (recommended).** `/admin/customers/<id>` now has an
**Accesso area clienti** panel: enter the email, press **Genera** for a
temporary password, press **Crea accesso**. It creates the Supabase Auth user
and the `customer_accounts` binding in one action, and deletes the auth user if
the binding fails.

**Manually**, if you prefer to create the user in the Supabase dashboard:

```sql
-- After creating the user in Supabase Auth → Users.
insert into public.customer_accounts (auth_user_id, customer_id, active)
values ('<auth user uuid>', '<customers.id uuid>', true);
```

The binding is **explicit and mandatory**. A Supabase user with no
`customer_accounts` row can authenticate and will still be refused by the
portal with `CUSTOMER_ACCOUNT_NOT_LINKED` — no customer is ever inferred from an
email address.

### Step 4 — give that customer a real delivery address

Checkout **refuses** a placeholder address. `createCustomerLocation` writes `—`
into the NOT NULL address columns when a document import had none, and
`isDeliverableLocation` rejects exactly that.

Check before testing:

```sql
select id, location_name, address_line1, city, active
from public.customer_locations
where customer_id = '<customers.id uuid>' and active = true;
```

If `address_line1` or `city` is `—`, edit the location at
`/admin/customers/<id>` first. A customer with no deliverable address sees
"Nessun indirizzo di consegna valido configurato" at checkout and cannot order.

### Step 5 — walk the journey

Public site → **Area clienti** (primary header CTA) → sign in → **Catalogo** →
choose width + aspect + rim → **Aggiungi** → **Carrello** → **Procedi
all'ordine** → choose bank transfer or cash on delivery → **Invia ordine a
GommaRush** → confirmation showing `GR-001000` → **Ordini** → and the same
`GR-001000` in `/admin/sales-orders`.

---

## 3. What the test order will look like

Sequence starts at 1000, so the first order is **GR-001000**.

Its PFU will be the temporary **estimate**: `pfu_status = 'ESTIMATED'` with
`pfu_estimate_version = 'gr-pfu-estimate-2026-09-placeholder-v1'` on both the
header and every line. The customer sees "PFU stimato" and the disclosure
"PFU stimato — l'importo definitivo può variare."

To find every order that rests on an estimate:

```sql
select order_number, pfu_estimate_version, grand_total_cents, requested_at
from public.sales_orders
where pfu_status = 'ESTIMATED'
order by requested_at desc;
```

---

## 4. What is still switched off

* **Supplier ordering.** "Conferma e invia ordine" is `disabled` on both admin
  screens. No customer order can reach Inter-Sprint, Protocol 103/104, a
  supplier email, or any external commitment.
* **Public registration.** The account screen shows it as a disabled future
  option. Nothing accepts a registration.
* **Verified PFU tariffs.** `VERIFIED_PFU_TARIFFS` is still empty (D3). The
  estimate is standing in, and the moment a real tariff is loaded the estimate
  stops being produced — with no code change, because `resolvePfu` prefers a
  verified tariff and only falls through to the estimate.

## 5. Verifying the migrations landed

After running them:

```sql
select
  (select count(*) from information_schema.tables
     where table_schema='public'
       and table_name in ('customer_accounts','sales_orders','sales_order_items')) as tables_created,  -- expect 3
  (select count(*) from information_schema.routines
     where routine_schema='public' and routine_name='create_portal_sales_order') as rpc_created,       -- expect 1
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relname in ('customer_accounts','sales_orders','sales_order_items')
       and c.relrowsecurity) as rls_enabled,                                                            -- expect 3
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('customer_accounts','sales_orders','sales_order_items')) as policies;            -- expect 0, deliberately
```

`policies = 0` with `rls_enabled = 3` is correct and intentional: RLS with no
policy denies `anon` and `authenticated` outright, and the portal reads and
writes server-side through the service role after resolving the session.

## 6. Rolling back

The migrations are additive, so rollback is dropping what they created. Only do
this if no real order exists yet:

```sql
drop function if exists public.create_portal_sales_order(
  uuid, uuid, text, jsonb, jsonb, jsonb, text, text, text, text,
  bigint, bigint, bigint, bigint, text, text, text, numeric, integer, jsonb);
drop table if exists public.sales_order_items;
drop table if exists public.sales_orders;
drop sequence if exists public.sales_order_number_seq;
drop table if exists public.customer_accounts;
```

Reverting the deploy alone is enough to close the portal without touching data,
and is the safer first move if something looks wrong.
