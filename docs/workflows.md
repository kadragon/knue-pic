# Workflows

Pick the primary workflow per cycle. This repo has **no agent roles**, so every step below runs
inline in the main thread — the discipline is the point, not the delegation.

## `code` — Implementation

**Step 0: Branch.** `git checkout -b <type>/<slug>` before the first edit. Never `main`.

**Step 1: Scope check.** Read the modules you are about to change. No delegation table exists yet;
when `dev:harness-curate` adds roles, its `docs/delegation.md` becomes this step's authority.

**Step 2: Sprint Contract.** Before writing code, write what "done" means in testable terms —
template in `docs/eval-criteria.md`. A bug fix names the test that fails before and passes after.
The contract lives in `tasks.md` for the duration of the sprint and is deleted at close; anything
that must outlive the sprint goes to `backlog.md`.

**Step 3: Implement.** Smallest change that satisfies the contract. Stat logic goes in `src/stats/`
with tests; UI strings pass the framing-vocabulary rules in `docs/conventions.md`.

**Step 4: QA.** Verify against the contract's criteria, not impressions. Run `npm test`,
`npm run typecheck`, `npm run lint`. For anything visible, check it at 360px width and with the map
script blocked.

**Step 5: Feature evaluation.** Grade against `docs/eval-criteria.md` before calling it done.

`backlog.md` item format:

```markdown
## Feature Name
> Goal: what and why.
> Done-when: concrete acceptance criteria, agreed BEFORE coding.

- [ ] Simplest case
- [ ] Next case builds on it
```

## `data-update` — Monthly Dataset Refresh

The repo's defining operational cycle (PRD §31). Commands in `docs/runbook.md` → Data Update.

1. Collect the newest disclosure files and extract transactions.
2. Normalize names, merge same-business variants, keep branches separate.
3. Classify food/beverage venues; drop excluded categories; uncertain → review, not publish.
4. Link to existing canonical IDs — never mint a new ID for an existing business.
5. Geocode; anything ambiguous (0 hits, ≥2 hits, low confidence, implausibly far, category mismatch)
   goes to `review_candidates.csv` as `pending`. Never auto-pick.
6. **Human approval pass.** Set each pending row to `approved` or `rejected`.
7. Build `data/places.json` from approved rows only; trim to the rolling window.
8. Run the validator (PRD §32). Non-zero exit → stop; do not publish.
9. `npm run preview` and look at the result.
10. Commit on a `data/YYYY-MM` branch, PR, merge. Merging publishes.

Never skip 6 or 9 — they are the only two steps that stop bad data from going public.

## `draft` — Documentation

Update `docs/` only, grounded in current code. If a doc reveals a missing constraint, add a
`backlog.md` item rather than fixing production code here.

## `constrain` — Add a Guard

Write the test/lint rule/validator check first, run it, and if existing code violates it, file the
remediation in `backlog.md` instead of fixing it in the same change. Update the owning doc.

## `explore` — Research

State the question, prototype, report options and tradeoffs, **do not commit**. Flows into `code`
if approved.

## Permitted Side-Effects

| Primary | Permitted |
|---------|-----------|
| `code` | Append `[doc]` / `[constraint]` items to `backlog.md`; update the doc a change invalidates |
| `draft` | Append a `backlog.md` item |

Not permitted: production code changes during `draft`.

## Multi-Session Continuity

For work spanning sessions, write `handoff-{feature}.md` at the **start**, while the plan is fresh:
Objective, Output format, Tools to use, Boundaries, plus current state and the next concrete step.
Delete it when the feature lands.
