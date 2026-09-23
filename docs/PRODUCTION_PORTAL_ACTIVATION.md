# Customer portal — production activation

Owner checklist for switching on the customer journey in production and placing
a real test order. **Nothing here has been executed.** Steps 1 and 2 are owner
decisions and are not performed by an agent.

Prepared 2026-09-23 against production as it stands at that date.

---

## 0. Where things actually are

The single most important fact, verified rather than assumed:

**Production runs `main` (1aa7064), which contains no customer portal at all.**
`app/account/**`, `app/admin/(secure)/sales-orders/**`, `customer_accounts` and
`sales_orders` exist only on `chatgpt/m12-customer-portal`. Production has 73
commits fewer than the branch.

Two consequences:

1. The portal is currently reachable **only** through the Vercel preview. Code
   work alone cannot change that — the branch has to reach the production
   deployment.
2. Applying 0005 and 0006 to production **today changes nothing observable**,
   because no deployed code references any of the objects they create. That
   makes the migration the safe half of the activation, and the deploy the half
   that actually changes behaviour.

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

### Step 1 — apply the migrations (owner approval required)

Against the production database, in one session:

```sql
-- supabase/pending-approval/0005_customer_accounts.sql
-- supabase/pending-approval/0006_sales_orders.sql
```

Apply 0005 first (0006 does not depend on it, but the portal needs both).

Safe to run **before** the deploy: nothing in the currently-deployed code
touches these objects.

### Step 2 — ship the code to production

Merge `chatgpt/m12-customer-portal` (PR #5) so the production deployment
carries the portal. Until this happens, `/account/login` is a 404 in production
however the database looks.

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

## 5. Rolling back

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
