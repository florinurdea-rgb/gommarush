# AI Handoff

Human-readable handoff for the end of a work phase. Copy this template into a
pull request description, a comment, or a phase summary.

Keep [`../.ai/handoff.json`](../.ai/handoff.json) in sync — it is the
machine-readable version of the same state.

**Rules for filling this in:**

- Every section gets an answer. `None`, `N/A` and `Not run` are valid answers;
  a blank is not.
- Never report a test as passed without having run it.
- **Production Modified** must literally say `YES` or `NO`.
- If any answer would be `YES` to a production change that was not approved,
  stop and escalate rather than filing the handoff.

---

## Template

```markdown
# Handoff — <short title>

## Current Objective
<What the owner asked for, in one or two sentences. Include the approved scope.>

## Status
<One of: IN_PROGRESS | READY_FOR_REVIEW | CHANGES_REQUESTED | BLOCKED |
OWNER_DECISION | READY_FOR_OWNER | COMPLETED>

<One line on why this status.>

## Work Completed
- <What was actually done. Outcomes, not intentions.>
- <If something in scope was NOT done, say so here and why.>

## Files Changed
| File | Change | Note |
| --- | --- | --- |
| `path/to/file` | added / modified / deleted | <why> |

## Database Changes
<Staging: exactly what was applied, with migration name.
Production: expected to be "None".
If no database change at all: "None".>

## Tests
**Passed:**
- <gate / suite — actual result>

**Failed:**
- <gate / suite — failure and what it means. Do not hide these.>

**Not run:**
- <gate / suite — and why not>

## Staging Verification
<What was verified on staging and how. Name the queries run, the screens
exercised, the data seeded. "Verified" alone is not verification.
If not verified: say so and why.>

## Production Modified
<YES or NO — literally one of these two words.>
<If YES: what, when, under whose approval.>

## Review Findings
| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | blocking / non-blocking / nit | <finding> | fixed / not fixed — reason / disputed — reason |

<"None yet — not reviewed" is valid before AI review.>

## Risks / Known Issues
- <Anything a reviewer or the owner should know. Including problems spotted but
  deliberately left alone as out of scope.>

## Decisions Required
- <Question. Options. Your recommendation. What is blocked until it is answered.>
- <"None" if nothing is blocked on the owner.>

## Next Recommended Action
<The single next step, specific enough to act on without re-reading everything.>

## Commit / Branch
- Branch: `<branch>`
- Commit: `<sha>`
- PR: <link or "none">
```

---

## Worked example

```markdown
# Handoff — Phase 0: schema baseline & staging reconstruction

## Current Objective
Get production's true schema into version control and reconstruct it on staging,
without touching production. Approved scope: Phase 0 only.

## Status
READY_FOR_REVIEW

Baseline captured and applied to staging; parity checks pass.

## Work Completed
- Captured the production schema baseline via a read-only pull.
- Committed the baseline and all 28 `gorush_*` function definitions.
- Applied the baseline to staging, which was previously empty.
- Documented the migration-ledger mismatch in `docs/SCHEMA_BASELINE.md`.
- Ledger-repair SQL written and included for review — deliberately NOT executed.

## Files Changed
| File | Change | Note |
| --- | --- | --- |
| `supabase/migrations/<ts>_remote_baseline.sql` | added | captured baseline |
| `docs/SCHEMA_BASELINE.md` | added | ledger state + forbidden operations |

## Database Changes
Staging: baseline applied — 32 tables, 28 functions created. Staging was empty before.
Production: None.

## Tests
**Passed:**
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- Staging parity: table count 32/32, function count 28/28, index and constraint parity confirmed

**Failed:**
- None

**Not run:**
- Unit tests — no test runner exists in this repository yet

## Staging Verification
Applied the baseline to `ltdwabkitplicyiwucsp`, then compared against production
via the read-only connector: counted tables and functions, diffed constraint and
index definitions per table, and compared `gorush_schema_health()` output. All matched.

## Production Modified
NO

## Review Findings
None yet — not reviewed.

## Risks / Known Issues
- A `db pull` can silently omit functions or RLS state; mitigated by the explicit
  parity check rather than trusting the tool.
- The ledger mismatch is documented, not fixed. Fixing it touches production and
  is OWNER_DECISION.

## Decisions Required
- None for this phase.
- Blocking the NEXT phase: provenance of `GommaRush_ISB_Tyre_Catalogue_Import-3.xlsx`.
  9,559 listings sit under a supplier named `asdas` and cannot be attributed until
  confirmed.

## Next Recommended Action
Review this branch; then decide Phase 1 (supplier lanes + observation model),
which is blocked on the catalogue provenance question above.

## Commit / Branch
- Branch: `claude/schema-baseline`
- Commit: `<sha>`
- PR: <link>
```
