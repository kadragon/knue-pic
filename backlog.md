# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### `fetch_disclosures.py` silently returns the wrong year when backfilling (2026-08-25)

- [ ] [debt] `collect_posts` compares the month number only — the year filter is stage 2's date
  cells, by design — but the default `--quiet-pages 3` stops the walk three pages after the last
  hit, so a month more than a few pages down the board is never reached. Backfilling 2025-06
  returned 21 posts that were all 2026-06, and 2025-08 returned zero; `--quiet-pages 60
  --max-pages 80` reached them. The wrong-year case is the dangerous one: it reports a plausible
  post count and stage 2 then finds no target-month rows, which reads as "the layout changed".
  Either scale the walk from the requested month's distance from today, or refuse a month whose
  matched posts all carry a different year. SKILL.md's "Run it" block assumes a recent month and
  documents no backfill invocation — fix the caller and the doc together
  — `.claude/skills/knue-expense-collect/scripts/fetch_disclosures.py`, `.claude/skills/knue-expense-collect/SKILL.md`

### `geocode_candidates.py --report` has no test home and tracebacks on operator error (2026-08-23)

- [ ] [debt] Two findings from the QA pass on `--report`, both declined as out of scope there. A
  malformed `--aliases` file raises `json.JSONDecodeError` and a directory passed as `--csv` raises
  `IsADirectoryError`, where the missing-CSV case already exits 2 with a message — the operator-error
  paths are inconsistent. And nothing automated covers `coordinate_clusters`/`report`: `collector/tests`
  only collects the `collector` package, so a skill script has no test home at all. The second is the
  larger of the two — a test harness for `.claude/skills/*/scripts/` would cover every stage, not just
  this flag — `.claude/skills/knue-expense-collect/scripts/geocode_candidates.py`, `collector/tests/`

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
