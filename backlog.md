# Backlog

## Review Backlog

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

## Review Backlog — found reviewing PR #72 (map-first shell, 2026-10-03)

- [ ] [debt] The page map opens on a fixed campus-centred frame (`PAGE_ZOOM` 13) rather than on the
  dots: the median place is 5.4km out and the p90 is 14.9km, but 125 of the 543 sit beyond 10km and
  the tail reaches 110km (대전, 세종), so a good share of the filtered set is drawn off-screen at every
  default zoom and the summary's `N곳` counts more places than a reader can see. Fit the frame to the
  dot set (`map.fitBounds`, verified on the official reference) and re-fit on a filter change, or
  state the framing where the reader can find it — `src/map/place-map.ts`
- [ ] [feat] Overlap is now observed on the real map, which is the condition
  `docs/design/map-first-layout.md` → Implementation Decision 3 set for revisiting clustering: the
  campus cluster stacks many dots on nearly the same block at zoom 13. Naver Maps v3 core has no
  built-in clusterer (the commonly cited `MarkerClustering.js` is example code to vendor), so this is
  a follow-up ticket, not a rider on the next one — `src/map/place-map.ts`

## Map-first 5 — detail inside the panel with `#place=<id>` (2026-10-03)

- [ ] [feat] Selecting a place (row, pin, dot, search result) replaces the list inside the panel
  with the detail card and a `← 목록` control, pans the map to it, and writes `#place=<id>`;
  loading with that hash opens it, an unknown id falls back to the list silently, and the back
  button returns to the list. At ≥ 768px the modal dialog and its single-marker map go away; below
  768px the dialog stays until ticket 6 lands the mobile sheet, since merging publishes. The card's
  sections move unchanged. Accept: hash round-trip and unknown-id tests; dot click → detail; focus
  moves to the card and back to the originating row; `device-state.test.ts` unchanged (source:
  `docs/design/map-first-layout.md` → Implementation Decision 4) — `src/ui/detail-dialog.ts`,
  `src/ui/place-detail.ts`, `src/ui/bootstrap.ts`, `src/map/place-map.ts`

## Map-first 6 — mobile bottom sheet (2026-10-03)

- [ ] [feat] Below 768px: full-screen map with the panel as a bottom sheet snapping to peek / half
  / full (default half) with a grab handle; the panel's list → search source order and the
  map-failure fallback (full-screen list) carry over; the modal dialog left below 768px by ticket 5
  is removed here. Accept: works at 360px with the map loaded
  and with the Naver script blocked; snap states reachable by keyboard as well as drag; all four
  `docs/eval-criteria.md` criteria graded for the finished layout (source:
  `docs/design/map-first-layout.md` → Solution, Implementation Decision 9) — `src/ui/shell.ts`,
  `src/styles.css` *(blocked by: 5-detail-inside-panel)*

## Someday

- [x] Precomputed monthly aggregates in the JSON if `transactions` growth threatens the 3s load budget
  *(decided not warranted — `docs/design/deferred-scope.md`; `src/data/published-dataset.test.ts`
  holds the wire format and a 1 MB review trigger)*
- [ ] Distance-from-me search, favourites, heatmap (PRD §44 V2 candidates) — conditions and the
  heatmap's framing objection in `docs/design/deferred-scope.md`; `src/ui/device-state.test.ts`
  must be widened by whichever lands first
