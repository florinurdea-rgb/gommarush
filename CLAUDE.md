# CLAUDE.md — Working agreement for GommaRush

Permanent instructions for any AI agent working in this repository. Read this
before implementation work.

**Start here, then read only what your task needs:**

| File | Purpose |
| --- | --- |
| [`.ai/handoff.json`](.ai/handoff.json) | **Machine-readable current state.** Cheapest entry point. Read it first. |
| [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md) | Authority model (AUTO / REVIEW / OWNER_DECISION), lifecycle, handoff template |
| [`docs/architecture/`](docs/architecture/) | What the system is and is meant to become. Every claim carries a status marker. |
| [`docs/DATABASE_BASELINE.md`](docs/DATABASE_BASELINE.md) | Schema reality, migration divergence, reconciliation plan, staging assessment |
| [`docs/SECURITY_FINDINGS.md`](docs/SECURITY_FINDINGS.md) | Known security findings and their classification |
| [`docs/SCHEMA_RECONCILIATION_REPORT.md`](docs/SCHEMA_RECONCILIATION_REPORT.md) | Evidence: the repo migrations do NOT build the schema from empty |
| [`docs/DELDO_ACTIVATION.md`](docs/DELDO_ACTIVATION.md) | Owner checklist: what Deldo needs from us and we from them |
| [`README.md`](README.md) | Stack, setup, environment variables, deployment |

---

## 0. Source of truth

**Never treat AI memory, a previous chat statement, a prior summary, a commit
message or a branch name as authoritative.** They are claims to verify, not
facts. This rule exists because it has already been violated in this project:
several confident statements in earlier sessions turned out to be wrong when
checked against the database.

Source precedence, highest first:

```
1. verified external/supplier documentation
2. actual current repository (this commit, not a remembered one)
3. actual database / schema / configuration state
4. verified external responses and runtime evidence
5. automated tests
6. confirmed project decisions (recorded, not remembered)
```

### When sources conflict

**Do not resolve the conflict silently.** Not by editing the specification to
match the code, not by making the code match a document that describes
something which does not exist, and not by assuming production is right because
it is live.

1. **Record it** in [`.ai/handoff.json`](.ai/handoff.json):
   - `risks` — a factual discrepancy you can state and work around.
   - `owner_decisions_required` — resolving it needs a business, commercial,
     tax, pricing, supplier-behaviour or customer-journey decision.
2. **State both sides** and which you recommend, with reasoning.
3. **Block only the affected path.** Independent work continues.

A verified supplier fact or a proven database fact outranks the specification.
The specification is not automatically right; neither is production merely
because it is live.

### Never fill a supplier-documentation gap with an assumption

If a supplier's file format, protocol, column contract or order schema is not
documented in a source you can cite, it is **unknown**. Inventing one produces
code that silently mis-maps real commercial data. Register the capability as
unavailable and record the blocker.

---

## 1. Authority model

Summarised here; the full model is in [`docs/AI_WORKFLOW.md`](docs/AI_WORKFLOW.md).

| Level | Meaning |
| --- | --- |
| **AUTO** | Decide and execute autonomously. Naming, structure, refactors within scope, tests, docs, UI detail, engineering trade-offs. |
| **REVIEW** | Build where safe, but a human reviews before it drives consequential external behaviour. |
| **OWNER_DECISION** | Stop and ask. Money, accounting, business rules, customer journey, supplier commitments, destructive or irreversible operations. |

**Do not escalate trivial decisions.** Dropdown treatment, spacing, internal
component names, file layout and test structure are AUTO. Escalating them wastes
the owner's attention and is itself a failure.

**Do not proceed past a genuine OWNER_DECISION on an assumption** and raise the
question afterwards. Stop that path at the point the decision is needed.

---

## 2. Product architecture principles

GommaRush is a B2B tyre business near Verona. **Two business flows exist and must
never be merged commercially:**

1. **SALES** — GommaRush sources tyres from suppliers, adds its own commercial
   pricing, sells to tyre shops / end customers, and arranges fulfilment.
   GommaRush owns the goods and the margin.
2. **TRANSPORT** — GommaRush transports tyres for distributors and suppliers to
   *their* end customers. GommaRush does **not** own or sell those tyres. There
   is no product margin, and the accounting is a transport service.

Four subsystems, and their boundaries are the most important thing here:

- **Catalogue** — supplier-independent tyre identity.
- **Supplier lanes** — where a tyre can actually be bought, and on what terms.
- **Sales & sourcing** — what a customer bought, and where each unit comes from.
- **Logistics** — the live warehouse / driver / delivery system.

Rules that hold across all of them:

- **Source technology must never dictate the business model.** API, FTP, CSV,
  XLSX and manual operator entry are transport details. They must not leak into
  the catalogue, pricing or order model.
- **A supplier capability is explicit. Absence means unavailable.** Never infer
  a capability from the existence of an integration, a file or a credential.
- **`sales order` ≠ `sourcing allocation` ≠ `supplier purchase` ≠ `transport
  job`.** Four concepts, four lifecycles. Collapsing any two corrupts accounting.
- **Supplier observations carry provenance and freshness.** A price or stock
  figure without an observation time is not usable for a customer promise.
- **A price committed to a customer is snapshotted immutably**, with the PFU
  tariff version used at that moment.
- **Consequential supplier actions fail closed.** Ordering is refused unless
  explicitly enabled; an unrecognised configuration value resolves to the safe
  option, never the live one.
- **Test and sandbox behaviour must never become production behaviour by
  default.** Test data must be flagged at ingestion and must never reach a
  customer as real availability or price.

---

## 3. System integrity

A feature is not complete because its happy path works locally. Every
significant change considers, proportionally to its risk:

security · authorization · data consistency · migrations · idempotency ·
retries · supplier/API failure · stale supplier data · duplicate operations ·
auditability · logging · production/staging separation · regression risk ·
existing logistics · customer order lifecycle · accounting · partial-failure
recovery.

We are building one reliable company system, not disconnected features.

---

## 4. Supplier architecture

Prefer a **normalized provider-adapter** architecture. Deldo and Inter-Sprint
feed the **same** catalogue, offer and order layer. Supplier-specific behaviour
lives behind an explicit adapter.

Do **not** build a separate product system per supplier. Equally, do **not**
force suppliers into identical behaviour where their documented protocols
genuinely differ — that is what the adapter boundary is for.

---

## 5. PFU

PFU (*pneumatico fuori uso*, the Italian end-of-life tyre levy) is **never an
arbitrary hard-coded constant.**

- Treat it as verified, versioned, **effective-dated reference data**.
- Where verified tyre weight exists in catalogue or supplier data, preserve it
  with its provenance (`weight_kg` + `weight_status` already do this).
- A transaction records the PFU tariff, version and source used at that time, so
  a historical order stays explainable after tariffs change.
- A freshness/validity control must prevent silent use of an expired or
  unverified tariff.
- **Do not invent tariff values.** Sourcing them is an OWNER_DECISION.

---

## 6. Verification gates

Run what is relevant to your change and report **actual output**, never a
prediction. Current gates, all working:

```
npx vitest run     # 963 passed, 6 skipped (live probes and real-file checks, gated)
npx tsc --noEmit   # clean
npx next lint      # 0 errors; 7 pre-existing warnings in UI components
npm run build      # Next.js production build
```

Schema claims are verified, not asserted:

```
bash scripts/verify-migration-baseline.sh   # needs a local disposable PostgreSQL
```

**Never weaken a test to make it pass.** Investigate the failure. If a failure
is genuinely pre-existing, evidence it rather than absorbing it into your change.

Tests must stay deterministic by default. Anything touching a real external
system is gated behind an explicit environment variable and skipped otherwise —
see `tests/intersprint-live-probe.test.ts` for the pattern.

---

## 7. Git and safety

- Work on a branch off `main`. `main` is the canonical code baseline.
- Never force-push `main`. Never delete branches. Never merge a stale branch
  wholesale — port verified pieces selectively.
- Never commit a credential. Configuration is read from the environment.
- **No production database mutation** without an explicit owner decision.
- Staging is a development environment and is **not authoritative** for
  schema or business truth.
- Commit in coherent units with a message that states what changed and why.

---

## 8. Cost discipline

Be efficient. Use deterministic tools — `grep`, tests, SQL — before expensive
reasoning. Inspect the targeted part of a large file rather than re-reading it
whole. Keep handoffs concise. Do not duplicate documentation: update the file
that already owns a topic.
