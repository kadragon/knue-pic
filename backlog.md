# Backlog

## Next

- [ ] `[CONSTRAINT]` GitHub Actions: validate → build → deploy to Pages, plus a secret-scan step over `src/`
- [ ] `[HARNESS]` Declare the collector's `pytest` dependency (a minimal `pyproject.toml` or `collector/requirements-dev.txt`) — `docs/runbook.md` documents `python3 -m pytest collector` but nothing in the repo names the dependency, so the queued CI job hits `No module named pytest`
- [ ] Collector (Python): download, extract XLS/XLSX/CSV/PDF, normalize, merge, classify, geocode, emit `review_candidates.csv`
- [ ] Collector: canonical ID map persisted across runs; rolling-window trim on `places.json` build
- [ ] `[CONSTRAINT]` `collector/validate.py` check 9 joins on `display_name` because `review_candidates.csv` has no `id` column — move the join onto the canonical ID so a renamed business cannot lose its approval *(blocked by: canonical-id-map)*

## Review Backlog

### PR #4 (TOP 10 list)

- [ ] `renderDataset` re-renders the whole shell on a successful load, so a load that succeeds after a user-clicked retry drops focus off the retry button (`src/ui/bootstrap.ts` — `renderFrame` replaces `root`, detaching the captured `content` node). Pre-existing since the load-state slice; the period selector's own focus handling is correct.
- [ ] `TOP_PLACES_HEADING` hardcodes "TOP 10" while `computeTopPlaces` takes a `limit` and short windows routinely rank fewer than ten places — decide whether the copy should reflect the rendered count.

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] `renderPlaceMap` installs `globalThis.navermap_authFailure` on every successful mount and never clears it, including on the empty-dataset and load-failure paths. Harmless today — `src/ui/bootstrap.ts` reaches `renderPlaceMap` once per page — but a second `renderDataset` would leave a stale closure that removes a detached canvas and appends the fallback into a detached section (source: QA verification of the PR #6 fix) — `src/map/place-map.ts`

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts`

### PR #5 (discovery, search, detail card)

- [ ] `src/data/load.ts` accepts `naverUrl` as any non-empty string (`requireText`), unlike `lat`/`lng`
      which are range-checked. PR #5 closed the sink at the render site (`src/ui/place-detail.ts`
      refuses a non-`https:` URL), but the loader's stated contract is to reject bad values before
      they reach `src/stats/`/`src/ui/` — add a scheme (ideally host) check there too.

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
