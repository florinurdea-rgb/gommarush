# GoRush Logistics — Phase 1

Warehouse and delivery management: supplier order import, physical goods
matching, temporary stand assignment, label printing, barcode storage
confirmation, and van loading.

Phase 1 ends at: **order import → confirmed → receiving scan → match → beep →
label print job → label printed → GoRush barcode scanned → item stored → driver
sees assigned orders → loading scans → item marked loaded.**

---

## Terminology

These are kept strictly separate throughout the code and database.

| Term | Meaning |
|---|---|
| **Order** | One supplier invoice/document, for exactly one final customer. May contain many product lines and many physical items. |
| **Order item** | One product line from the supplier document. Fees, PFU, transport and services are order items but **not** physical inventory. |
| **Inventory unit** | One physical object. 4 tyres + 2 tubes ⇒ **6** inventory units, each with its own token and barcode. |
| **Stand** | Temporary sorting stand **A–E**. Assigned to an active order. |
| **Warehouse zone** | Future physical zones (1–5, Returns, Quarantine). **Deliberately NOT mapped to stands** in Phase 1. |

A stand is not a zone. The database has no FK between `orders.stand_code` and
`warehouse_zones`, on purpose.

---

## Routes

| Route | Purpose | Access |
|---|---|---|
| `/` | Public landing page, with the **Admin** button | public |
| `/admin/login` | Admin login | public |
| `/admin` | Dashboard — *Comenzi în curs* | admin session |
| `/admin/orders/new` | Add/import order | admin session |
| `/admin/orders/[id]` | Order detail + editor | admin session |
| `/admin/hold` | *În așteptare* | admin session |
| `/admin/customers` | *Listă clienți* | admin session |
| `/admin/customers/[id]` | Company + locations editor | admin session |
| `/admin/print-jobs` | Label print queue + retry | admin session |
| `/admin/stands` | Printable permanent stand QR codes | admin session |
| `/driver` | Driver operational page | driver session |
| `/warehouse` | Storage barcode scanning station | admin or driver |
| `/stand/[code]` | **Permanent** stand QR resolver | public, read-only |
| `/orders/[id]` | Safe read-only order view | public, read-only |
| `/u/[token]` | Unit QR fallback view | public, read-only |

---

## The flow, step by step

### 1. Import

`Adaugă comandă` → *Unde adaugi comanda?* (today / tomorrow, stored as
`planned_delivery_date`) → `Încarcă document`.

The delivery day is **not** an entity. One supplier invoice remains one order;
the day is just a date on it.

Pipeline:

```
upload → store original → extract text → identify supplier → extract customer
      → match against customer database → extract products → normalise
      → validate → REVIEW SCREEN → user confirmation → create order
```

The original document is stored **before** analysis and is never discarded.

### 2. Document analysis

`src/lib/documents/` — one `DocumentAnalyzer` interface, interchangeable
providers. Business logic never depends on a specific vendor.

1. **Text layer first** (free, deterministic). `pdf-text.ts` extracts text from
   text PDFs and DOCX with no dependencies; `text-invoice-parser.ts` reads what
   is literally present.
2. **Vision/OCR provider** for scans and photos, if `ANTHROPIC_API_KEY` is set.
3. **Neither available** → `status: "unconfigured"`, zero extracted values, and
   the review screen shows *"Analiza automată nu este configurată"* with a
   manual form.

> **The honesty rule.** Nothing is ever fabricated. A field that cannot be read
> is left `null` and named in `reviewFields` so the review screen highlights it.
> `raw_description` always preserves the document's own text verbatim.

### 3. Customer matching

`src/lib/logistics/customer-matching.ts`. Three outcomes:

- **MATCH CONFIRMED** — company and location both agree.
- **POSSIBLE MATCH** — company looks familiar but details differ → admin review.
- **NEW CUSTOMER / NEW LOCATION** — no safe match.

When the company is known but the address is new, the admin picks one of:

| Choice | Effect |
|---|---|
| *Folosește adresa doar pentru această comandă* | Address stored on the order only. **No** `customer_locations` write. |
| *Adaugă ca locație nouă* | Creates a new branch. |
| *Actualizează o locație existentă* | Updates that branch — the only path that changes master data, and only when explicitly chosen. |

**Customer master data is never silently overwritten.**

### 4. Save

`Salvează` → `gorush_create_order` — a single transaction creating the order,
its items, one inventory unit per physical object, the status-history entry, the
document link, and the stand claim. There is no window where an order exists
without its units.

The order appears immediately in *Comenzi în curs* as
**"Se așteaptă livrare la depozit"**.

### 5. Stand allocation

First free stand of A–E. A stand is **never** silently reused: if the requested
one is taken, the order is created **unassigned** with a visible warning for
manual resolution.

Two mechanisms guarantee this under concurrency:

- a **partial unique index** `orders_active_stand_key` on `stand_code` where the
  status is a warehouse stage
- a **transaction advisory lock** inside `gorush_create_order`

A stand frees itself when the order leaves those statuses — there is no release
step to forget. Logic is isolated in `src/lib/logistics/stand-allocation.ts`.

### 6. Receiving (`/driver` → Recepție)

`Începe scanarea` requests the rear camera **and** unlocks the Web Audio context
— that click is the user gesture browsers require before any sound can play
later.

The operator reads the **original supplier label**. On a confident match:

1. the next expected `inventory_unit` on that line is claimed
2. it becomes `received` — **not** `stored`
3. an `inventory_scans` row is written
4. a `print_jobs` row is queued
5. the success screen shows a huge **stand letter**
6. one confirmation beep

All five writes happen in one transaction (`gorush_receive_unit`).

**Uncertain matches never beep and never invent an order.** They show
*"Nu am găsit o asociere sigură"* with manual search by order number, customer,
brand, model, size or SKU. A manual choice is recorded as manually confirmed.

### 7. Label printing

The web app never prints. It queues a job; the **GoRush Print Agent** on the
Windows PC claims and prints it. See [`print-agent/README.md`](../print-agent/README.md).

### 8. Storage (`/warehouse`)

After the label is attached, a handheld scanner (HID keyboard style,
`TOKEN`+`ENTER`) confirms storage. The unit becomes `stored`.

Re-scanning an already-stored item shows *"Obiect deja înregistrat ca
depozitat"*, writes a harmless audit scan, and **does not** play the success
sound.

### 9. Loading (`/driver` → Încărcare)

The driver sees only their own orders — filtered by `driver_id` in SQL, so
another driver's deliveries never reach the device.

Each scan verifies the unit exists, is currently `stored`, and belongs to an
order assigned to **this** driver/van. A wrong-driver scan shows
**"OBIECT GREȘIT / Acest produs aparține altei livrări"** in red with an error
sound, is recorded as a rejected scan, and is **never** marked loaded.

`Adaugă manual ca încărcat` exists for damaged labels and dead scanners. It
requires the exact unit and a mandatory reason, and is stored as
`scan_type = 'manual_loading'` with `manual = true` — never indistinguishable
from a real scan.

### 10. Stand QR codes

Print once from `/admin/stands` and stick them on the racks. Each encodes a
fixed `/stand/A` URL. The order currently on the stand is resolved server-side
at scan time, so the sticker never needs replacing. A free stand reports
*"Stativ A liber"*.

---

## Database

Migrations in `supabase/migrations/`:

| File | Contents |
|---|---|
| `20260817000000_logistics_phase1_schema.sql` | Additive schema: `drivers`, `vehicles`, new columns, widened CHECK vocabularies, guard indexes, storage bucket |
| `20260817000100_logistics_phase1_functions.sql` | Transactional RPCs |

Both were written against the **actual** live schema (the logistics tables
already existed) and are purely additive — nothing is dropped, renamed or
rewritten. Existing column names are used as-is:

| Concept | Actual column |
|---|---|
| Unit token (Code128/QR) | `inventory_units.qr_token` |
| Unit index within its item | `inventory_units.unit_sequence` |
| Unit kind | `inventory_units.unit_type` |
| Order number | `orders.order_number` — **bigint identity**; `GR-001` is a display form |
| Delivery recipient | `orders.delivery_name` |
| Payment on delivery | `orders.cash_on_delivery` |
| PFU charge | `order_items.environmental_fee` |
| Tax rate | `order_items.vat_percent` |
| Status history | `order_status_history.old_status` / `new_status` |

### Transactional RPCs

| Function | Guarantees |
|---|---|
| `gorush_create_order` | Order + items + units + history + stand claim, atomically |
| `gorush_receive_unit` | Unit claim (`SKIP LOCKED`) + scan + print job, atomically; idempotent by key |
| `gorush_store_unit` | Storage confirmation; duplicate-safe |
| `gorush_load_unit` | Wrong-driver protection; duplicate-safe |
| `gorush_manual_load_unit` | Mandatory reason; audit-distinct |
| `gorush_set_order_status` | Hold / reactivate / cancel with history |
| `gorush_assign_stand` | Collision-checked manual assignment |
| `gorush_claim_print_job` | `FOR UPDATE SKIP LOCKED` single-consumer claim |
| `gorush_requeue_stale_print_jobs` | Crashed-agent recovery |

All are **SECURITY INVOKER** on purpose: Postgres grants `EXECUTE` to `PUBLIC`
by default, so `SECURITY DEFINER` would have handed the anon key a write path
straight through RLS.

### Deletion policy

**"Șterge" in the Admin UI is a safe cancellation, never a SQL `DELETE`.** The
order is marked `cancelled` and leaves the active dashboard; its items,
inventory units, scan history and status history all survive. A true delete
needs an explicit future decision.

---

## Security

- Row Level Security is **on with no policies** for every logistics table. The
  anon key cannot read or write any of them.
- All privileged access goes through server-side code using the service-role
  key (`src/lib/supabase/server-admin.ts`, `import "server-only"`), so importing
  it from a client component is a build error.
- Admin auth is a **signed, httpOnly, sameSite=lax** server-side cookie — not a
  hidden button. Every API route re-checks independently; the layout guard alone
  would not protect direct calls.
- Driver identity for scans always comes from the signed session cookie, never
  from the request body. That is what makes wrong-item protection real.
- Public views (`/stand/[code]`, `/orders/[id]`, `/u/[token]`) expose a
  hand-picked projection: no payment details, no addresses, and **no unit
  tokens** (a token is effectively a bearer credential for marking an object
  stored or loaded).
- `label_data` is validated by `assertLabelDataIsSafe()` on every queueing path,
  so a future refactor cannot leak payment or credential fields onto a label.
- Every input is validated server-side with Zod even where the client validates.

### Phase 1 authentication is development-only

Shared credentials (`test` / `test`, overridable via `ADMIN_USERNAME` /
`ADMIN_PASSWORD`). The UI states this plainly on both the login page and the
admin header. It is **not** production security.

Replacing it with Supabase Auth means reimplementing `getAdminSession()` and
`requireAdminSession()` in `src/lib/auth/admin-session.ts` against
`supabase.auth.getUser()` and returning the same `AdminSession` shape. **No
page, route or component changes.** `drivers.auth_user_id` already exists for
the driver side.

---

## Language

Operational UI is Romanian; code and database identifiers stay English. Every
user-facing string resolves through `src/lib/i18n/logistics.ts`. Adding Italian
is a data change (one more entry in `DICTIONARIES`), not a code change.

---

## Testing

```bash
npm test          # 110 unit tests
npm run typecheck
npm run build
```

Covers: customer/location matching decisions, stand allocation collision
prevention, quantity → unit generation, duplicate barcode handling,
wrong-driver loading protection, order progress calculation, print job
idempotency + failure/recovery (mocked printer), hold/reactivate, label-data
safety, and admin session forgery resistance.

Database-level end-to-end:

```bash
createdb gorush_test
psql -d gorush_test -f supabase/migrations/20260817000000_logistics_phase1_schema.sql
psql -d gorush_test -f supabase/migrations/20260817000100_logistics_phase1_functions.sql
psql -d gorush_test -v ON_ERROR_STOP=1 -f supabase/tests/logistics_phase1_flow.sql
```

(The pre-existing logistics schema must be present first — the migrations are
additive.)

---

## Not in Phase 1

Deliberately excluded: final-mile delivery-at-customer workflow, route
optimisation, mapping stands A–E onto physical zones, accounting, the full
returns workflow (the data model supports it; the UI does not), and manual order
entry (shown in the UI as *În curând*).
