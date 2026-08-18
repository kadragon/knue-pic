# Backlog

## Next

- [ ] TOP 10 list with tie-breaking and rank delta vs the previous window (omit when incomplete)
- [ ] 요즘 많이 가는 곳 (≥2 recent visits, `NEW` when the prior count is 0) and 새로 발견된 곳
- [ ] Naver map with markers, TOP 10 number badges, and the PRD §38 fallback when the API fails
- [ ] Search, category filter, empty-result reset control
- [ ] Place detail card: stats, 12-month histogram, 네이버지도에서 보기 link
- [ ] `[CONSTRAINT]` Banned-phrase test over UI strings (`docs/conventions.md` → Framing Vocabulary)
- [ ] `[CONSTRAINT]` `collector/validate.py` implementing the nine PRD §32 checks; non-zero exit blocks deploy
- [ ] `[CONSTRAINT]` GitHub Actions: validate → build → deploy to Pages, plus a secret-scan step over `src/`
- [ ] Collector (Python): download, extract XLS/XLSX/CSV/PDF, normalize, merge, classify, geocode, emit `review_candidates.csv`
- [ ] Collector: canonical ID map persisted across runs; rolling-window trim on `places.json` build

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
