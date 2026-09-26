# AI-Assisted Development Workflow

How work moves through this repository. Working rules for implementation are in
[`../CLAUDE.md`](../CLAUDE.md); this file owns the **authority model** and the
**handoff contract**.

**Principles**

- **The repository is the communication layer.** Decisions, findings and status
  live in commits, documentation and [`../.ai/handoff.json`](../.ai/handoff.json)
  — not in a chat window that other participants cannot see. A reviewer with
  only GitHub access must be able to reconstruct the state of the project.
- **The owner is interrupted only for decisions that are genuinely theirs.**
- **Production is protected.** Development and verification happen elsewhere.

---

## 1. Authority model

### AUTO — decide and execute

No approval needed. Proceed and report afterwards.

- Naming, file layout, internal component structure, code organisation
- Refactors within the approved scope
- Test design and test structure
- UI detail: spacing, dropdown treatment, copy tone, component naming
- Engineering trade-offs with no commercial consequence
- Documentation
- Reading, searching, running tests / typecheck / build, inspecting git
- Committing to the working branch and pushing it

A tool-permission prompt from the harness is **not** an owner decision. Tool
permission and business approval are different things — do not escalate one as
the other.

### REVIEW — build, then have it reviewed

Safe to build and merge to a working branch, but a human reviews before it
drives consequential external behaviour.

- New database migrations (written, not applied to a shared environment)
- New external integration code paths, while disabled
- Changes to authorization or session handling
- Anything altering how supplier data is normalised or interpreted

### OWNER_DECISION — stop and ask

Requires the owner. Do not proceed on an assumption and ask afterwards.

- Money: pricing, markup, margin, discounts, currency handling
- Accounting, VAT, PFU tariff values or tax position
- Business rules and supplier commercial terms
- Customer journey changes to a material workflow
- Supplier commitments: placing a real order, enabling production ordering,
  sending anything to a supplier
- Destructive or irreversible operations: production mutation, schema
  reconciliation, deleting or resetting an environment, rewriting history
- Supplier identity decisions affecting existing commercial records

**Stop rule.** If information is missing but the implementation can stay
provider-agnostic or configurable, continue. Stop the affected path only where
being wrong could cause: incorrect supplier orders, incorrect customer prices,
incorrect PFU, incorrect VAT/accounting, data loss, a security problem,
production corruption, wrong stock/availability, or an irreversible external
action. Everything independent of that decision continues.

---

## 2. Product / UX review

For a **material customer-facing workflow**, propose the journey before
implementing it:

```
screens/steps → primary actions → important states → errors/exceptions → final outcome
```

This is not required for minor UI decisions, which are AUTO.

---

## 3. Mission lifecycle

```
OWNER OBJECTIVE
      │
      ▼
   INSPECT            verify against repo, database, supplier docs — not memory
      │
      ▼
    PLAN              dependencies, blockers, affected journey, proposal
      │
      ▼                        ┌──── fix ────┐
  IMPLEMENT ───► VALIDATE ─────┤             │
      │            tests       └─────────────┘
      │            typecheck
      │            build
      ▼
  UPDATE HANDOFF     .ai/handoff.json + affected docs, same change as the code
      │
      ▼
  PUSH ───► REVIEW ───► READY / OWNER_DECISION
```

Once a mission is approved, work autonomously through implementation, tests and
fixes. Interrupt only for a genuine OWNER_DECISION or a consequential blocker.

---

## 4. Handoff contract

### Machine-readable — `.ai/handoff.json`

Updated at the end of every meaningful phase. It is the cheap entry point that
lets another agent decide **what to inspect next** instead of re-reading the
repository.

Keep it structured and short. **No essays in JSON** — link to Markdown for
anything that needs explanation.

| Field | Contents |
| --- | --- |
| `mission_id`, `mission_title`, `status`, `phase` | What is active and where it stands |
| `canonical_branch`, `working_branch` | Where truth lives, where work happens |
| `completed`, `in_progress` | Work done and work open |
| `blockers` | What genuinely prevents progress, and on what |
| `risks` | Factual discrepancies stated and worked around |
| `owner_decisions_required` | Needs the owner; what it blocks |
| `review_decisions_required` | Needs a reviewer, not the owner |
| `tests` | Actual gate results |
| `commits` | Relevant commits this mission |
| `production_changes`, `database_changes`, `external_actions` | Must be honest, including `none` |
| `next_recommended_mission` | What should happen next |
| `last_updated` | ISO timestamp |

### Human-readable — end of mission

Keep it short. Long narrative reports are the exception, not the format:

```
MISSION STATUS · BRANCH · COMMITS
DONE · TESTED · CHANGED · NOT VERIFIED
BLOCKERS · OWNER DECISIONS REQUIRED · RISKS
NEXT RECOMMENDED MISSION
```

**NOT VERIFIED is mandatory and is not a weakness.** State plainly what was
built but never exercised against a real external system. Claiming verification
that did not happen is the most expensive failure mode available to an agent
here, and it has already occurred in this project.

> A previous session's handoff reported an integration as complete and tested.
> It was: the code was correct and the unit tests genuinely passed. But nothing
> had ever reached the supplier, and a later session had to discover that from
> the database rather than from the handoff. Hence this section.
