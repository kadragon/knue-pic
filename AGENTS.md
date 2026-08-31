# KNUE PICK Agent Rules

A static, backend-less Vite + TypeScript SPA on GitHub Pages that surfaces the restaurants and cafés
KNUE staff used most, from the university's public expense disclosures. It reads one committed
`data/places.json`, which a local Python collector regenerates monthly.

## Docs Index (read on demand)

| File | When to read |
|------|--------------|
| `docs/runbook.md` | Build, test, deploy commands; monthly data update; failure modes |
| `docs/architecture.md` | Before adding a module, changing the data pipeline, or touching `places.json` schema |
| `docs/conventions.md` | Before writing UI strings, stat logic, tests, commits, or branches |
| `docs/workflows.md` | When starting any implementation cycle |
| `docs/eval-criteria.md` | When writing a Sprint Contract or grading a finished feature |

## Golden Principles

Invariants. A violation is a defect, not a style opinion.

1. **No backend, no runtime credentials.** The deployed site loads `data/places.json` and the Naver
   Maps JS API and nothing else — no server, no DB, no fetch to a private endpoint. Only the browser
   Client ID may appear in `src/`. *Enforced by:* the `secret-scan` job in `.github/workflows/ci.yml` (credential-shaped strings in `src/`).
2. **Unapproved places never publish.** A place enters `data/places.json` only with
   `status=approved` in `review_candidates.csv` plus non-empty `name`, `address`, and in-range
   `lat`/`lng`; never auto-pick a geocoding candidate. *Enforced by:* the validator (PRD §27–§32).
3. **The data quality gate blocks deploy, not just warns.** All nine checks of PRD §32 run before
   build; any failure stops publication. *Enforced by:* the same validator, wired into CI.
4. **Discovery framing, never recommendation or surveillance.** No user-facing string may call a
   place recommended/endorsed, or frame the data as expense tracking. The PRD §21 disclaimer ships
   on every screen. *Enforced by:* banned-phrase test (`docs/conventions.md` → Framing Vocabulary).
5. **Fabrication ban.** If you have not read a value from a file, command output, or tool result in
   this session, do not state it as fact — write `[unknown — read {source} to verify]`. Applies to
   ports, API endpoints, JSON field names, config values, versions, and the Pages URL.

## Delegation

Inline is the default. This repo has **no agent roles and no orchestrator** — the built-in
`Explore` / `general-purpose` subagents cover ad-hoc fan-out. Delegate only under the authorization
and gating rules in the operator's global `~/.claude/CLAUDE.md`; nothing here widens them. Roles and
their routing table arrive later via `dev:harness-curate`, on transcript evidence — not before.

<!-- harness:verbatim — mandated block, exempt from the non-inferability filter. Do not trim or paraphrase. -->
## Token Economy

Rules that apply every message — keep the context window lean.

1. Do not re-read a file already read in this session. If you need to check a change, read only the diff/region.
2. Do not call tools just to confirm information you already have. Simple questions deserve direct answers.
3. Run independent tool calls in parallel (multiple reads, grep + glob, etc.) — not sequentially.
4. Delegate any analysis that would produce >20 lines of output to a sub-agent; return only the conclusion to this context.
5. Do not restate what the user just said. They can read their own message.

## Working with Existing Code

| | |
|---|---|
| ✅ | Compute every period statistic in the browser from `transactions`; add UI strings in Korean |
| ⚠️ | `data/places.json` is generated output — change it via the collector, never by hand-editing a place; schema changes update `docs/architecture.md` in the same commit |
| 🚫 | Adding a server, a database, or a build-time fetch of live data; putting a Naver secret key anywhere under `src/` or in CI env for the web build |

## Language Policy

- Code, comments, commits, docs, backlog: English
- User-facing UI strings: Korean (no i18n framework in MVP)

## Git

Branch per task (`git checkout -b <type>/<slug>`); never commit directly to `main`. Pages deploys
from `main` after merge, so merging *is* publishing — see `docs/runbook.md` → Deploy.

<!-- harness:verbatim — mandated block, exempt from the non-inferability filter. Do not trim or paraphrase. -->
## Maintenance

Update this file **only** when ALL of the following are true:

1. Information is not directly discoverable from code / config / manifests / docs
2. It is operationally significant — affects build, test, deploy, or runtime safety
3. It would likely cause mistakes if left undocumented
4. It is stable and not task-specific

**Never add:** architecture summaries, directory overviews, style conventions
already enforced by tooling, anything already visible in the repo, or
temporary / task-specific instructions.

Prefer modifying or removing outdated entries over appending. When unsure, add
a short inline `TODO:` comment rather than inventing guidance.

Size budget: target ≤100 lines, hard warn >200. Move long content to
`docs/*.md` (read on demand, cross-tool) and leave a pointer line here. On a
Claude-Code-only repo you may instead use `.claude/rules/*.md` (path-scoped,
auto-loads when the matching area is touched); on a multi-tool repo keep the
content in `docs/` so Codex/Cursor see it too.

**Memory boundary:** durable code/repo facts live here, in `.claude/rules/`, and
`docs/` — human-authored and version-controlled. Claude Code's auto-memory
(`MEMORY.md`) holds the model's discovered preferences and cross-session
learnings only; never promote a code fact into auto-memory, and don't hand-edit
`MEMORY.md`.
