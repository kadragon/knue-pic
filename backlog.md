# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### 작년 같은 달 column has no month to rank until the backfill lands (2026-08-23)

- [ ] [feat] Collect 2025-06, 2025-07 and 2025-08 with `knue-expense-collect`, geocode the new
  venues and approve them in `review_candidates.csv`, then rebuild `data/places.json`. The
  collector's window already admits 15 months, but `collector/out/` starts at 2025-09, so the
  first discovery column renders its honest empty message on the live site — the column shipped
  ahead of its data by explicit decision, not by oversight
- [ ] [fix] *(blocked by: the backfill above)* Raise `RETAINED_MONTHS` from 12 to 15 in
  `src/stats/period.ts` so `isPriorWindowComplete` matches what the file actually holds. It must
  not move first: the constant is read as "there is data this far back", so raising it over
  uncollected months makes every place count zero visits there and renders invented ▼ rank drops
  on the 6개월 column. The detail chart is no longer coupled to it — `HISTOGRAM_MONTHS` in
  `src/stats/histogram.ts` owns the bar count — so this is a one-line change
  — `src/stats/period.ts:87`

### The detail card charts no bar for the 작년 같은 달 month (2026-08-23)

- [ ] [debt] Opening a place from the 작년 같은 달 column prints "2025년 8월 기준" over figures the
  12-bar histogram beside it cannot show: the chart ends at the anchor's own month and reaches back
  `HISTOGRAM_MONTHS`, so the very month the count describes has no bar. Not wrong — the card names
  its window, and the bars are labelled — but a reader comparing the two finds the stated month
  missing. Options: widen the chart for that basis only, mark the stated month on it, or say in the
  chart's heading that it covers the recent 12 months regardless of the figures above
  — `src/ui/place-detail.ts`, `src/stats/histogram.ts`

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
