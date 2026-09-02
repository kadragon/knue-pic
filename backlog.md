# Backlog

## Review Backlog

### Superlative claims in docs have no guard against going stale (2026-09-02, from PR #40)

- [ ] [harness] Adding a second meaning-carrying colour palette silently falsified two "this is the
  ONE place X happens" sentences — `docs/conventions.md` -> Accessibility and `src/styles.css`
  header note 5 — and three of the four review sources on PR #40 flagged them independently. The
  claims themselves are worth keeping (they are what makes the rule legible), so the fix is a check
  rather than a rewrite: a test or lint that reads the superlative sentences in `docs/` and
  `src/styles.css` and fails when the thing they claim to be unique is no longer unique. Scope it
  before building — a naive "ban the word 하나뿐" rule would fire on prose it should not
  — `docs/conventions.md`, `src/styles.css`, `eslint-rules/`

### The stylesheet has no test home (2026-09-02, from PR #39 review)

- [ ] [constraint] Three shipped behaviours rest on CSS nothing can assert: the `white-space: nowrap`
  block that keeps `거리 1.2km`, `19회 이용` and a `07-30` date from breaking mid-figure
  (`src/styles.css` → `.top-place-recent, .top-place-visits, .top-place-distance,
  .place-detail-distance`). Deleting that block leaves the whole suite green. jsdom applies no
  stylesheet and Vitest returns a `?raw` CSS import as `''` (measured), and a `readFileSync` test
  cannot live under `src/` — `tsconfig.json` sets `"types": ["vite/client"]` with no `@types/node`,
  and `vite.config.ts` collects only `src/**/*.test.ts`. Closing this means giving the stylesheet a
  test home outside `src/` (a second vitest project, or the `eslint-rules/` pattern), which is a
  config change rather than a test — `src/styles.css`, `vite.config.ts`, `docs/conventions.md` →
  Test Files

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

### `fetch_disclosures.py` walk — sanctioned gaps left by the positional stop (2026-08-25)

- [ ] [debt] Three limits QA reproduced on PR #23 and the contract sanctioned, none of them
  data-corrupting but all undocumented. (a) A target-month cluster sitting below two legitimately
  older pages — a late-publishing department — is missed and the run still exits 0, because
  `PAGES_PAST_TARGET` is 2 and the year guard sees the first cluster's correct stamp. (b) The
  repeat-page guard compares only the immediately preceding page, so a board clamping an
  out-of-range `pageIndex` to a *cycle* rather than its last page still walks to `--max-pages`.
  (c) A month older than everything the board carries, or a board whose 업무추진비 titles are all
  undated, never arms the stop and costs the full 200-page cap on both traversals. (a) is the only
  one that can lose data; consider documenting it in SKILL.md rather than widening the rule
  — `.claude/skills/knue-expense-collect/scripts/fetch_disclosures.py`,
  `.claude/skills/knue-expense-collect/SKILL.md`

### UI label pass — review findings left out of PR #24 (2026-08-25)

- [ ] [debt] The `--space-1..--space-9` scale PR #24 introduced is half adopted: 44 token uses
  against 18 raw-px spacing declarations, several sitting exactly on the scale (`margin: 16px 0 0`,
  `padding: 24px`, `margin: 8px 0 0`, `gap: 12px`, `padding: 14px 24px`, `padding: 32px 16px`). A
  half-migrated scale is worse than none: the next editor cannot tell a deliberate off-scale value
  from a missed one. Convert the on-scale ones and comment the genuinely optical values
  (2/3/6/10/13/14/56px) — `src/styles.css`
- [x] [debt] `·` now separates both the fields of a metadata line (`' · '`) and the parts inside one
  category (`displayCategory`), so a card reads `카페·디저트 · 청주시…`. Only the spaces distinguish
  the two roles. Pick a different field separator, or render the category as its own element
  — `src/ui/place-labels.ts`, `src/ui/top-places.ts`, `src/ui/place-detail.ts`, `src/ui/search.ts`
  *(done: the category is its own element now — the 업종 badge — so the two roles no longer share a
  separator)*

### Naver taxonomy is truncated to one segment before it reaches the browser (2026-08-25)

- [ ] [feat] `places.json` carries `category` as the *first* segment of Naver's taxonomy path, and
  the roots are inconsistent — the same kind of restaurant arrives as `음식점>한식` or as
  `한식>육류,고기요리`, so `음식점` (216 places) and `한식` (138) are one class split in two. The
  full path survives only in `review_candidates.csv` (111 distinct approved values). Publishing the
  second segment as a `subcategory` field would let the 업종 badge say `육류·고기요리` instead of
  `한식`, and could support a finer filter than the four kinds. Needs a schema change, a validator
  rule and a full re-collect, so it was ruled out of the UI batch that introduced the badge
  — `collector/build_places.py`, `collector/validate.py`, `src/data/types.ts`

## Someday

- [ ] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates)
