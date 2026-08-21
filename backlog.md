# Backlog

## Next

- [ ] `[CONSTRAINT]` `collector/validate.py` check 9 joins on `display_name` because `review_candidates.csv` has no `id` column — move the join onto the canonical ID so a renamed business cannot lose its approval

## Review Backlog

### build_places (follow-up, PR #11)

- [ ] `[CONSTRAINT]` `collector/build_places.py` compares approved `display_name` values by raw code points, so NFC and NFD spellings of one Korean name build as two places with two IDs. Normalize the key with `unicodedata.normalize("NFC", ...)` — and apply the same normalization in `load_approvals` in `collector/validate.py`, or the build and check 9 disagree about what one name is (source: contract QA on PR #11)

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
