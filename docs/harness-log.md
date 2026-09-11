# Harness Log

Change history for harness edits — instruction files, skills, hooks, and agent
assets. Every row carries a falsifiable prediction so a later
`dev:harness-curate` run can confirm or refute the edit rather than re-litigate
it. `Verified` stays `pending` until that check runs (`unverified` when the edit
landed without a verifier), then becomes a date plus one line of evidence, or
`failed`.

**Change History:**

| Date | Change | Scope | Reason | Predicted impact | Verified |
|------|--------|-------|--------|------------------|----------|
| 2026-09-04 | `apply_review.py` + precision-edit the "never set `status`" rule | `.claude/skills/knue-expense-collect/` (`scripts/apply_review.py`, `SKILL.md`), `collector/tests/test_apply_review.py`, `docs/runbook.md` | The rule banned transcribing a verdict the reviewer had already stated, so each of 4 observed cycles forced either a rule violation or a refusal; the fallback was hand-editing a 1074-row CSV | Over the next 3 collection cycles, every `status` change to `review_candidates.csv` is made by an `apply_review.py` invocation — no hand edit of the CSV, and no session where the agent refuses to write down a verdict the reviewer stated | pending |
| 2026-09-04 | Disable `claude-md-management` at project scope | `.claude/settings.json` | 0 fires across 62 sessions; `dev:harness-*` already owns AGENTS.md/CLAUDE.md maintenance in this repo | Over the next 5 sessions no task needs it re-enabled, and `SKILLS-ACTIVE` still shows the AGENTS.md maintenance work landing through `dev:harness-capture` / `dev:harness-curate` | unverified |
