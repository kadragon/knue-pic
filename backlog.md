# Backlog

## Next

- [ ] `[CONSTRAINT]` `collector/validate.py` check 9 joins on `display_name` because `review_candidates.csv` has no `id` column — move the join onto the canonical ID so a renamed business cannot lose its approval

## Review Backlog

### NFC join keys (follow-up, PR #12)

- [ ] `[CONSTRAINT]` `category` is a join key too, and nothing normalizes it: `collector/build_places.py` copies the CSV's first taxonomy segment verbatim, and `src/stats/search.ts` groups and filters places by exact `category` string, so NFC and NFD spellings of `한식` render two visually identical filter options that each hide the other's places. Normalize it in the build *and* in the browser, or the two disagree again (source: code-review on PR #12)
- [ ] `[FIX]` `src/stats/search.ts` → `normalize()` does `trim().toLowerCase()` with no `normalize("NFC")`. Now that every published `name` is NFC, a decomposed query string matches nothing at all — an NFD query at least matched an NFD name before PR #12 (source: code-review on PR #12)
- [ ] `[CONSTRAINT]` `collector/validate.py` has no dataset-level name-uniqueness check — check 1 covers `id` only. A hand-edited `data/places.json` carrying both the NFC and the NFD spelling of one approved name passes check 9 twice: two places, two ids, one business. `build_places.py` can no longer emit that, so the gate is the only thing standing between a hand edit and publication (source: contract QA on PR #12)

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
