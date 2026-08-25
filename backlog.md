# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### The "16 months retained internally" figure is stated twice and implemented nowhere (2026-08-25)

- [ ] [debt] `docs/architecture.md` → Rolling window and `collector/validate.py` (the
  `ROLLING_WINDOW_MONTHS` comment) both say the collector may retain 16 months internally while only
  15 ship. Nothing in `collector/` implements a 16: `build_places.py`'s `month_dirs()` reads
  whichever `collector/out/<month>/` directories happen to exist, so the internal retention is
  "whatever was collected", not a bounded 16. Surfaced during the PR #21 review round, which found
  the neighbouring 11-vs-14 figure in the same paragraph was also false. Either implement the bound
  or delete the figure — AGENTS.md Golden Principle 5 makes an unread stated value a defect
  — `docs/architecture.md`, `collector/validate.py`

### The detail card charts no bar for the 작년 같은 달 month (2026-08-23)

- [ ] [debt] Opening a place from the 작년 같은 달 column prints "2025년 8월 기준" over figures the
  12-bar histogram beside it cannot show: the chart ends at the anchor's own month and reaches back
  `HISTOGRAM_MONTHS`, so the very month the count describes has no bar. Not wrong — the card names
  its window, and the bars are labelled — but a reader comparing the two finds the stated month
  missing. Options: widen the chart for that basis only, mark the stated month on it, or say in the
  chart's heading that it covers the recent 12 months regardless of the figures above. Reachable
  on the live site since the 2025-06/07/08 backfill: the column now ranks 2025-08 rather than
  rendering its empty message, so a reader can open a card and meet the gap
  — `src/ui/place-detail.ts`, `src/stats/histogram.ts`

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
