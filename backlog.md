# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### build_places.py publishes an empty dataset when nothing is approved (2026-08-21)

- [ ] [bug] `collector/build_places.py:453` guards emptiness with `if approved and months and not dataset["places"]`, so a run with **zero** approved rows falls through, writes `places: []` and exits 0. The code's own comment states the gate has no minimum-place check, so CI would publish an empty map. Add a producer-side non-emptiness guard (raise `DatasetUnusable` when `approved` is empty) — `collector/build_places.py`

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
