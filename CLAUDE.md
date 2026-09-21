# CLAUDE.md — Working agreement for GommaRush

Permanent instructions for Claude (and any AI agent) working in this repository.
Read this before any implementation work.

**Companion documents — read these too, do not duplicate them here:**

| Document | Purpose |
| --- | --- |
| `docs/AI_WORKFLOW.md` | Lifecycle and the AUTO / REVIEW / OWNER_DECISION authority levels |
| `docs/AI_HANDOFF.md` | Handoff template to fill in at the end of a work phase |
| `.ai/handoff.json` | Machine-readable current state. Update at the end of every meaningful phase |
| `README.md` | Stack, setup, environment variables, deployment |
| **`docs/architecture/`** | **THE CANONICAL SPECIFICATION.** Supplier, pricing, PFU/VAT, sales and sourcing architecture. Implementation and AI review are performed *against these documents*. |

---

## 0. Canonical specification and precedence

**`docs/architecture/` is the canonical GommaRush product and architecture
specification.** Implementation is performed against it, and AI review checks
work against it. It is the reference, not background reading.

| Document | Covers |
| --- | --- |
| [`docs/architecture/00_README.md`](docs/architecture/00_README.md) | Package purpose, supplier lanes, the source-technology-neutral principle |
| [`docs/architecture/01_SUPPLIER_ARCHITECTURE.md`](docs/architecture/01_SUPPLIER_ARCHITECTURE.md) | Canonical flow, product identity, normalized offer, capabilities, search strategy, customer confidentiality |
| [`docs/architecture/02_SUPPLIER_RULES.md`](docs/architecture/02_SUPPLIER_RULES.md) | Per-lane rules: Inter-Sprint, Deldo, Italian ~48h manual |
| [`docs/architecture/03_PRICING_PFU_VAT.md`](docs/architecture/03_PRICING_PFU_VAT.md) | Markup, minimum profit, PFU, VAT, rounding, price snapshots |
| [`docs/architecture/04_SALES_SOURCING_MODEL.md`](docs/architecture/04_SALES_SOURCING_MODEL.md) | Sales order, sourcing allocation, supplier purchase, logistics boundary |
| [`docs/architecture/05_IMPLEMENTATION_PRIORITIES.md`](docs/architecture/05_IMPLEMENTATION_PRIORITIES.md) | Milestone definition and priority order |

Sections 1-11 below are the *working rules* for applying that specification.
Where this file summarizes the specification, the specification wins.

### Precedence

When sources disagree, this is the order of authority:

```
verified supplier documentation / actual production facts
  → approved docs/architecture specification
  → approved owner decisions
  → implementation
```

Read it as: a verified supplier fact or a proven production fact outranks the
specification; the specification outranks a prior owner decision that predates
it; and all three outrank whatever the code currently does.

**A conflict between these sources is never resolved silently.** Not by
"correcting" the specification, not by making the code match a document that
describes something which does not exist, and not by assuming the production
database is right because it is live.

When you find a conflict:

1. **Stop** work that depends on the resolution. Continue anything that does not.
2. **Record it** in [`.ai/handoff.json`](.ai/handoff.json):
   - under **`risks`** when the conflict is a factual discrepancy you can state
     and work around without a business decision;
   - under **`decisions_required`** when resolving it needs owner input — any
     commercial, tax, pricing, supplier-behaviour or approved-business-rule
     question.
3. **State both sides**: what the specification says, what the supplier
   documentation or production proves, and which you recommend — with reasoning.
4. Where it is a `decisions_required` item, set `status` to `OWNER_DECISION`
   if it blocks the current phase.

The specification is not automatically right. The audit of this repository found
several places where it described integrations and data that do not exist.
Report those; do not build fiction to match a document, and do not edit the
specification to match reality without owner approval.

---

## 1. Product architecture principles

GommaRush is a B2B tyre supplier serving garages around Verona. Four subsystems
exist, and their boundaries are the most important thing in this codebase:

1. **Catalogue** — supplier-independent tyre identity.
2. **Supplier lanes** — where a tyre can actually be bought, and on what terms.
3. **Sales & sourcing** — what a customer bought, and where each unit comes from.
4. **Logistics** — the existing live warehouse / driver / delivery system.

Rules that hold across all of them:

- **Source technology must never dictate the business model.** API, FTP, CSV/XLSX
  and a human typing into a form all normalize into the *same* supplier offer /
  observation model. A manual lane is not a second architecture.
- **A catalogue product is supplier-independent.** It carries no supplier column.
  EAN is the strongest identity bridge; a supplier listing is not a product.
- **Supplier adapters return commercial facts only.** They never compute a
  customer price, apply markup, or decide tax. Pricing is a separate layer.
- **Absence of a declared capability means unavailable.** Never infer a
  capability from the fact that a supplier has an integration.
- **Customer-facing surfaces must never expose** supplier identity, supplier
  purchase price, supplier credentials, internal sourcing scores, or integration
  metadata. Customer choices describe GommaRush service levels, not suppliers.
- **Data marked as test/sample data must never become customer-facing price or
  availability.** Enforce this structurally (a column), not by convention.

## 2. Production safety rules

**Production Supabase project: `sfvaqextratpnprcamwd`. Treat it as read-only.**

- Claude's production connector is bound server-side to a read-only Postgres
  role. Do not look for a way around that — it is the safety model, not an
  obstacle.
- **Never** run a production migration, production write, or destructive
  database operation. These are `OWNER_DECISION` (see `docs/AI_WORKFLOW.md`).
- **Never run `supabase db push` against production.** The repository is not
  currently a valid migration source for it: production's ledger holds
  migrations this repository does not contain, and the one migration here
  (`supabase/migrations/20260804000000_client_offer_requests.sql`) is recorded
  in production under a different version. Assume no blanket replay is safe
  until a schema baseline exists.
- Never print, log, or commit secrets. `SUPABASE_SERVICE_ROLE_KEY` and
  `RESEND_API_KEY` are server-only and must only be read in files that
  `import "server-only"`.
- Do not "fix" the `rls_enabled_no_policy` advisory by adding permissive
  policies. RLS-on-with-zero-policies is a deliberate deny-by-default posture.

### Do not change without explicit approval

The logistics subsystem is live and carries real operational data:

- `orders`, `order_items`, `order_status_history`, `order_documents`
- `inventory_units`, `inventory_scans`, `inventory_incidents`, `warehouse_zones`
- `drivers`, `vehicles`, `print_jobs`
- all `gorush_*` logistics functions
- the `orders_status_check` status vocabulary
- `quote_requests` and its `GR-YYMMDD-NNNN` reference counter (customer-visible;
  never renumber or reset)

## 3. Staging-first development

**Staging Supabase project: `ltdwabkitplicyiwucsp`. This is where development happens.**

- Every schema change is applied and verified on staging first. No exceptions.
- Synthetic/seed data on staging is `AUTO` — create what you need to test.
- A change that has not run on staging is not ready for review.
- Record staging verification in the handoff. "It should work" is not verification.

## 4. Supplier architecture rules

- All three lanes — Inter-Sprint, Deldo, and the manual Italian ~48h supplier —
  sit behind one common adapter contract and write one normalized observation shape.
- Supplier capabilities are **explicit rows**, never inferred.
- Supplier commercial terms (minimum order quantities, prepayment/balance gating)
  belong in supplier rule data, not scattered hard-coded checks.
- **Automated supplier ordering is out of scope.** Do not implement, stub, or
  flag-guard a `placeOrder` path. Specifically: Inter-Sprint Protocol 104
  production ordering and Deldo production ordering stay unimplemented. Enabling
  them is `OWNER_DECISION`.
- Deldo sample files are documented by the supplier as structural/test data with
  fictional prices and quantities. They must be ingested as test data and must
  never surface as real availability or pricing.
- Manual observations expire and go stale exactly like automated ones.
- Do not invent supplier behaviour that is not in supplier documentation. If
  supplier behaviour is ambiguous and could affect commercial correctness, stop
  and ask — that is `OWNER_DECISION`.

## 5. Sales order vs existing logistics order

This distinction is easy to get wrong and expensive to undo.

| | `orders` (existing) | `sales_orders` (future) |
| --- | --- | --- |
| Represents | supplier consignment / transport-logistics job | what a customer bought |
| `supplier_id` | **required** | **must not exist** |
| Status vocabulary | `orders_status_check` (17 values) | its own, incl. `NEEDS_SOURCING` |
| Owned by | live warehouse/delivery system | sales layer above logistics |

- **Never repurpose `orders` into a customer sales-order table.** Never remove
  its supplier relationship. Never add sales states to `orders_status_check`.
- A sales order must be creatable **without a supplier** and sourced later.
- Supplier identity belongs on the **sourcing allocation**, never on the customer
  sales item — this is what makes split sourcing (4 tyres from A, 4 from B) possible.
- The only bridge from sales into logistics is a supplier-purchase record holding
  a nullable reference to a logistics order. The sales layer never writes `orders`
  directly.
- `order_items.unit_price`, `discount_percent`, `vat_percent` and `line_total` are
  **extracted supplier-document (DDT) figures, not GommaRush customer pricing**.
  The pricing engine must never read them.

## 6. Pricing, PFU and VAT separation

The calculation order is fixed:

```
supplier cost net
  → + markup amount        (markup applies ONLY here)
  → tyre sale net
  → + PFU                  (PFU enters the base UNMARKED-UP)
  → taxable subtotal
  → × VAT rate
  → customer gross total
```

- **Never apply markup to PFU.** Any implementation where markup is derived from
  a figure that already includes PFU is a defect, regardless of test results.
- Keep net, PFU, VAT and gross **separate and auditable** at every step. Never
  collapse them into a single total and re-derive components later.
- Use the word **markup** for a percentage applied to supplier cost. It is not a
  gross margin — 20% markup on €100 is a 16.67% margin on €120. Do not relabel it.
- PFU carries provenance: `SUPPLIER_EXACT`, `RULE_CALCULATED`, `MANUAL_CONFIRMED`,
  `TO_CONFIRM`. **If the applicable PFU cannot be determined reliably, emit
  `TO_CONFIRM` and mark the price provisional. Never invent a PFU amount.** There
  is no universal per-tyre PFU. Inter-Sprint does not supply PFU in its feed.
- Rounding must be deterministic and configured, not incidental. Whether VAT is
  rounded per unit or per line changes line totals — it is a configured decision.
- **Price snapshots are immutable.** Once a quote/offer/order price exists,
  the supplier cost used, markup type/value/amount, tyre sale net, PFU amount and
  status, VAT rate and amount, gross total, config version and timestamp are
  frozen. Changing configuration affects new calculations only, never history.
- PFU/tax/accounting policy is `OWNER_DECISION`. Do not decide tax treatment.

## 7. Configurable markup — non-negotiable

- **Markup must never be hard-coded.** Not in supplier adapters, not in the
  pricing engine, not as a constant, not as a default parameter in a function
  signature, not in a migration as a literal outside a config row.
- It lives in central pricing configuration, editable by an authorized admin
  **without a deployment**.
- V1 configuration must cover: default markup %, optional minimum € markup per
  tyre, VAT rate, and a rounding rule.
- An initial default of 20% is **seed configuration data**, not business logic.
- Keep the schema extensible for later supplier/customer/brand/quantity/promotional
  overrides, but do not implement those overrides without approval.
- Changing customer pricing policy is `OWNER_DECISION`.

## 8. Testing and verification

**There is currently no test runner in this repository** (`package.json` has no
`test` script and no test dependencies). Until one is added, the verification
gates that actually exist are:

```bash
npx tsc --noEmit    # type check   — works, currently clean
npm run build       # production build — works, currently succeeds
```

`npm run lint` is **not currently a usable gate.** ESLint has never been
initialized in this repository (there is no `.eslintrc*`), so `next lint` drops
into an interactive setup prompt and hangs a non-interactive run. Do not put it
in CI or claim it passed. Initializing ESLint is a worthwhile separate change.

Rules:

- Run every gate relevant to what you touched, and **report real output**. Never
  claim a gate passed without running it.
- If a gate fails, fix it or report it as failed. A failing gate is never
  "unrelated" or "pre-existing" unless you have verified that on a clean checkout
  and said so.
- Pricing logic must be written as **pure, directly testable functions** with no
  database coupling, so it is unit-testable the moment a runner exists.
- When a test runner is added, the pricing engine gets tests first, including a
  property test asserting markup is never applied to PFU.
- Record which gates passed, failed, or were not run in the handoff. `not_run` is
  an acceptable, honest answer; a false `passed` is not.

## 9. Scope discipline — no unrelated refactors

- Change what the task needs, and nothing else. Do not reformat, rename,
  restructure or "tidy" code you were not asked to touch.
- A refactor is in scope only when the task genuinely cannot be completed without
  it. Reversible refactoring required by the task is `AUTO`; a significant
  refactor is `REVIEW`.
- Do not refactor `gorush_commit_catalogue_batch` or the logistics functions while
  building on top of them. Reuse via new callers.
- If you spot an unrelated problem, note it in the handoff's Risks section rather
  than fixing it inline.
- Keep diffs small enough that a reviewer can hold the whole change in their head.

## 10. Documentation must stay synchronized

Code and documentation drift is treated as an incomplete task.

- Schema change → update the relevant doc in `docs/` in the **same** change.
- New/changed API contract, supplier capability, or pricing rule → document it in
  the same change.
- Update `.ai/handoff.json` at the end of every meaningful implementation phase,
  and keep it valid JSON.
- If you discover documentation that contradicts the code, supplier documentation
  or production, **report the conflict** via the precedence procedure in §0 rather
  than silently making either side match the other.

## 11. Escalation

Full definitions in `docs/AI_WORKFLOW.md`. Summary:

- **AUTO** — implementation inside approved scope, local changes, tests, docs,
  task-required reversible refactoring, staging changes, synthetic staging data,
  fixing test failures, fixing review findings that do not change approved
  business behaviour. Proceed without asking.
- **REVIEW** — schema additions, supplier adapters, pricing-engine implementation,
  API contracts, meaningful architectural changes inside approved scope,
  staging migrations, significant refactors. Proceed, but AI review is required
  before it is considered done.
- **OWNER_DECISION** — stop and ask. Production migrations or writes, destructive
  database operations, enabling automated supplier ordering, payment behaviour,
  PFU/tax/accounting policy, customer pricing policy, changes to approved business
  rules, credentials/security, meaningful new external cost, major architecture
  changes outside approved scope, ambiguous supplier behaviour affecting
  commercial correctness.

**When genuinely unsure which level applies, treat it as the higher one.**

Escalate by setting `status` to `OWNER_DECISION` in `.ai/handoff.json`, filling in
`decisions_required`, and stopping. Do not proceed on an assumption and flag it
afterwards — state the question, then wait.

## Known gaps

Recorded honestly so no agent assumes otherwise:

1. **No test runner** (see §8).
2. **No schema baseline.** Production's schema and its `gorush_*` functions are
   not in version control, and the migration ledgers disagree. Treat every
   migration question as unresolved until this is fixed.
