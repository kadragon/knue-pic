# Backlog

## Review Backlog

### Map auth-failure hook (follow-up, 2026-08-19)

- [ ] [debt] No vendor doc or captured trace establishes when the v3 API calls `navermap_authFailure` relative to map construction, or that it calls it at all on a rejected origin. The render no longer depends on the ordering — the hook is registered before the script is awaited and routed through one idempotent failure path, tested for both orderings against the fake API — but that is repo-side robustness, not evidence. Still needed: load the site on an origin the key rejects, in a real browser, and record whether the hook fires and whether the fallback replaces the map (source: contest round on PR #7, unverifiable-from-repo) — `src/map/place-map.ts` *(deferred: needs a real browser on an origin the Naver key rejects)*

### `fetch_disclosures.py` walk — sanctioned gaps left by the positional stop (2026-08-25)

- [x] [debt] Three limits QA reproduced on PR #23 and the contract sanctioned, none of them
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
  *(done: documented in `docs/runbook.md` → Common Failures, pointed to from the collection skill
  and `collect_posts`' docstring, with `--quiet-pages` as the lever for (a), and pinned as-is by the
  `test_limit_*` cases; behaviour unchanged)*

### UI label pass — review findings left out of PR #24 (2026-08-25)

- [x] [debt] `·` now separates both the fields of a metadata line (`' · '`) and the parts inside one
  category (`displayCategory`), so a card reads `카페·디저트 · 청주시…`. Only the spaces distinguish
  the two roles. Pick a different field separator, or render the category as its own element
  — `src/ui/place-labels.ts`, `src/ui/top-places.ts`, `src/ui/place-detail.ts`, `src/ui/search.ts`
  *(done: the category is its own element now — the 업종 badge — so the two roles no longer share a
  separator)*

### Naver taxonomy is truncated to one segment before it reaches the browser (2026-08-25)

- [x] [feat] `places.json` carries `category` as the *first* segment of Naver's taxonomy path, and
  the roots are inconsistent — the same kind of restaurant arrives as `음식점>한식` or as
  `한식>육류,고기요리`, so `음식점` (216 places) and `한식` (138) are one class split in two. The
  full path survives only in `review_candidates.csv` (111 distinct approved values). Publishing the
  second segment as a `subcategory` field would let the 업종 badge say `육류·고기요리` instead of
  `한식`, and could support a finer filter than the four kinds. Needs a schema change, a validator
  rule and a full re-collect, so it was ruled out of the UI batch that introduced the badge
  — `collector/build_places.py`, `collector/validate.py`, `src/data/types.ts`
  *(done: optional `subcategory` through build, check 10, loader, badge and search — see
  `docs/architecture.md` → Build. No re-collect was needed for the schema; the committed dataset
  predates the field and gains it at the next `data/YYYY-MM` build. The finer filter was left out:
  the 상세 분류 select still lists `category`)*

## Someday

- [x] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
  *(decided not warranted — `docs/design/deferred-scope.md`; `src/data/published-dataset.test.ts`
  holds the wire format and a 1 MB review trigger)*
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates) — conditions and the
  heatmap's framing objection in `docs/design/deferred-scope.md`; `src/ui/device-state.test.ts`
  must be widened by whichever lands first
