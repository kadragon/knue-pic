# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] The auth-failure hook is registered after the map mounts, which assumes the v3 API calls `navermap_authFailure` post-construction rather than during script init. No vendor doc or captured trace establishes that ordering in either direction — verify against a deliberately rejected origin in a real browser, and move the registration only if the check shows the hook firing earlier (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

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
