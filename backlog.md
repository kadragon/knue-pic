# Backlog

## Next

- [ ] 요즘 많이 가는 곳 (≥2 recent visits, `NEW` when the prior count is 0) and 새로 발견된 곳
- [ ] Naver map with markers, TOP 10 number badges, and the PRD §38 fallback when the API fails
- [ ] Search, category filter, empty-result reset control
- [ ] Place detail card: stats, 12-month histogram, 네이버지도에서 보기 link
- [ ] `[CONSTRAINT]` Banned-phrase test over UI strings (`docs/conventions.md` → Framing Vocabulary)
- [ ] `[CONSTRAINT]` `collector/validate.py` implementing the nine PRD §32 checks; non-zero exit blocks deploy
- [ ] `[CONSTRAINT]` GitHub Actions: validate → build → deploy to Pages, plus a secret-scan step over `src/`
- [ ] Collector (Python): download, extract XLS/XLSX/CSV/PDF, normalize, merge, classify, geocode, emit `review_candidates.csv`
- [ ] Collector: canonical ID map persisted across runs; rolling-window trim on `places.json` build

## Review Backlog

### PR #4 (TOP 10 list)

- [ ] `renderDataset` re-renders the whole shell on a successful load, so a load that succeeds after a user-clicked retry drops focus off the retry button (`src/ui/bootstrap.ts` — `renderFrame` replaces `root`, detaching the captured `content` node). Pre-existing since the load-state slice; the period selector's own focus handling is correct.
- [ ] `TOP_PLACES_HEADING` hardcodes "TOP 10" while `computeTopPlaces` takes a `limit` and short windows routinely rank fewer than ten places — decide whether the copy should reflect the rendered count.

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
