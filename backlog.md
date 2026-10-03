# Backlog

## Review Backlog

### Detail card on a rejected origin — `destroy()` throws after auth failure (2026-10-03)

- [ ] [bug] On a rejected origin, once `navermap_authFailure` has fired, Naver's `map.destroy()` throws `TypeError: Cannot read properties of null (reading 'isArray')`. `dropMap` calls the stored release before clearing it, so the throw escapes `closeDialog` and every later `paint()`; the second detail card never opens and stays broken until reload. Observed on `:5179`, Chromium, 2 of 2 fresh loads. Reproduce with a fake whose `destroy` throws, then make the release survive it — `src/map/place-map.ts:120`, `src/ui/detail-dialog.ts:118`

### Detail card monthly chart (follow-up, 2026-09-16)

- [ ] [debt] The top-ranked place's 2026-09 column reads `0` while `updatedAt` is 2026-09-16. Unknown whether September is a partial month the collector has not reached or a month with no disclosure yet; either way the column draws the same as a month with no visits. Read `data/places.json` for September transactions before deciding whether the chart needs an in-progress marker (source: PR #63 design analysis, unverified) — `src/ui/place-detail.ts`, `src/stats/histogram.ts`

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

### PR #65 — pin the dev server to the Naver-accepted port (2026-10-03)

- [ ] [harness] `vite preview` stays on `:4173`, which the key rejects, so a production bundle cannot be
  checked against the real map locally. Pin `preview: { port: 5173, strictPort: true }` and verify the
  map mounts there, or record the limit as accepted (source: code-review) — `vite.config.ts:15`

## Map-first 2 — summary line and 업종 chip counts (2026-10-03)

- [ ] [feat] Add `{updatedAt} 기준 · N곳 · N회` above the filters and an in-window place count on
  each 업종 chip, both computed in `src/stats/` as pure functions (N곳 = places with ≥1 in-window
  transaction under the current filters; N회 = in-window transaction count). Lands in today's
  layout, so it ships independently of the map. Accept: stats unit tests hand-computable from a
  fixture; banned-phrase test covers the new strings; 360px holds (source:
  `docs/design/map-first-layout.md` → Implementation Decisions 6–7) — `src/stats/`,
  `src/ui/kind-filter.ts`, `src/ui/shell.ts`

## Map-first 3 — page map shell with neutral dots and the fallback layout (2026-10-03)

- [ ] [feat] Desktop (≥ 768px): full-bleed Naver map with the existing content in a ~360px left
  panel; every place passing the period and 업종 filters is a small neutral dot (no size/shade/hue
  from visit count); a `학교로` control recentres on `CAMPUS_ORIGIN`. Either failure route
  (load rejection, `navermap_authFailure`) switches to today's full-width layout with
  `지도를 불러오지 못했습니다.` once. Below 768px the page stays today's layout until ticket 6. The
  detail dialog is untouched. Accept: fake-API tests for dot set = filtered set, no
  count-derived marker option, both failure routes → full-width state; list paints before the map
  mounts; real-map check per `docs/runbook.md` → Verify the real map (source: `docs/design/map-first-layout.md` →
  Solution, Implementation Decisions 1, 3, 5, 8) — `src/map/place-map.ts`, `src/ui/shell.ts`,
  `src/ui/bootstrap.ts`, `src/styles.css`

## Map-first 4 — numbered pins synced with the visible rows (2026-10-03)

- [ ] [feat] Rows currently visible in the list become pins printing the row's rank label; row
  hover/focus and selection highlight the matching pin and vice versa; `더 보기` extends the pin
  set. `src/map/` receives `{ place, label? }` from the UI and still imports nothing from
  `src/stats/`. Amend `docs/architecture.md` → Layer Rules and rewrite the
  `src/map/place-map.ts` header to record why the page map returned (PR #17 removed it for sitting
  three screens away). Accept: fake-API tests for pin labels = visible rows' labels, highlight
  sync both ways, no count-derived marker option (source: `docs/design/map-first-layout.md` →
  Implementation Decisions 1–2) — `src/map/place-map.ts`, `src/ui/place-list.ts`,
  `src/ui/top-places.ts`, `docs/architecture.md` *(blocked by: 3-page-map-shell)*

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
  *(blocked by: 4-numbered-pins)*

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
