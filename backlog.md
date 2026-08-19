# Backlog

## Next

- [ ] `[CONSTRAINT]` Banned-phrase test over UI strings (`docs/conventions.md` → Framing Vocabulary)
- [ ] `[CONSTRAINT]` `collector/validate.py` implementing the nine PRD §32 checks; non-zero exit blocks deploy
- [ ] `[CONSTRAINT]` GitHub Actions: validate → build → deploy to Pages, plus a secret-scan step over `src/`
- [ ] Collector (Python): download, extract XLS/XLSX/CSV/PDF, normalize, merge, classify, geocode, emit `review_candidates.csv`
- [ ] Collector: canonical ID map persisted across runs; rolling-window trim on `places.json` build

## Review Backlog

### PR #6 — Naver map with ranked markers and the documented API-failure fallback (2026-08-19)

- [ ] [debt] An origin missing from the Naver key's allowed-URL list is not covered by the §38 fallback: the v3 script serves its full bundle regardless, so the load resolves and a map mounts; the API nulls `naver.maps` and calls a `window.navermap_authFailure` global about a second later. A real fallback has to register that hook and swap the mounted map for `MAP_ERROR_MESSAGE` after the fact (source: code-review, contest-confirmed) — `src/map/place-map.ts`
- [ ] [debt] `paint()` rebuilds the icon, title and z-index of every marker on each `select()`/`update()`, though a selection changes at most two. With the real API `setIcon` tears down and rebuilds the overlay DOM, so one click repaints the whole dataset (source: code-review) — `src/map/place-map.ts:187`

### PR #4 (TOP 10 list)

- [ ] `renderDataset` re-renders the whole shell on a successful load, so a load that succeeds after a user-clicked retry drops focus off the retry button (`src/ui/bootstrap.ts` — `renderFrame` replaces `root`, detaching the captured `content` node). Pre-existing since the load-state slice; the period selector's own focus handling is correct.
- [ ] `TOP_PLACES_HEADING` hardcodes "TOP 10" while `computeTopPlaces` takes a `limit` and short windows routinely rank fewer than ten places — decide whether the copy should reflect the rendered count.

### PR #5 (discovery, search, detail card)

- [ ] `src/data/load.ts` accepts `naverUrl` as any non-empty string (`requireText`), unlike `lat`/`lng`
      which are range-checked. PR #5 closed the sink at the render site (`src/ui/place-detail.ts`
      refuses a non-`https:` URL), but the loader's stated contract is to reject bad values before
      they reach `src/stats/`/`src/ui/` — add a scheme (ideally host) check there too.

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
