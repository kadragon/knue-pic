# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### Same-coordinate spelling clusters are found by hand (2026-08-21)

- [ ] [debt] `collector/aliases.json` merges the spellings of one business, but finding them is a manual pass: group the approved rows on identical `lat`/`lng` and the clusters fall out. The 2025-09..2026-08 run had 66 of them covering 47% of all visits, and new spellings arrive every month, so this recurs. Surface the clusters at stage 4 (or as a `--report` on the build) so the reviewer is told which rows to consider merging instead of having to look — `.claude/skills/knue-expense-collect/scripts/geocode_candidates.py`

### `loader.test.ts` fails on any machine with a configured client ID (2026-08-22)

- [ ] [test] `loadNaverMaps({ clientId: undefined })` cannot express "not configured": the option is
  destructured as `clientId = CLIENT_ID`, so passing `undefined` falls back to the `.env` value, a
  script tag is injected and the case waits out the load timeout instead of rejecting. It passes in
  CI (no `.env`) and times out locally — `npm test` is red on a contributor machine for a reason
  that has nothing to do with their change. Reproduced on `main` at 29bab9a, so it predates the
  four-column work — `src/map/loader.test.ts:31`, `src/map/loader.ts:58`

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
  on the 6개월 column — `src/stats/period.ts:87`

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
