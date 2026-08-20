# GoRush Logistics

Warehouse and delivery management: supplier document import (DDT), manual
order preparation, van fleet assignment, manual loading, driver delivery,
COD/payment tracking, and realtime dashboards.

The active workflow is entirely **manual and order-level** — there is no
barcode/QR scanning step and no physical warehouse-location (stand/shelf/zone)
concept anywhere in the product. An order's `status` is the only thing that
tracks its progress through the warehouse:

```
expected → stored → ready_for_loading → loaded → out_for_delivery → delivered
                 ↘ on_hold / cancelled (from most active states)
```

---

## Terminology

| Term | Meaning |
|---|---|
| **Order** | One supplier document (or manually-entered order), for exactly one final customer. May contain many product lines and many physical items. |
| **Order item** | One product line. Fees, PFU, transport and services are order items but **not** physical inventory. |
| **Inventory unit** | One physical object generated per physical order item quantity (4 tyres ⇒ 4 units). Used for label/token generation and historical counts — never scanned in the active flow. |
| **Vehicle (van)** | A fleet entry an order is assigned to for delivery. Vans are managed (added/renamed/removed) in the admin fleet UI, not hardcoded. |
| **Driver** | The person who loads and delivers an order, authenticated via a signed session cookie. |

There is deliberately **no** warehouse-location entity (no stand, zone, shelf,
rack, or bin). That functionality existed early in the project and was
removed by explicit product decision — see "Removed: stand/stativ" below.

---

## Routes

| Route | Purpose | Access |
|---|---|---|
| `/` | Public landing page, with the **Admin** button | public |
| `/admin/login` | Admin login | public |
| `/admin` | Livrări — the fleet/loading board (per-van columns + Neasignate) | admin session |
| `/admin/summary` | Sumar — dashboard totals and historical reporting | admin session |
| `/admin/prepare` | De pregătit — orders awaiting label/preparation | admin session |
| `/admin/orders/new` | Add order (manual entry or document upload) | admin session |
| `/admin/orders/[id]` | Order detail + editor | admin session |
| `/admin/customers` / `/admin/customers/[id]` | Customer + delivery-location management | admin session |
| `/admin/suppliers` / `/admin/suppliers/[id]` | Supplier management | admin session |
| `/admin/print-jobs` | Label print queue + retry | admin session |
| `/admin/bootstrap` | One-time admin account bootstrap helper | admin session |
| `/driver/login` | Driver login | public |
| `/driver` | Driver's route: assigned orders, navigation, load/deliver/COD | driver session |
| `/orders/[id]` | Safe read-only order view | public, read-only |
| `/u/[token]` | Unit QR fallback view (same read-only projection) | public, read-only |

---

## The flow, step by step

### 1. Order creation

Two entry points, both ending at the same atomic RPC:

- **Manual entry** — `/admin/orders/new` or the "+ Comandă nouă" dashboard
  launcher, filled in by hand.
- **Document upload (DDT import)** — `src/lib/ddt-import/` extracts one or
  more documents from an uploaded PDF (AI-assisted where configured, with a
  disclosed `unconfigured` fallback to a manual form — nothing is ever
  fabricated), previews a READY / NEEDS_REVIEW / POSSIBLE_DUPLICATE /
  DUPLICATE classification per document, and only writes an order once the
  admin explicitly confirms it (`confirmDdtDocument`).

Either path calls `createOrder()` → the `gorush_create_order` RPC: one
transaction that creates the order, its items, one `inventory_unit` per
physical item, and the initial status-history entry. There is no window
where an order exists without its units, and no physical-location claim of
any kind — order creation has **no warehouse-location dependency**, and no
ceiling on how many orders can be active at once.

The order appears immediately in **Livrări** as unassigned ("Neasignate")
or, if a driver/vehicle was set, in that van's column.

### 2. Preparation (`/admin/prepare` — "De pregătit")

Orders not yet ready for loading surface here. Label generation
(`src/lib/server/prepare-order.ts`) queues one print job per physical
inventory unit; the web app never prints directly (see "Label printing"
below).

### 3. Assignment & loading (`/admin` — "Livrări")

The board has one column per active van (fleet-managed, not fixed) plus a
"Neasignate" column. An admin assigns a driver/vehicle to an order, and can
reorder a van's column — the manual order becomes `delivery_sequence`, which
is what the driver's app later sorts by.

"Marchează încărcat" is a single tap per **order** (`gorush_mark_order_loaded`)
— never per physical unit. It is idempotent: a double tap or a retried
request returns the existing successful state rather than erroring or
double-recording.

### 4. Driver delivery (`/driver`)

A driver only ever sees their own assigned orders — filtered by `driver_id`
in SQL via the signed session cookie, never a value the client can override.
For each order the driver can view details, navigate, and:

- **Marchează livrat** (`gorush_deliver_order`) — one tap per order, with
  optional COD/payment amount recorded in the same call.
- **Livrare eșuată** (`gorush_mark_delivery_failed`) — the exception path; a
  reason is mandatory, and the order returns to `on_hold` rather than a new
  ad-hoc status.

`driverId: null` is accepted on the delivery RPCs to let an admin close out
a delivery from the Livrări board itself; a real driver session always has
its identity enforced server-side.

### 5. Hold / reactivate / cancel

`gorush_set_order_status` covers hold, reactivate and cancel with full
history. Reactivating restores the status an order held before going on
hold (`resolveReactivationStatus`), defaulting to `expected` if nothing was
remembered, and never restores back into `on_hold` or `cancelled`.

### 6. Label printing

The web app never prints. It queues a `print_jobs` row; the **GoRush Print
Agent** running on a Windows PC claims and prints it. See
[`print-agent/README.md`](../print-agent/README.md). Labels carry the order
number, customer, product and a Code128/QR unit token — no payment amounts,
addresses, or credentials (enforced by `assertLabelDataIsSafe()` on every
queueing path).

---

## Removed: stand/stativ

Earlier phases of this project sorted orders onto five fixed physical
"stands" (A–E) with dedicated allocation RPCs, a public `/stand/[code]` QR
resolver, and a printable stand-letter dominant on every label. This was a
deliberate product decision to remove entirely — not replace with any other
location abstraction (no zones, shelves, racks, bins, or QR locations).
Order status alone tracks warehouse progress now.

A handful of now-unused `orders`/`inventory_units`/`inventory_scans` columns
(e.g. `stand_code`) remain in the schema, deprecated and untyped from any
active application logic, to avoid destroying historical order data — see
the stand-removal migration for the exact classification of what was kept
vs. dropped.

---

## Database

Migrations live in `supabase/migrations/`, applied in order. `gorush_schema_health()`
is a permanent RPC that checks the live schema against what the application
code expects, for drift detection.

### Transactional RPCs (current, active)

| Function | Guarantees |
|---|---|
| `gorush_create_order` | Order + items + units + history, atomically |
| `gorush_set_order_status` | Hold / reactivate / cancel with history |
| `gorush_mark_order_loaded` | Order-level load, idempotent |
| `gorush_deliver_order` | Order-level delivery + optional COD, idempotent, driver-checked |
| `gorush_mark_delivery_failed` | Delivery exception with mandatory reason |
| `gorush_claim_print_job` | `FOR UPDATE SKIP LOCKED` single-consumer claim |
| `gorush_retry_print_job` | Re-queues a failed print job |
| `gorush_requeue_stale_print_jobs` | Crashed-agent recovery |
| `gorush_remove_vehicle` | Removes a van; unassigns its active orders, preserves historical relationships |

All are **SECURITY INVOKER** on purpose: Postgres grants `EXECUTE` to
`PUBLIC` by default, so `SECURITY DEFINER` would have handed the anon key a
write path straight through RLS.

### Deletion policy

**"Anulează" in the Admin UI is a safe cancellation, never a SQL `DELETE`.**
The order is marked `cancelled` and leaves the active dashboard; its items,
inventory units, and status history all survive. A true delete needs an
explicit future decision.

---

## Security

- Row Level Security is **on with no policies** for every logistics table.
  The anon key cannot read or write any of them.
- All privileged access goes through server-side code using the service-role
  key (`src/lib/supabase/server-admin.ts`, `import "server-only"`), so
  importing it from a client component is a build error.
- Admin auth is a Supabase Auth session managed by `@supabase/ssr`; every API
  route re-checks independently — the layout guard alone would not protect
  direct calls.
- Driver identity for delivery/loading actions always comes from the signed
  session cookie, never from the request body. That is what makes
  "Driver A cannot touch Driver B's route" real rather than dependent on the
  phone being honest.
- Public views (`/orders/[id]`, `/u/[token]`) expose a hand-picked
  projection: no payment details, no addresses, and no unit tokens.
- Every input is validated server-side with Zod even where the client
  validates.

### Admin authentication is Supabase Auth

`/api/admin/login` calls `supabase.auth.signInWithPassword()` against real
Supabase Auth users (Authentication → Users in the dashboard, or
`/admin/bootstrap` — a one-time helper that creates/resets an account
through the Admin API directly).

Authentication (is this a real Supabase user?) and authorization (may they
use the admin panel?) are separate: any confirmed Supabase user in the
project can sign in, but `ADMIN_ALLOWED_EMAILS` (comma-separated, optional)
restricts who is treated as an admin — see
`src/lib/auth/admin-authorization.ts`. Unset, any confirmed user is an admin.

---

## Language

Operational UI is Romanian; code and database identifiers stay English. Every
user-facing string resolves through `src/lib/i18n/logistics.ts`. Adding a
second locale is a data change (one more entry in `DICTIONARIES`), not a
code change.

---

## Testing

```bash
npm test          # unit tests
npm run typecheck
npm run build
```

Covers: order-progress/status transitions, hold/reactivate rules, print job
idempotency + failure/recovery (mocked printer), driver-day summary
calculations, label-data safety, and admin session forgery resistance.

Database-level end-to-end tests live in `supabase/tests/`.
